import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { makeForecast, makeLocation } from '../test/fixtures';
import type { WeatherForecastResponse } from '../types';
import { type Selection, selectionKey, useAllWeather, useDrawerForecast } from './useForecast';

vi.mock('../api/client', () => ({
  fetchWeather: vi.fn(),
  fetchPointWeather: vi.fn(),
  fetchAllWeather: vi.fn(),
}));

const oak = makeLocation();
const seattle = makeLocation({ id: 2, name: 'Seattle, WA', is_default: false });
const oakForecast = makeForecast();
const seattleForecast = makeForecast({ location_id: 2, location_name: 'Seattle, WA' }, { speed: 20 });
const pointForecast = makeForecast({ location_id: 0, location_name: '48.78°N, 121.94°W' });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(api.fetchWeather).mockReset().mockImplementation(async (id) => (id === 2 ? seattleForecast : oakForecast));
  vi.mocked(api.fetchPointWeather).mockReset().mockResolvedValue(pointForecast);
  vi.mocked(api.fetchAllWeather).mockReset().mockResolvedValue([oakForecast, seattleForecast]);
});

const saved = (location = oak): Selection => ({ kind: 'saved', location });
const point: Selection = { kind: 'point', latitude: 48.78, longitude: -121.94 };

describe('selectionKey', () => {
  it('identifies saved locations by id and points by coordinates', () => {
    expect(selectionKey(null)).toBeNull();
    expect(selectionKey(saved())).toBe('saved:1');
    expect(selectionKey(point)).toBe('point:48.78,-121.94');
  });
});

describe('useDrawerForecast (SCRUM-92)', () => {
  it('loads a saved location and reports it back', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useDrawerForecast(saved(), 'best_match', 'UTC', { onSavedForecast: onSaved }),
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.forecast).toBe(oakForecast));
    expect(result.current.isLoading).toBe(false);
    expect(api.fetchWeather).toHaveBeenCalledWith(1, 'best_match', 'UTC', { signal: expect.any(AbortSignal) });
    expect(onSaved).toHaveBeenCalledWith(oakForecast);
  });

  it('loads a map point without reporting it as a saved forecast', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useDrawerForecast(point, 'best_match', 'UTC', { onSavedForecast: onSaved }));
    await waitFor(() => expect(result.current.forecast).toBe(pointForecast));
    expect(api.fetchPointWeather).toHaveBeenCalledWith(48.78, -121.94, 'best_match', 'UTC', {
      signal: expect.any(AbortSignal),
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('aborts a slow request when the selection changes and ignores its late response', async () => {
    const slow = deferred<WeatherForecastResponse>();
    vi.mocked(api.fetchWeather).mockImplementationOnce(() => slow.promise);
    const { result, rerender } = renderHook(({ sel }) => useDrawerForecast(sel, 'best_match', 'UTC'), {
      initialProps: { sel: saved(seattle) },
    });
    const firstSignal = vi.mocked(api.fetchWeather).mock.calls[0][3]!.signal!;

    rerender({ sel: point });
    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.forecast).toBe(pointForecast));

    slow.resolve(seattleForecast);
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.forecast).toBe(pointForecast);
  });

  it('reloads for a new model, timezone or refresh token, but not for an equal selection object', async () => {
    const { rerender } = renderHook(
      ({ sel, model, tz, token }) => useDrawerForecast(sel, model, tz, { refreshToken: token }),
      { initialProps: { sel: saved(), model: 'best_match', tz: 'UTC', token: 0 } },
    );
    await waitFor(() => expect(api.fetchWeather).toHaveBeenCalledTimes(1));

    rerender({ sel: saved(), model: 'best_match', tz: 'UTC', token: 0 }); // new object, same location
    rerender({ sel: saved(), model: 'gfs_seamless', tz: 'UTC', token: 0 });
    rerender({ sel: saved(), model: 'gfs_seamless', tz: 'Asia/Tokyo', token: 0 });
    rerender({ sel: saved(), model: 'gfs_seamless', tz: 'Asia/Tokyo', token: 1 });

    await waitFor(() => expect(api.fetchWeather).toHaveBeenCalledTimes(4));
  });

  it('clears the forecast when nothing is selected', async () => {
    const { result, rerender } = renderHook(({ sel }) => useDrawerForecast(sel, 'best_match', 'UTC'), {
      initialProps: { sel: saved() as Selection | null },
    });
    await waitFor(() => expect(result.current.forecast).toBe(oakForecast));
    rerender({ sel: null });
    expect(result.current.forecast).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('stops loading and keeps the old forecast when a request fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(({ sel }) => useDrawerForecast(sel, 'best_match', 'UTC'), {
      initialProps: { sel: saved() },
    });
    await waitFor(() => expect(result.current.forecast).toBe(oakForecast));
    vi.mocked(api.fetchWeather).mockRejectedValueOnce(new Error('down'));
    rerender({ sel: saved(seattle) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.forecast).toBe(oakForecast);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('useAllWeather (SCRUM-92)', () => {
  it('loads all locations once, reloads on model change, and merges single forecasts', async () => {
    const { result, rerender } = renderHook(({ model }) => useAllWeather(model, 'UTC'), {
      initialProps: { model: 'best_match' },
    });
    await waitFor(() => expect(Object.keys(result.current.weatherMap)).toEqual(['1', '2']));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);

    rerender({ model: 'gfs_seamless' });
    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledTimes(2));

    const updated = makeForecast({ location_id: 1 }, { speed: 30 });
    result.current.put(updated);
    await waitFor(() => expect(result.current.weatherMap[1]).toBe(updated));
    result.current.remove(2);
    await waitFor(() => expect(result.current.weatherMap[2]).toBeUndefined());
  });
});
