/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import * as semver from 'semver';

import {ActiveReleaseTrains} from '../../versioning/release-trains';
import {ReleaseAction} from '../actions';
import {actions} from '../actions/index';
import {changelogPath} from '../constants';
import * as npm from '../npm-publish';

import {getChangelogForVersion, getTestingMocksForReleaseAction, parse, setupReleaseActionForTesting, testTmpDir} from './test-utils';
import {getBranchPushMatcher} from './virtual-git-matchers';

describe('common release action logic', () => {
  const baseReleaseTrains: ActiveReleaseTrains = {
    releaseCandidate: null,
    next: {branchName: 'master', version: parse('10.1.0-next.0')},
    latest: {branchName: '10.0.x', version: parse('10.0.1')},
  };

  describe('version computation', async () => {
    const testReleaseTrain: ActiveReleaseTrains = {
      releaseCandidate: {branchName: '10.1.x', version: parse('10.1.0-next.3')},
      next: {branchName: 'master', version: parse('10.2.0-next.0')},
      latest: {branchName: '10.0.x', version: parse('10.0.1')},
    };

    it('should not modify release train versions and cause invalid other actions', async () => {
      const {releaseConfig, gitClient} = getTestingMocksForReleaseAction();
      const descriptions: string[] = [];

      for (const actionCtor of actions) {
        if (await actionCtor.isActive(testReleaseTrain)) {
          const action = new actionCtor(testReleaseTrain, gitClient, releaseConfig, testTmpDir);
          descriptions.push(await action.getDescription());
        }
      }

      expect(descriptions).toEqual([
        `Cut a first release-candidate for the feature-freeze branch (v10.1.0-rc.0).`,
        `Cut a new patch release for the "10.0.x" branch (v10.0.2).`,
        `Cut a new next pre-release for the "10.1.x" branch (v10.1.0-next.4).`,
        `Cut a new release for an active LTS branch.`
      ]);
    });
  });

  describe('build and publishing', () => {
    it('should error if package has not been built', async () => {
      const {repo, instance, releaseConfig} =
          setupReleaseActionForTesting(TestAction, baseReleaseTrains);
      const {version, branchName} = baseReleaseTrains.next;
      const tagName = version.format();

      repo.expectBranchRequest(branchName, 'STAGING_SHA')
          .expectCommitRequest('STAGING_SHA', `release: cut the v${version} release`)
          .expectTagToBeCreated(tagName, 'STAGING_SHA')
          .expectReleaseToBeCreated(`v${version}`, tagName);

      // Set up a NPM package that is not built.
      releaseConfig.npmPackages.push('@angular/non-existent');

      spyOn(console, 'error');

      await expectAsync(instance.testBuildAndPublish(version, branchName, 'latest'))
          .toBeRejectedWithError();

      expect(console.error).toHaveBeenCalledTimes(2);
      expect(console.error)
          .toHaveBeenCalledWith(jasmine.stringMatching(
              `Release output has not been built for the following packages:`));
      expect(console.error).toHaveBeenCalledWith(jasmine.stringMatching(`- @angular/non-existent`));
    });

    it('should support a custom NPM registry', async () => {
      const {repo, instance, releaseConfig} =
          setupReleaseActionForTesting(TestAction, baseReleaseTrains);
      const {version, branchName} = baseReleaseTrains.next;
      const tagName = version.format();
      const customRegistryUrl = 'https://custom-npm-registry.google.com';

      repo.expectBranchRequest(branchName, 'STAGING_SHA')
          .expectCommitRequest('STAGING_SHA', `release: cut the v${version} release`)
          .expectTagToBeCreated(tagName, 'STAGING_SHA')
          .expectReleaseToBeCreated(`v${version}`, tagName);

      // Set up a custom NPM registry.
      releaseConfig.publishRegistry = customRegistryUrl;

      await instance.testBuildAndPublish(version, branchName, 'latest');

      expect(npm.runNpmPublish).toHaveBeenCalledTimes(2);
      expect(npm.runNpmPublish)
          .toHaveBeenCalledWith(`${testTmpDir}/dist/pkg1`, 'latest', customRegistryUrl);
      expect(npm.runNpmPublish)
          .toHaveBeenCalledWith(`${testTmpDir}/dist/pkg2`, 'latest', customRegistryUrl);
    });
  });

  describe('changelog cherry-picking', () => {
    const {version, branchName} = baseReleaseTrains.latest;
    const fakeReleaseNotes = getChangelogForVersion(version.format());
    const forkBranchName = `changelog-cherry-pick-${version}`;

    it('should prepend fetched changelog', async () => {
      const {repo, fork, instance, testTmpDir} =
          setupReleaseActionForTesting(TestAction, baseReleaseTrains);

      // Expect the changelog to be fetched and return a fake changelog to test that
      // it is properly appended. Also expect a pull request to be created in the fork.
      repo.expectChangelogFetch(branchName, fakeReleaseNotes)
          .expectFindForkRequest(fork)
          .expectPullRequestToBeCreated('master', fork, forkBranchName, 200);

      // Simulate that the fork branch name is available.
      fork.expectBranchRequest(forkBranchName, null);

      await instance.testCherryPickWithPullRequest(version, branchName);

      const changelogContent = readFileSync(join(testTmpDir, changelogPath), 'utf8');
      expect(changelogContent).toEqual(`${fakeReleaseNotes}Existing changelog`);
    });

    it('should respect a custom release note extraction pattern', async () => {
      const {repo, fork, instance, testTmpDir, releaseConfig} =
          setupReleaseActionForTesting(TestAction, baseReleaseTrains);

      // Custom pattern matching changelog output sections grouped through
      // basic level-1 markdown headers (compared to the default anchor pattern).
      releaseConfig.extractReleaseNotesPattern = version =>
          new RegExp(`(# v${version} \\("[^"]+"\\).*?)(?:# v|$)`, 's');

      const customReleaseNotes = `# v${version} ("newton-kepler")\n\nNew Content!`;

      // Expect the changelog to be fetched and return a fake changelog to test that
      // it is properly appended. Also expect a pull request to be created in the fork.
      repo.expectChangelogFetch(branchName, customReleaseNotes)
          .expectFindForkRequest(fork)
          .expectPullRequestToBeCreated('master', fork, forkBranchName, 200);

      // Simulate that the fork branch name is available.
      fork.expectBranchRequest(forkBranchName, null);

      await instance.testCherryPickWithPullRequest(version, branchName);

      const changelogContent = readFileSync(join(testTmpDir, changelogPath), 'utf8');
      expect(changelogContent).toEqual(`${customReleaseNotes}\n\nExisting changelog`);
    });

    it('should print an error if release notes cannot be extracted', async () => {
      const {repo, fork, instance, testTmpDir, releaseConfig} =
          setupReleaseActionForTesting(TestAction, baseReleaseTrains);

      // Expect the changelog to be fetched and return a fake changelog to test that
      // it is properly appended. Also expect a pull request to be created in the fork.
      repo.expectChangelogFetch(branchName, `non analyzable changelog`)
          .expectFindForkRequest(fork)
          .expectPullRequestToBeCreated('master', fork, forkBranchName, 200);

      // Simulate that the fork branch name is available.
      fork.expectBranchRequest(forkBranchName, null);

      spyOn(console, 'error');

      await instance.testCherryPickWithPullRequest(version, branchName);

      expect(console.error)
          .toHaveBeenCalledWith(
              jasmine.stringMatching(`Could not cherry-pick release notes for v${version}`));
      expect(console.error)
          .toHaveBeenCalledWith(jasmine.stringMatching(
              `Please copy the release notes manually into the "master" branch.`));

      const changelogContent = readFileSync(join(testTmpDir, changelogPath), 'utf8');
      expect(changelogContent).toEqual(`Existing changelog`);
    });

    it('should push changes to a fork for creating a pull request', async () => {
      const {repo, fork, instance, gitClient} =
          setupReleaseActionForTesting(TestAction, baseReleaseTrains);

      // Expect the changelog to be fetched and return a fake changelog to test that
      // it is properly appended. Also expect a pull request to be created in the fork.
      repo.expectChangelogFetch(branchName, fakeReleaseNotes)
          .expectFindForkRequest(fork)
          .expectPullRequestToBeCreated('master', fork, forkBranchName, 200);

      // Simulate that the fork branch name is available.
      fork.expectBranchRequest(forkBranchName, null);

      await instance.testCherryPickWithPullRequest(version, branchName);

      expect(gitClient.pushed.length).toBe(1);
      expect(gitClient.pushed[0]).toEqual(getBranchPushMatcher({
        targetBranch: forkBranchName,
        targetRepo: fork,
        baseBranch: 'master',
        baseRepo: repo,
        expectedCommits: [{
          message: `docs: release notes for the v${version} release`,
          files: ['CHANGELOG.md'],
        }],
      }));
    });
  });
});

/**
 * Test release action that exposes protected units of the base
 * release action class. This allows us to add unit tests.
 */
class TestAction extends ReleaseAction {
  async getDescription() {
    return 'Test action';
  }

  async perform() {
    throw Error('Not implemented.');
  }

  async testBuildAndPublish(newVersion: semver.SemVer, publishBranch: string, distTag: string) {
    await this.buildAndPublish(newVersion, publishBranch, distTag);
  }

  async testCherryPickWithPullRequest(version: semver.SemVer, branch: string) {
    await this.cherryPickChangelogIntoNextBranch(version, branch);
  }
}
