import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../constants';
import { useLocalStorageState } from './useLocalStorageState';
import { useMapSettings, useUnitPreferences } from './useSettings';

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
    expect(result.current.tileLayer).toBe('osm_dark');
    expect(result.current.cartoApiKey).toBe('');
    expect(result.current.windOverlayVisible).toBe(true);
  });

  it('ignores an unknown stored tile layer', () => {
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'something_old');
    const { result } = renderHook(() => useMapSettings());
    expect(result.current.tileLayer).toBe('osm_dark');
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
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'osm_standard');
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.applyServerConfig({ carto_api_key: 'server-key' }));
    expect(result.current.cartoApiKey).toBe('mine');
    expect(result.current.tileLayer).toBe('osm_standard');
  });

  it('persists the overlay toggle', () => {
    const { result } = renderHook(() => useMapSettings());
    act(() => result.current.setWindOverlayVisible(false));
    expect(localStorage.getItem(STORAGE_KEYS.windOverlayVisible)).toBe('false');
    expect(renderHook(() => useMapSettings()).result.current.windOverlayVisible).toBe(false);
  });
});

describe('useUnitPreferences (SCRUM-92)', () => {
  it('toggles imperial/knots ↔ metric/km/h', () => {
    const { result } = renderHook(() => useUnitPreferences());
    expect([result.current.unitSystem, result.current.speedUnit]).toEqual(['imperial', 'knots']);
    act(() => result.current.toggleUnitSystem());
    expect([result.current.unitSystem, result.current.speedUnit]).toEqual(['metric', 'kmh']);
    act(() => result.current.toggleUnitSystem());
    expect([result.current.unitSystem, result.current.speedUnit]).toEqual(['imperial', 'knots']);
  });
});
