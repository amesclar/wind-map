import { describe, expect, it } from 'vitest';
import { CURRENT_TIERS, CURRENT_TIER_OUTLINE, currentTier, tierRangeLabel } from './currentTiers';
import { blendWindColor } from './windColorScale';
import { WIND_COLOR_OPACITY, WIND_COLOR_OPACITY_ON_CHART } from '../components/WindColorOverlay';

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const channelLuminance = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

/** WCAG 2.x contrast ratio; 3:1 is the graphics floor (WCAG 1.4.11). */
const contrastRatio = (a: Rgb, b: Rgb) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

/** The wind gradient as it is painted: its colour at `alpha` over the base map's water. */
const over = (foreground: Rgb, background: Rgb, alpha: number): Rgb => [
  Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
  Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
  Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
];

describe('currentTier (SCRUM-99)', () => {
  it('uses the documented thresholds', () => {
    expect(currentTier(0).id).toBe('light');
    expect(currentTier(0.49).id).toBe('light');
    expect(currentTier(0.5).id).toBe('moderate');
    expect(currentTier(1.49).id).toBe('moderate');
    expect(currentTier(1.5).id).toBe('strong');
    expect(currentTier(2.99).id).toBe('strong');
    expect(currentTier(3).id).toBe('extreme');
    expect(currentTier(6).id).toBe('extreme');
  });

  it('treats a missing or negative speed as light', () => {
    expect(currentTier(-1).id).toBe('light');
    expect(currentTier(Number.NaN).id).toBe('light');
  });

  it('keeps one chevron only for light water and marks the top two tiers bold', () => {
    expect(CURRENT_TIERS.map((tier) => [tier.id, tier.chevrons, tier.bold])).toEqual([
      ['light', 1, false],
      ['moderate', 2, false],
      ['strong', 2, true],
      ['extreme', 2, true],
    ]);
  });

  it('has one fully opaque colour per tier', () => {
    expect(CURRENT_TIERS.map((tier) => tier.color)).toEqual(['#e0f2fe', '#67e8f9', '#ffffff', '#ff9ceb']);
    for (const tier of CURRENT_TIERS) expect('opacity' in tier).toBe(false);
  });

  it('gives the legend a range per tier, converted to the speed unit', () => {
    expect(CURRENT_TIERS.map((tier) => tierRangeLabel(tier, 'knots'))).toEqual([
      '0–0.5',
      '0.5–1.5',
      '1.5–3',
      '3+',
    ]);
    expect(tierRangeLabel(CURRENT_TIERS[0], 'kmh')).toBe('0–0.9');
    expect(tierRangeLabel(CURRENT_TIERS[3], 'kmh')).toBe('5.6+');
  });
});

/**
 * SCRUM-237: every chevron is an opaque tier fill over a dark rim, so on any background at least
 * one of the two clears the 3:1 graphics floor. The chevrons sit above the wind gradient pane, so
 * the gradient is composited over the base water at both overlay opacities.
 */
describe('current tier contrast (SCRUM-237)', () => {
  // Water colours under the chevrons, measured on the four bases: the two dark bases render water
  // within a few levels of #262626, OpenStreetMap's standard water is #aad3df, and the NOAA paper
  // chart's water is white. Seamap is a light sheet too, so the OSM water colour covers it.
  const BASE_WATER = [
    { name: 'dark base', hex: '#262626' },
    { name: 'OSM standard water', hex: '#aad3df' },
    { name: 'paper chart water', hex: '#ffffff' },
  ];
  const GRADIENT_KNOTS = [0, 5, 10, 15, 20, 25];

  const backgrounds = BASE_WATER.flatMap(({ name, hex }) => {
    const base = toRgb(hex);
    return [
      { name, color: base },
      ...GRADIENT_KNOTS.flatMap((knots) =>
        [WIND_COLOR_OPACITY, WIND_COLOR_OPACITY_ON_CHART].map((opacity) => ({
          name: `${name}, wind gradient ${knots} kn at ${opacity}`,
          color: over(blendWindColor(knots), base, opacity),
        })),
      ),
    ];
  });

  it('keeps every tier at 3:1 or better against every base and gradient colour', () => {
    const outline = toRgb(CURRENT_TIER_OUTLINE);
    for (const tier of CURRENT_TIERS) {
      const fill = toRgb(tier.color);
      for (const background of backgrounds) {
        const visible = Math.max(
          contrastRatio(fill, background.color),
          contrastRatio(outline, background.color),
        );
        expect(visible, `${tier.id} on ${background.name}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('separates every tier fill from its outline', () => {
    const outline = toRgb(CURRENT_TIER_OUTLINE);
    for (const tier of CURRENT_TIERS) {
      expect(contrastRatio(toRgb(tier.color), outline), tier.id).toBeGreaterThanOrEqual(3);
    }
  });
});
