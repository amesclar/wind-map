import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import { WaveOverlay, clearWaveSeriesCache } from './WaveOverlay';
import { markerAt, resetLeafletMock } from '../test/leafletMock';
import * as api from '../api/client';
import type { WavePoint } from '../types';

vi.mock('leaflet', () => import('../test/leafletMock'));
vi.mock('../api/client', () => ({ fetchPointWaves: vi.fn() }));

const POINT: WavePoint = {
  latitude: 48.29,
  longitude: -122.65,
  height_m: 1.6,
  direction_deg: 240,
  period_s: 8,
};

const series = (count: number) => ({
  latitude: POINT.latitude,
  longitude: POINT.longitude,
  horizon_hours: 240,
  points: Array.from({ length: count }, (_, index) => ({
    time: `2026-11-26T${String(index % 24).padStart(2, '0')}:00`,
    height_m: 1.6,
    direction_deg: 240,
    period_s: 8,
  })),
});

beforeEach(() => {
  resetLeafletMock();
  clearWaveSeriesCache();
  vi.mocked(api.fetchPointWaves).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('WaveOverlay (SCRUM-234)', () => {
  it('draws an arrow per point with the summary and a loading row', () => {
    render(<WaveOverlay map={{} as L.Map} points={[POINT]} unitSystem="imperial" timeLabel="Mon 12:00 PST" />);

    const marker = markerAt(POINT.latitude, POINT.longitude)!;
    expect(marker).toBeTruthy();
    expect(marker.popupHtml).toContain('5.2 ft');
    expect(marker.popupHtml).toContain('SW (240°) from');
    expect(marker.popupHtml).toContain('Loading the next 48 h');
    expect(api.fetchPointWaves).not.toHaveBeenCalled(); // nothing until a click
  });

  it('fills the pop-up with the next 48 hours when it opens, and caches them', async () => {
    vi.mocked(api.fetchPointWaves).mockResolvedValue(series(48));
    render(<WaveOverlay map={{} as L.Map} points={[POINT]} />);

    const marker = markerAt(POINT.latitude, POINT.longitude)!;
    marker.fire('popupopen');

    await waitFor(() => expect(marker.popupHtml).toContain('data-wave-count="48"'));
    expect(marker.popupHtml).toContain('11-26 00:00');
    expect(api.fetchPointWaves).toHaveBeenCalledWith(POINT.latitude, POINT.longitude);

    marker.fire('popupopen');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.fetchPointWaves).toHaveBeenCalledTimes(1); // served from the cache
  });

  it('keeps the summary and says so when the series fails, then retries next click', async () => {
    vi.mocked(api.fetchPointWaves).mockRejectedValueOnce(new Error('upstream down'));
    render(<WaveOverlay map={{} as L.Map} points={[POINT]} unitSystem="metric" />);

    const marker = markerAt(POINT.latitude, POINT.longitude)!;
    marker.fire('popupopen');

    await waitFor(() => expect(marker.popupHtml).toContain('Hourly wave data unavailable'));
    expect(marker.popupHtml).toContain('1.6 m');

    vi.mocked(api.fetchPointWaves).mockResolvedValue(series(48));
    marker.fire('popupopen');
    await waitFor(() => expect(marker.popupHtml).toContain('data-wave-count="48"'));
    expect(api.fetchPointWaves).toHaveBeenCalledTimes(2);
  });
});
