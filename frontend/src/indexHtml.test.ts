import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shell must not point at another origin (SCRUM-293): `style-src 'self'` and `script-src 'self'`
 * refuse a CDN stylesheet or bundle, and a blocked stylesheet leaves Leaflet with no layout rules at
 * all - the map piles its tiles in one corner and the barbs never draw.
 *
 * The file is read from the working directory (the `frontend` package) rather than from
 * `import.meta.url`: under the jsdom environment that URL is an `http://localhost/` one, not a file.
 */
function readShell(): string {
  const candidates = [resolve(process.cwd(), 'index.html'), resolve(process.cwd(), '..', 'index.html')];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`index.html not found from ${process.cwd()}`);
  return readFileSync(path, 'utf8');
}

const html = readShell();

describe('index.html', () => {
  it('loads every stylesheet and script from the app itself', () => {
    const external = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);

    expect(external).toEqual([]);
  });

  it('keeps Leaflet out of the shell, since main.tsx imports its CSS', () => {
    expect(html).not.toContain('leaflet.css');
  });
});
