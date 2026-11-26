import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MAP_KEY_ORIENTATION, MAP_KEY_WIND_COLOR, MAP_KEY_WIND_KNOTS, MapLegend } from './MapLegend';
import { CURRENT_TIERS } from '../utils/currentTiers';
import { WAVE_TIERS } from '../utils/waveTiers';

vi.mock('leaflet', () => import('../test/leafletMock'));

const ranges = (prefix: string, ids: readonly string[]) =>
  ids.map((id) => screen.getByTestId(`${prefix}-${id}`).textContent?.trim());

describe('MapLegend (SCRUM-263)', () => {
  it('always shows the wind examples in one neutral grey, because colour is temperature', () => {
    const { container } = render(<MapLegend speedUnit="knots" unitSystem="metric" />);

    expect(MAP_KEY_WIND_KNOTS).toEqual([5, 15, 35]);
    const glyphs = [...container.querySelectorAll<SVGElement>('[data-testid^="map-legend-wind-"] svg')];
    expect(glyphs).toHaveLength(3);
    expect(glyphs.every((glyph) => glyph.innerHTML.includes(MAP_KEY_WIND_COLOR))).toBe(true);
    expect(screen.getByTestId('map-legend-wind-5').textContent?.trim()).toBe('5');
    expect(screen.getByTestId('map-legend-wind-direction').textContent?.trim()).toBe(
      MAP_KEY_ORIENTATION.wind,
    );
    expect(screen.getByTestId('map-legend-wind-note').textContent).toContain('colour = temperature');
    expect(screen.getByTestId('map-legend').textContent).toContain('Map key');
    expect(screen.getByTestId('map-legend').textContent).toContain('Wind (kt)');
  });

  it('draws the three wind glyphs additively: half barb, full plus half, three fulls plus half', () => {
    const { container } = render(<MapLegend speedUnit="knots" unitSystem="metric" />);
    const glyph = (knots: number) =>
      container.querySelector<SVGElement>(`[data-testid="map-legend-wind-${knots}"] svg`)!.innerHTML;
    const lines = (markup: string) => (markup.match(/<line /g) ?? []).length;

    expect(lines(glyph(5))).toBeLessThan(lines(glyph(15)));
    expect(lines(glyph(15))).toBeLessThan(lines(glyph(35)));
    // 35 kt is three full barbs and a half, not gale strength: no pennant in the key.
    expect(glyph(35)).not.toContain('<polygon');
  });

  it('lists only the layers that are on', () => {
    const { unmount } = render(<MapLegend speedUnit="knots" unitSystem="metric" />);
    expect(screen.queryByTestId('map-legend-currents')).toBeNull();
    expect(screen.queryByTestId('map-legend-waves')).toBeNull();
    expect(screen.getByTestId('map-legend').getAttribute('aria-label')).toBe(
      `Map key: wind barbs in knots, ${MAP_KEY_ORIENTATION.wind}, coloured by temperature`,
    );
    unmount();

    render(<MapLegend speedUnit="knots" unitSystem="metric" currents waves />);
    expect(screen.getByTestId('map-legend-currents')).toBeTruthy();
    expect(screen.getByTestId('map-legend-waves')).toBeTruthy();
    expect(screen.getByTestId('map-legend').getAttribute('aria-label')).toBe(
      `Map key: wind barbs in knots, ${MAP_KEY_ORIENTATION.wind}, coloured by temperature; currents in kt, ${MAP_KEY_ORIENTATION.currents}; wave heights in m, ${MAP_KEY_ORIENTATION.waves}`,
    );
  });

  it('draws a real chevron per current tier with its range in the speed unit', () => {
    const { container } = render(<MapLegend speedUnit="knots" unitSystem="metric" currents />);

    expect(ranges('map-legend-current', CURRENT_TIERS.map((tier) => tier.id))).toEqual([
      '0–0.5',
      '0.5–1.5',
      '1.5–3',
      '3+',
    ]);
    expect(screen.getByTestId('map-legend-currents').textContent).toContain('Currents (kt)');
    const glyphs = [...container.querySelectorAll<SVGElement>('[data-testid^="map-legend-current-"] svg')];
    expect(glyphs).toHaveLength(CURRENT_TIERS.length);
    expect(glyphs[0].innerHTML).toContain('#e0f2fe');
    expect(glyphs[3].innerHTML).toContain('#ff9ceb');
  });

  it('converts the current ranges into the chosen speed unit', () => {
    const { unmount } = render(<MapLegend speedUnit="kmh" unitSystem="metric" currents />);
    expect(ranges('map-legend-current', CURRENT_TIERS.map((tier) => tier.id))).toEqual([
      '0–0.9',
      '0.9–2.8',
      '2.8–5.6',
      '5.6+',
    ]);
    unmount();

    render(<MapLegend speedUnit="mph" unitSystem="metric" currents />);
    expect(ranges('map-legend-current', CURRENT_TIERS.map((tier) => tier.id))).toEqual([
      '0–0.6',
      '0.6–1.7',
      '1.7–3.5',
      '3.5+',
    ]);
  });

  it('draws a real arrow per wave tier with its range in the user’s unit', () => {
    const { container, rerender } = render(<MapLegend speedUnit="knots" unitSystem="metric" waves />);

    expect(ranges('map-legend-wave', WAVE_TIERS.map((tier) => tier.id))).toEqual([
      '0–1 m',
      '1–2 m',
      '2–4 m',
      '4+ m',
    ]);
    const glyphs = [...container.querySelectorAll<SVGElement>('[data-testid^="map-legend-wave-"] svg')];
    expect(glyphs).toHaveLength(WAVE_TIERS.length);
    expect(glyphs[3].innerHTML).toContain('#ef4444');

    rerender(<MapLegend speedUnit="knots" unitSystem="imperial" waves />);
    expect(ranges('map-legend-wave', WAVE_TIERS.map((tier) => tier.id))).toEqual([
      '0–3 ft',
      '3–6 ft',
      '6–13 ft',
      '13+ ft',
    ]);
    expect(screen.getByTestId('map-legend-waves').textContent).toContain('Waves (ft)');
  });

  it('says what the orientation of each layer means (SCRUM-294)', () => {
    const { unmount } = render(<MapLegend speedUnit="knots" unitSystem="metric" />);

    // Wind is always on, so its explanation always is too; the other rows wait for their layer.
    expect(screen.getByTestId('map-legend-wind-direction').textContent?.trim()).toBe(
      MAP_KEY_ORIENTATION.wind,
    );
    expect(screen.queryByTestId('map-legend-currents-note')).toBeNull();
    expect(screen.queryByTestId('map-legend-waves-note')).toBeNull();
    unmount();

    render(<MapLegend speedUnit="knots" unitSystem="metric" currents waves />);
    expect(screen.getByTestId('map-legend-currents-note').textContent?.trim()).toBe(
      MAP_KEY_ORIENTATION.currents,
    );
    expect(screen.getByTestId('map-legend-waves-note').textContent?.trim()).toBe(
      MAP_KEY_ORIENTATION.waves,
    );
  });

  it('never takes pointer events, so it cannot block the map', () => {
    render(<MapLegend speedUnit="knots" unitSystem="metric" currents waves />);

    expect(screen.getByTestId('map-legend').className).toContain('pointer-events-none');
  });
});
