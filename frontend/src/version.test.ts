import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { APP_VERSION } from './version';

// SCRUM-91: the app version must follow the release version, from one source.
const root = resolve(__dirname, '..', '..');
const versionFile = readFileSync(resolve(root, 'VERSION'), 'utf-8').trim();
const pkg = JSON.parse(readFileSync(resolve(root, 'frontend', 'package.json'), 'utf-8'));

describe('app version (SCRUM-91)', () => {
  it('VERSION file is plain semver (MAJOR.MINOR.PATCH, no "v")', () => {
    expect(versionFile).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('injected APP_VERSION equals the VERSION file', () => {
    expect(APP_VERSION).toBe(versionFile);
  });

  it('frontend/package.json version matches the VERSION file', () => {
    expect(pkg.version).toBe(versionFile);
  });
});
