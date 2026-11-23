import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForecastTimeSelector } from './ForecastTimeSelector';
import type { WeatherModelInfo } from '../types';

const NOW = new Date('2026-11-23T12:34:00Z');

const gfs: WeatherModelInfo = {
  id: 'gfs_seamless',
  name: 'NOAA GFS Seamless',
  update_hours: 6,
  update_cycles_utc: [0, 6, 12, 18],
  horizon_hours: 12,
  last_run_utc: '2026-11-23T12:00:00Z',
  next_run_utc: '2026-11-23T18:00:00Z',
};

function renderSelector(overrides: Partial<React.ComponentProps<typeof ForecastTimeSelector>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ForecastTimeSelector
      model={gfs}
      forecastTime={null}
      onChange={onChange}
      timezone="UTC"
      now={NOW}
      {...overrides}
    />,
  );
  return { onChange, ...utils };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ForecastTimeSelector (SCRUM-127)', () => {
  it('shows the model, its cadence, horizon and run times', () => {
    renderSelector();
    expect(screen.getByTestId('forecast-model-info').textContent).toBe(
      'NOAA GFS Seamless · every 6 h · 0.5 days · run 12:00 UTC (next 18:00 UTC)',
    );
  });

  it('starts at now, in the user timezone, with a slider spanning the horizon', () => {
    renderSelector();
    expect(screen.getByTestId('forecast-time-label').textContent).toBe('Mon 23 Nov 12:00 UTC');
    const slider = screen.getByRole('slider', { name: 'Forecast time' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Mon 23 Nov 12:00 UTC');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('12'); // 12 h horizon, hourly steps
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });

  it('steps with the arrows and the keyboard, snapping to whole hours', () => {
    const { onChange } = renderSelector();
    fireEvent.click(screen.getByLabelText('Next hour'));
    expect(onChange).toHaveBeenLastCalledWith('2026-11-23T13:00:00.000Z');

    const slider = screen.getByRole('slider', { name: 'Forecast time' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('2026-11-23T13:00:00.000Z');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('2026-11-24T00:00:00.000Z');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('disables the ends and returns to now with the Now button', () => {
    const { onChange } = renderSelector({ forecastTime: '2026-11-24T00:00:00.000Z' });
    expect((screen.getByLabelText('Next hour') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Previous hour') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Now'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('plays 3 hours per tick, waits while loading, and stops at the end', () => {
    const { onChange, rerender } = renderSelector({ forecastTime: '2026-11-23T12:00:00.000Z' });
    fireEvent.click(screen.getByLabelText('Play forecast'));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).toHaveBeenLastCalledWith('2026-11-23T15:00:00.000Z');

    // A loading step holds play back.
    rerender(
      <ForecastTimeSelector
        model={gfs}
        forecastTime="2026-11-23T15:00:00.000Z"
        onChange={onChange}
        timezone="UTC"
        now={NOW}
        loading
      />,
    );
    onChange.mockClear();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onChange).not.toHaveBeenCalled();

    // Last step: play stops instead of running past the window.
    rerender(
      <ForecastTimeSelector
        model={gfs}
        forecastTime="2026-11-24T00:00:00.000Z"
        onChange={onChange}
        timezone="UTC"
        now={NOW}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to a loading label and a short window before the models arrive', () => {
    renderSelector({ model: null });
    expect(screen.getByTestId('forecast-model-info').textContent).toBe('Loading the forecast window…');
    expect(screen.getByRole('slider', { name: 'Forecast time' }).getAttribute('aria-valuemax')).toBe('48');
  });
});
