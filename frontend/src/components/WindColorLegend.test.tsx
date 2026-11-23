import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEGEND_HEIGHT_PX,
  LEGEND_Z_INDEX,
  legendTicks,
  NARROW_LEGEND_PX,
  WindColorLegend,
} from './WindColorLegend';
import { WIND_COLOR_PANE_Z_INDEX } from './WindColorOverlay';
import { MAX_WIND_KNOTS } from '../utils/windColorScale';
import { knotsToUnit } from '../utils/units';

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => setWidth(1200));

const ticks = () => screen.getAllByTestId('wind-color-legend-tick').map((el) => el.textContent);

describe('legendTicks (SCRUM-124)', () => {
  it('uses a round step per unit and never runs past the top of the scale', () => {
    expect(legendTicks('knots')).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    for (const unit of ['kmh', 'mph', 'ms'] as const) {
      const values = legendTicks(unit);
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBeLessThanOrEqual(knotsToUnit(MAX_WIND_KNOTS, unit));
      expect(values[values.length - 1]).toBeGreaterThan(knotsToUnit(MAX_WIND_KNOTS, unit) - 10);
    }
    expect(legendTicks('kmh').slice(0, 3)).toEqual([0, 10, 20]);
  });
});

describe('WindColorLegend (SCRUM-124)', () => {
  it('sits above the map attribution as a labelled image with the overlay gradient', () => {
    const { container } = render(<WindColorLegend speedUnit="knots" />);
    const strip = screen.getByTestId('wind-color-legend');
    expect(strip.getAttribute('role')).toBe('img');
    expect(strip.getAttribute('aria-label')).toBe('Wind speed color scale from 0 to 50 kt');
    // Vertical offset is `.wind-color-legend` in index.css: a fixed 24px since the timeline
    // drawer was removed (SCRUM-126).
    expect(strip.className).toContain('wind-color-legend');
    expect(strip.style.bottom).toBe('');
    expect(strip.style.height).toBe(`${LEGEND_HEIGHT_PX}px`);
    expect(strip.className).toContain('pointer-events-none');
    // Above Leaflet's content panes, which hid the strip behind the gradient (SCRUM-168).
    expect(strip.style.zIndex).toBe(String(LEGEND_Z_INDEX));
    expect(LEGEND_Z_INDEX).toBeGreaterThan(WIND_COLOR_PANE_Z_INDEX);
    // Leaflet's popup pane is 700 and its controls are 800 (leaflet.css): visible below the
    // controls, above the pop-ups.
    expect(LEGEND_Z_INDEX).toBeGreaterThan(700);
    expect(LEGEND_Z_INDEX).toBeLessThan(800);

    // jsdom normalizes hex colors to rgb() in computed style strings.
    const bar = container.querySelector('[style*="linear-gradient"]') as HTMLElement;
    expect(bar.style.background).toContain('rgb(159, 1, 200) 0%');
    expect(bar.style.background).toContain('rgb(100, 100, 100) 100%');
  });

  it('labels the ticks in knots and shows the unit once', () => {
    render(<WindColorLegend speedUnit="knots" />);
    expect(ticks()).toEqual(['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50']);
    expect(screen.getByText('kt')).toBeTruthy();
  });

  it('switches to the selected speed unit', () => {
    render(<WindColorLegend speedUnit="kmh" />);
    expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90']);
    expect(screen.getByText('km/h')).toBeTruthy();
    expect(screen.getByTestId('wind-color-legend').getAttribute('aria-label')).toBe(
      'Wind speed color scale from 0 to 93 km/h',
    );
  });

  it('drops every second label on narrow screens and restores them when wide', () => {
    render(<WindColorLegend speedUnit="knots" />);
    expect(ticks()).toHaveLength(11);

    act(() => setWidth(NARROW_LEGEND_PX - 1));
    expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50']);

    act(() => setWidth(NARROW_LEGEND_PX + 100));
    expect(ticks()).toHaveLength(11);
  });
});
