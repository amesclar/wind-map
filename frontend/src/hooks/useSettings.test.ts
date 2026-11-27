import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, STORAGE_KEYS } from '../constants';
import { useLocalStorageState } from './useLocalStorageState';
import { useMapSettings, useTimezone, useUnitPreferences } from './useSettings';

beforeEach(() => localStorage.clear());

describe('useLocalStorageState (SCRUM-92)', () => {
  it('reads, writes and removes the stored value', () => {
    localStorage.setItem('k', '5');
    const { result } = renderHook(() =>
      useLocalStorageState('k', (s) => Number(s ?? 0), (n) => (n ? String(n) : null)),
    );
    expect(result.current[0]).toBe(5);

    act(() => result.current[1](7));
    expect(result.current[0]).toBe(7);
    expect(localStorage.getItem('k')).toBe('7');

    act(() => result.current[1](0));
    expect(localStorage.getItem('k')).toBeNull();
  });
});

describe('useMapSettings (SCRUM-92)', () => {
  it('defaults to OSM dark, no key, overlay on', () => {
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.tileLayer).toBe('carto_dark');
    expect(result.current.cartoApiKey).toBe('');
    expect(result.current.windOverlayVisible).toBe(true);
  });

  it('ignores an unknown stored tile layer', () => {
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'something_old');
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.tileLayer).toBe('carto_dark');
  });

  it('saving a CARTO key stores it and switches to the CARTO layer; clearing removes it', () => {
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.saveCartoApiKey('abc'));
    expect(result.current.cartoApiKey).toBe('abc');
    expect(result.current.tileLayer).toBe('carto_dark');
    expect(localStorage.getItem(STORAGE_KEYS.cartoApiKey)).toBe('abc');
    expect(localStorage.getItem(STORAGE_KEYS.tileLayer)).toBe('carto_dark');

    act(() => result.current.saveCartoApiKey(''));
    expect(localStorage.getItem(STORAGE_KEYS.cartoApiKey)).toBeNull();
  });

  it('keeps the seamark overlay off unless it was turned on (SCRUM-175)', () => {
    const off = renderHook(() => useMapSettings());
    expect(off.result.current.seamarksVisible).toBe(false);

    act(() => off.result.current.setSeamarksVisible(true));
    expect(localStorage.getItem(STORAGE_KEYS.seamarks)).toBe('true');

    const restored = renderHook(() => useMapSettings());
    expect(restored.result.current.seamarksVisible).toBe(true);
  });

  it('falls back to off for a stored seamark value that is not a boolean', () => {
    localStorage.setItem(STORAGE_KEYS.seamarks, 'maybe');
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.seamarksVisible).toBe(false);
  });

  it('keeps B.C. depth off unless it was turned on (SCRUM-205)', () => {
    const off = renderHook(() => useMapSettings());
    expect(off.result.current.bcDepthVisible).toBe(false);

    act(() => off.result.current.setBcDepthVisible(true));
    expect(localStorage.getItem(STORAGE_KEYS.bcDepth)).toBe('true');

    const restored = renderHook(() => useMapSettings());
    expect(restored.result.current.bcDepthVisible).toBe(true);
  });

  it('falls back to off for a stored B.C. depth value that is not a boolean', () => {
    localStorage.setItem(STORAGE_KEYS.bcDepth, 'yes');
    expect(renderHook(() => useMapSettings()).result.current.bcDepthVisible).toBe(false);
  });

  it('restores the paper chart, and a server CARTO key does not take it away (SCRUM-203)', () => {
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'paper_chart');
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.tileLayer).toBe('paper_chart');

    // Production always has a server key; without the guard the mode would be unreachable.
    act(() => result.current.applyServerConfig({ carto_api_key: 'server-key' }));
    expect(result.current.tileLayer).toBe('paper_chart');
    expect(result.current.cartoApiKey).toBe('server-key');
  });

  it('restores Seamap, and a server CARTO key does not take it away (SCRUM-206)', () => {
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'seamap');
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.tileLayer).toBe('seamap');

    act(() => result.current.applyServerConfig({ carto_api_key: 'server-key' }));
    expect(result.current.tileLayer).toBe('seamap');
    expect(result.current.cartoApiKey).toBe('server-key');
  });

  it('uses a server CARTO key for the session only', () => {
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.applyServerConfig({ carto_api_key: 'server-key' }));
    expect(result.current.cartoApiKey).toBe('server-key');
    expect(result.current.tileLayer).toBe('carto_dark');
    expect(localStorage.getItem(STORAGE_KEYS.cartoApiKey)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.tileLayer)).toBeNull();
  });

  it("doesn't let a server key override the user's own", () => {
    localStorage.setItem(STORAGE_KEYS.cartoApiKey, 'mine');
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'paper_chart');
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.applyServerConfig({ carto_api_key: 'server-key' }));
    expect(result.current.cartoApiKey).toBe('mine');
    expect(result.current.tileLayer).toBe('paper_chart');
  });

  it.each(['osm_dark', 'osm_standard'])(
    'keeps a stored OpenStreetMap base after its restore (SCRUM-333)',
    (restored) => {
      localStorage.setItem(STORAGE_KEYS.tileLayer, restored);
      const { result } = renderHook(() => useMapSettings());
      expect(result.current.tileLayer).toBe(restored);
    },
  );

  it('still lands an unknown stored base on the CARTO default', () => {
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'mapbox_terrain');
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.tileLayer).toBe('carto_dark');
  });

  it('persists the overlay toggle', () => {
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.setWindOverlayVisible(false));
    expect(localStorage.getItem(STORAGE_KEYS.windOverlayVisible)).toBe('false');
    expect(renderHook(() => useMapSettings()).result.current.windOverlayVisible).toBe(false);
  });

  it('defaults the wind color gradient to off (SCRUM-124)', () => {
    expect(renderHook(() => useMapSettings()).result.current.windColorOverlayVisible).toBe(false);
  });

  it('persists the wind color gradient toggle (SCRUM-124)', () => {
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.setWindColorOverlayVisible(true));
    expect(localStorage.getItem(STORAGE_KEYS.windColorOverlayVisible)).toBe('true');
    expect(renderHook(() => useMapSettings()).result.current.windColorOverlayVisible).toBe(true);

    act(() => result.current.setWindColorOverlayVisible(false));
    expect(localStorage.getItem(STORAGE_KEYS.windColorOverlayVisible)).toBe('false');
  });

  it('defaults the high contrast gradient to off and persists it (SCRUM-213)', () => {
    expect(renderHook(() => useMapSettings()).result.current.windColorHighContrast).toBe(false);

    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.setWindColorHighContrast(true));
    expect(localStorage.getItem(STORAGE_KEYS.windColorHighContrast)).toBe('true');
    expect(renderHook(() => useMapSettings()).result.current.windColorHighContrast).toBe(true);

    act(() => result.current.setWindColorHighContrast(false));
    expect(renderHook(() => useMapSettings()).result.current.windColorHighContrast).toBe(false);
  });
});

