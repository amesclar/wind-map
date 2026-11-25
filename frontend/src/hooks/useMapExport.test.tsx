import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapExportViewOptions } from '../components/mapExportOptions';
import type { WeatherModelInfo } from '../types';
import { useMapExport, VIEW_GRID_TIMEOUT_MS, type MapExportSettings } from './useMapExport';

// The capture itself is covered by captureMap.test and pdfExport.test; only the wait is under test.
vi.mock('../utils/captureMap', () => ({
  captureMapCanvas: vi.fn().mockResolvedValue({ width: 10, height: 10 }),
  saveMapImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/pdfExport', () => ({ saveMapPdf: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/rangeOutput', () => ({
  saveRangeImages: vi.fn().mockResolvedValue(undefined),
  saveRangePdf: vi.fn().mockResolvedValue(undefined),
}));
import { saveMapImage } from '../utils/captureMap';
import { saveMapPdf } from '../utils/pdfExport';

const modelInfo = {
  id: 'best_match',
  name: 'Best Match',
  horizon_hours: 48,
  last_run_utc: null,
} as unknown as WeatherModelInfo;

function settings(overrides: Partial<MapExportSettings> = {}): MapExportSettings {
  return {
    mapContainerRef: { current: document.createElement('div') },
    forecastTime: null,
    setForecastTime: vi.fn(),
    timezone: 'America/Los_Angeles',
    selectedModel: 'best_match',
    selectedModelInfo: modelInfo,
    unitSystem: 'imperial',
    speedUnit: 'knots',
    tileLayer: 'paper_chart',
    windOverlayVisible: true,
    windColorOverlayVisible: false,
    bcDepthVisible: false,
    seamarksVisible: false,
    weatherLoading: false,
    ...overrides,
  };
}

const viewOptions = (format: 'png' | 'pdf' = 'png'): MapExportViewOptions => ({
  mode: 'view',
  format,
  jpegQuality: 0.92,
  pageSize: 'letter',
  orientation: 'portrait',
  fileName: `wind-map_2026-11-25_0800PST.${format}`,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(saveMapImage).mockClear();
  vi.mocked(saveMapPdf).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('current-view export waits for the wind grid (SCRUM-242)', () => {
  it('holds the capture while the grid is in flight and saves once it lands', async () => {
    const { result } = renderHook(() => useMapExport(settings()));
    act(() => result.current.handleGridLoadingChange(true));

    let exported!: Promise<void>;
    await act(async () => {
      exported = result.current.handleExport(viewOptions('png'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(vi.mocked(saveMapImage)).not.toHaveBeenCalled();

    await act(async () => {
      result.current.handleGridLoadingChange(false);
      await vi.advanceTimersByTimeAsync(300);
      await exported;
    });
    expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1);
  });

  it('waits for the grid before a PDF capture too', async () => {
    const { result } = renderHook(() => useMapExport(settings()));
    act(() => result.current.handleGridLoadingChange(true));

    let exported!: Promise<void>;
    await act(async () => {
      exported = result.current.handleExport(viewOptions('pdf'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(vi.mocked(saveMapPdf)).not.toHaveBeenCalled();

    await act(async () => {
      result.current.handleGridLoadingChange(false);
      await vi.advanceTimersByTimeAsync(300);
      await exported;
    });
    expect(vi.mocked(saveMapPdf)).toHaveBeenCalledTimes(1);
  });

  it('captures at once when both grid layers are off', async () => {
    const { result } = renderHook(() =>
      useMapExport(settings({ windOverlayVisible: false, windColorOverlayVisible: false })),
    );
    act(() => result.current.handleGridLoadingChange(true));

    await act(async () => {
      await result.current.handleExport(viewOptions('png'));
    });
    expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1);
  });

  it('waits when only the colour gradient needs the grid', async () => {
    const { result } = renderHook(() =>
      useMapExport(settings({ windOverlayVisible: false, windColorOverlayVisible: true })),
    );
    act(() => result.current.handleGridLoadingChange(true));

    let exported!: Promise<void>;
    await act(async () => {
      exported = result.current.handleExport(viewOptions('png'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(vi.mocked(saveMapImage)).not.toHaveBeenCalled();

    await act(async () => {
      result.current.handleGridLoadingChange(false);
      await vi.advanceTimersByTimeAsync(300);
      await exported;
    });
    expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1);
  });

  it('still saves when the grid never settles', async () => {
    const { result } = renderHook(() => useMapExport(settings()));
    act(() => result.current.handleGridLoadingChange(true));

    let exported!: Promise<void>;
    await act(async () => {
      exported = result.current.handleExport(viewOptions('png'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VIEW_GRID_TIMEOUT_MS + 500);
      await exported;
    });
    expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1);
  });
});
