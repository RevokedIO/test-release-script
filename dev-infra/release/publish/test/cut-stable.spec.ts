/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ReleaseTrain} from '../../versioning/release-trains';
import {CutStableAction} from '../actions/cut-stable';
import * as externalCommands from '../external-commands';

import {expectStagingAndPublishWithCherryPick, matchesVersion, parse, setupReleaseActionForTesting} from './test-utils';

describe('cut stable action', () => {
  it('should not activate if a feature-freeze release-train is active', async () => {
    expect(await CutStableAction.isActive({
      releaseCandidate: new ReleaseTrain('10.1.x', parse('10.1.0-next.1')),
      next: new ReleaseTrain('master', parse('10.2.0-next.0')),
      latest: new ReleaseTrain('10.0.x', parse('10.0.3')),
    })).toBe(false);
  });

  it('should activate if release-candidate release-train is active', async () => {
    expect(await CutStableAction.isActive({
      // No longer in feature-freeze but in release-candidate phase.
      releaseCandidate: new ReleaseTrain('10.1.x', parse('10.1.0-rc.0')),
      next: new ReleaseTrain('master', parse('10.2.0-next.0')),
      latest: new ReleaseTrain('10.0.x', parse('10.0.3')),
    })).toBe(true);
  });

  it('should not activate if no FF/RC release-train is active', async () => {
    expect(await CutStableAction.isActive({
      releaseCandidate: null,
      next: new ReleaseTrain('master', parse('10.1.0-next.0')),
      latest: new ReleaseTrain('10.0.x', parse('10.0.3')),
    })).toBe(false);
  });

  it('should create a proper new version and select correct branch', async () => {
    const action = setupReleaseActionForTesting(CutStableAction, {
      // No longer in feature-freeze but in release-candidate phase.
      releaseCandidate: new ReleaseTrain('10.1.x', parse('10.1.0-rc.0')),
      next: new ReleaseTrain('master', parse('10.2.0-next.0')),
      latest: new ReleaseTrain('10.0.x', parse('10.0.3')),
    });

    await expectStagingAndPublishWithCherryPick(action, '10.1.x', '10.1.0', 'latest');
  });

  it('should not tag the previous latest release-train if a minor has been cut', async () => {
    const action = setupReleaseActionForTesting(CutStableAction, {
      // No longer in feature-freeze but in release-candidate phase.
      releaseCandidate: new ReleaseTrain('10.1.x', parse('10.1.0-rc.0')),
      next: new ReleaseTrain('master', parse('10.2.0-next.0')),
      latest: new ReleaseTrain('10.0.x', parse('10.0.3')),
    });

    await expectStagingAndPublishWithCherryPick(action, '10.1.x', '10.1.0', 'latest');
    expect(externalCommands.invokeSetNpmDistCommand).toHaveBeenCalledTimes(0);
  });

  it('should tag the previous latest release-train if a major has been cut', async () => {
    const action = setupReleaseActionForTesting(CutStableAction, {
      // No longer in feature-freeze but in release-candidate phase.
      releaseCandidate: new ReleaseTrain('11.0.x', parse('11.0.0-rc.0')),
      next: new ReleaseTrain('master', parse('10.2.0-next.0')),
      latest: new ReleaseTrain('10.0.x', parse('10.0.3')),
    });

    await expectStagingAndPublishWithCherryPick(action, '11.0.x', '11.0.0', 'latest');
    expect(externalCommands.invokeSetNpmDistCommand).toHaveBeenCalledTimes(1);
    expect(externalCommands.invokeSetNpmDistCommand)
        .toHaveBeenCalledWith('v10-lts', matchesVersion('10.0.3'));
  });
});
