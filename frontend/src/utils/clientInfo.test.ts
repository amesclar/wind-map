import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../version';
import {
  MAX_USER_AGENT_LENGTH,
  buildVersionReport,
  clientInfo,
  copyText,
} from './clientInfo';

const INFO = {
  app_version: APP_VERSION,
  map_zoom: 11,
  timezone: 'America/Los_Angeles',
  user_agent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36',
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('client info (SCRUM-319)', () => {
  it('reads the app version, the resolved timezone and the user agent', () => {
    const info = clientInfo();
    expect(info.app_version).toBe(APP_VERSION);
    // The zoom only comes from the map (SCRUM-320).
    expect(info.map_zoom).toBeNull();
    expect(info.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '');
    expect(info.user_agent).toBe(navigator.userAgent.slice(0, MAX_USER_AGENT_LENGTH));
  });

  it('writes the version, zoom, timezone and browser as one pastable block', () => {
    expect(buildVersionReport(INFO).split('\n')).toEqual([
      `Wind Map v${APP_VERSION}`,
      'Map zoom: 11',
      'Timezone: America/Los_Angeles',
      'Browser: Mozilla/5.0 (Macintosh) AppleWebKit/537.36',
    ]);
  });

  it('says unknown for a missing zoom, timezone or agent instead of leaving a blank line', () => {
    const report = buildVersionReport({
      ...INFO,
      map_zoom: null,
      timezone: '',
      user_agent: '',
    });
    expect(report).toContain('Map zoom: unknown');
    expect(report).toContain('Timezone: unknown');
    expect(report).toContain('Browser: unknown');
  });
});

describe('copyText (SCRUM-319)', () => {
  it('reports success when the clipboard accepts the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('reports a refusal instead of throwing', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('reports a refusal when the browser has no clipboard', async () => {
    await expect(copyText('hello')).resolves.toBe(false);
  });
});
