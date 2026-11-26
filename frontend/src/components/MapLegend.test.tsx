import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAP_KEY_GLYPH_PX,
  MAP_KEY_ORIENTATION,
  MAP_KEY_WIND_COLOR,
  MAP_KEY_WIND_GLYPH_PX,
  MAP_KEY_WIND_KNOTS,
  MapLegend,
} from './MapLegend';
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

  it('puts each wind value beside its glyph, like the currents row (SCRUM-303)', () => {
    render(<MapLegend speedUnit="knots" unitSystem="metric" />);

    MAP_KEY_WIND_KNOTS.forEach((knots) => {
      const item = screen.getByTestId(`map-legend-wind-${knots}`);

      // One row per example: the glyph, then its value, not a stacked column.
      expect(item.className).toContain('items-center');
      expect(item.className).not.toContain('flex-col');
      expect(item.querySelectorAll(':scope > *')).toHaveLength(2);
      expect(item.querySelector('svg')).toBeTruthy();
      expect(item.lastElementChild?.textContent).toBe(String(knots));
      // The glyph keeps a fixed slot, so its value starts at the same offset every time.
      expect(item.firstElementChild?.className).toContain('shrink-0');
    });

    // The row packs its examples rather than holding columns open.
    const row = screen.getByTestId('map-legend-wind');
    expect(row.className).toContain('flex-wrap');
  });

  it('gives every glyph a fixed slot so its value sits against it (SCRUM-304, SCRUM-305)', () => {
    render(<MapLegend speedUnit="knots" unitSystem="metric" currents waves />);

    for (const rowId of ['map-legend-wind', 'map-legend-currents', 'map-legend-waves']) {
      const block = screen.getByTestId(rowId);
      // Wind's test id is the row itself; the other two sit on the block that holds the heading.
      const row = block.className.includes('flex-wrap')
        ? block
        : block.querySelector<HTMLElement>('.flex-wrap');

      expect(row).toBeTruthy();
      [...block.querySelectorAll('svg')].forEach((svg) => {
        expect(svg.parentElement?.className).toContain('shrink-0');
      });
    }

    // The waves glyphs are cropped to their own ink, so their widths differ instead of each
    // sitting in a 20 px box with its value floating away from the line.
    const waveWidths = [...screen.getByTestId('map-legend-waves').querySelectorAll('svg')].map(
      (svg) => Number(svg.getAttribute('width')),
    );
    expect(new Set(waveWidths).size).toBe(4);
    expect(Math.max(...waveWidths)).toBeLessThan(MAP_KEY_GLYPH_PX);
  });

  it('draws the wind barbs larger than the other key glyphs (SCRUM-304)', () => {
    const { container } = render(<MapLegend speedUnit="knots" unitSystem="metric" />);
    const barb = container.querySelector('[data-testid="map-legend-wind-5"] svg')!;

    expect(MAP_KEY_WIND_GLYPH_PX).toBeGreaterThan(MAP_KEY_GLYPH_PX);
    expect(MAP_KEY_WIND_GLYPH_PX).toBe(28);
    expect(barb.getAttribute('width')).toBe(String(MAP_KEY_WIND_GLYPH_PX));
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

  it('keeps the card wide and the type at 10 px so no row wraps (SCRUM-296)', () => {
    const { container } = render(<MapLegend speedUnit="knots" unitSystem="imperial" currents waves />);
    const card = screen.getByTestId('map-legend');

    expect(card.className).toContain('max-w-[300px]');
    expect(card.className).toContain('pointer-events-none');
    // Every piece of key type moved up one step with the card; none may drift back to 9 px.
    expect(container.innerHTML).toContain('text-[10px]');
    expect(container.innerHTML).not.toContain('text-[9px]');
    expect(screen.getByTestId('map-legend-waves').textContent).toContain('13+ ft');
  });

  it('never takes pointer events, so it cannot block the map', () => {
    render(<MapLegend speedUnit="knots" unitSystem="metric" currents waves />);

    expect(screen.getByTestId('map-legend').className).toContain('pointer-events-none');
  });
});
