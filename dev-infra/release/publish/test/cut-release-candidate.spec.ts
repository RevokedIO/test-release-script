/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CutReleaseCandidateAction} from '../actions/cut-release-candidate';
import {expectStagingAndPublishWithCherryPick, parse, setupReleaseActionForTesting} from './test-utils';

describe('cut release candidate action', () => {
  it('should activate if a feature-freeze release-train is active', async () => {
    expect(await CutReleaseCandidateAction.isActive({
      releaseCandidate: {branchName: '10.1.x', version: parse('10.1.0-next.1')},
      next: {branchName: 'master', version: parse('10.2.0-next.0')},
      latest: {branchName: '10.0.x', version: parse('10.0.3')},
    })).toBe(true);
  });

  it('should not activate if release-candidate release-train is active', async () => {
    expect(await CutReleaseCandidateAction.isActive({
      // No longer in feature-freeze but in release-candidate phase.
      releaseCandidate: {branchName: '10.1.x', version: parse('10.1.0-rc.0')},
      next: {branchName: 'master', version: parse('10.2.0-next.0')},
      latest: {branchName: '10.0.x', version: parse('10.0.3')},
    })).toBe(false);
  });

  it('should not activate if no FF/RC release-train is active', async () => {
    expect(await CutReleaseCandidateAction.isActive({
      releaseCandidate: null,
      next: {branchName: 'master', version: parse('10.1.0-next.0')},
      latest: {branchName: '10.0.x', version: parse('10.0.3')},
    })).toBe(false);
  });

  it('should create a proper new version and select correct branch', async () => {
    const action = setupReleaseActionForTesting(CutReleaseCandidateAction, {
      releaseCandidate: {branchName: '10.1.x', version: parse('10.1.0-next.1')},
      next: {branchName: 'master', version: parse('10.2.0-next.0')},
      latest: {branchName: '10.0.x', version: parse('10.0.3')},
    });

    await expectStagingAndPublishWithCherryPick(action, '10.1.x', '10.1.0-rc.0', 'next');
  });
});
