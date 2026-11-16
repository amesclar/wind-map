import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * App version (SCRUM-91). Single source of truth is the project-root VERSION file.
 * APP_VERSION env var overrides it (useful for CI builds).
 */
export const VERSION_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'VERSION');

export function readAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.trim();
  return readFileSync(VERSION_FILE, 'utf-8').trim();
}
