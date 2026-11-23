import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { composeAppVersion, readGitSha } from '../appVersion';
import { APP_VERSION } from './version';

// SCRUM-91: the app version must follow the release version, from one source.
// SCRUM-159: the displayed version adds the short commit hash, VERSION stays plain semver.
const root = resolve(__dirname, '..', '..');
const versionFile = readFileSync(resolve(root, 'VERSION'), 'utf-8').trim();
const pkg = JSON.parse(readFileSync(resolve(root, 'frontend', 'package.json'), 'utf-8'));

describe('app version (SCRUM-91)', () => {
  it('VERSION file is plain semver (MAJOR.MINOR.PATCH, no "v")', () => {
    expect(versionFile).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('injected APP_VERSION is the VERSION file plus the build hash', () => {
    expect(APP_VERSION).toBe(composeAppVersion(versionFile, readGitSha()));
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9a-f]{4,40})?$/);
  });

  it('frontend/package.json version matches the VERSION file', () => {
    expect(pkg.version).toBe(versionFile);
  });
});

describe('composeAppVersion (SCRUM-159)', () => {
  it('appends the short commit hash', () => {
    expect(composeAppVersion('0.7.1', 'db9f569')).toBe('0.7.1-db9f569');
  });

  it('stays plain semver when the build has no hash', () => {
    expect(composeAppVersion('0.7.1', '')).toBe('0.7.1');
    expect(composeAppVersion('0.7.1', '   ')).toBe('0.7.1');
  });

  it('ignores a value that is not a commit hash', () => {
    expect(composeAppVersion('0.7.1', 'not-a-sha')).toBe('0.7.1');
    expect(composeAppVersion('0.7.1', 'db9f569-dirty')).toBe('0.7.1');
  });

  it('trims surrounding whitespace', () => {
    expect(composeAppVersion(' 0.7.1 ', ' db9f569 ')).toBe('0.7.1-db9f569');
  });
});