describe('useUnitPreferences (SCRUM-92, SCRUM-107)', () => {
  it('defaults to imperial, knots and barbs', () => {
    const { result } = renderHook(() => useUnitPreferences());
    expect([result.current.unitSystem, result.current.speedUnit, result.current.dirDisplay]).toEqual([
      'imperial',
      'knots',
      'barb',
    ]);
  });

  it('changing the temperature unit leaves the speed unit unchanged', () => {
    const { result } = renderHook(() => useUnitPreferences());
    act(() => result.current.setSpeedUnit('mph'));
    act(() => result.current.setUnitSystem('metric'));
    expect([result.current.unitSystem, result.current.speedUnit]).toEqual(['metric', 'mph']);
    act(() => result.current.setUnitSystem('imperial'));
    expect([result.current.unitSystem, result.current.speedUnit]).toEqual(['imperial', 'mph']);
  });

  it('saves each preference and reads it back after a remount', () => {
    const first = renderHook(() => useUnitPreferences());
    act(() => first.result.current.setUnitSystem('metric'));
    act(() => first.result.current.setSpeedUnit('ms'));
    act(() => first.result.current.setDirDisplay('cardinal'));
    expect(localStorage.getItem(STORAGE_KEYS.unitSystem)).toBe('metric');
    expect(localStorage.getItem(STORAGE_KEYS.speedUnit)).toBe('ms');
    expect(localStorage.getItem(STORAGE_KEYS.dirDisplay)).toBe('cardinal');
    first.unmount();

    const { result } = renderHook(() => useUnitPreferences());
    expect([result.current.unitSystem, result.current.speedUnit, result.current.dirDisplay]).toEqual([
      'metric',
      'ms',
      'cardinal',
    ]);
  });

  it('falls back to the defaults for invalid stored values', () => {
    localStorage.setItem(STORAGE_KEYS.unitSystem, 'kelvin');
    localStorage.setItem(STORAGE_KEYS.speedUnit, 'furlongs');
    localStorage.setItem(STORAGE_KEYS.dirDisplay, '');
    const { result } = renderHook(() => useUnitPreferences());
    expect([result.current.unitSystem, result.current.speedUnit, result.current.dirDisplay]).toEqual([
      'imperial',
      'knots',
      'barb',
    ]);
  });
});

describe('useTimezone (SCRUM-107)', () => {
  it('defaults to the default timezone', () => {
    expect(renderHook(() => useTimezone()).result.current.timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('saves the timezone and reads it back after a remount', () => {
    const first = renderHook(() => useTimezone());
    act(() => first.result.current.setTimezone('Asia/Tokyo'));
    expect(localStorage.getItem(STORAGE_KEYS.timezone)).toBe('Asia/Tokyo');
    first.unmount();
    expect(renderHook(() => useTimezone()).result.current.timezone).toBe('Asia/Tokyo');
  });

  it('ignores a stored timezone that is not offered', () => {
    localStorage.setItem(STORAGE_KEYS.timezone, 'Mars/Olympus_Mons');
    expect(renderHook(() => useTimezone()).result.current.timezone).toBe(DEFAULT_TIMEZONE);
  });
});
