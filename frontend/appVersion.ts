import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * App version (SCRUM-91). Single source of truth is the project-root VERSION file.
 * APP_VERSION env var overrides it (useful for CI builds).
 */
export const VERSION_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'VERSION');

/** Short commit hash appended to the displayed version (SCRUM-159), e.g. "db9f569". */
const GIT_SHA_PATTERN = /^[0-9a-f]{4,40}$/i;

export function readAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.trim();
  return readFileSync(VERSION_FILE, 'utf-8').trim();
}

/**
 * Short commit hash for the displayed version (SCRUM-159): the `GIT_SHA` build arg when the
 * build sets it (Docker), otherwise the current checkout, otherwise "" (no repo, no hash).
 */
export function readGitSha(): string {
  const fromEnv = (process.env.GIT_SHA ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/** `X.Y.Z-<hash>`, or plain `X.Y.Z` when the build has no commit hash (SCRUM-159). */
export function composeAppVersion(version: string, sha: string): string {
  const base = version.trim();
  const hash = sha.trim();
  return GIT_SHA_PATTERN.test(hash) ? `${base}-${hash}` : base;
}
