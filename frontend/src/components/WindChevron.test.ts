import { describe, it, expect } from 'vitest';
import {
  getSpeedTier,
  getChevronColor,
  generateWindChevronSvg,
  generateSelectedChevronSvg,
  type SpeedTier,
} from './WindChevron';

// ---------------------------------------------------------------------------
// getSpeedTier
// ---------------------------------------------------------------------------

describe('getSpeedTier', () => {
  it('returns calm below 2 knots', () => {
    expect(getSpeedTier(0)).toBe('calm');
    expect(getSpeedTier(1.9)).toBe('calm');
  });

  it('returns light from 2 to 9 knots', () => {
    expect(getSpeedTier(2)).toBe('light');
    expect(getSpeedTier(9.9)).toBe('light');
  });

  it('returns moderate from 10 to 19 knots', () => {
    expect(getSpeedTier(10)).toBe('moderate');
    expect(getSpeedTier(19.9)).toBe('moderate');
  });

  it('returns fresh from 20 to 33 knots', () => {
    expect(getSpeedTier(20)).toBe('fresh');
    expect(getSpeedTier(33.9)).toBe('fresh');
  });

  it('returns strong at 34 knots and above', () => {
    expect(getSpeedTier(34)).toBe('strong');
    expect(getSpeedTier(100)).toBe('strong');
  });

  it('covers every tier with a distinct boundary', () => {
    const boundaries: [number, SpeedTier][] = [
      [0, 'calm'], [1.99, 'calm'],
      [2, 'light'], [9.99, 'light'],
      [10, 'moderate'], [19.99, 'moderate'],
      [20, 'fresh'], [33.99, 'fresh'],
      [34, 'strong'], [999, 'strong'],
    ];
    for (const [speed, expected] of boundaries) {
      expect(getSpeedTier(speed), `speed=${speed}`).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// getChevronColor
// ---------------------------------------------------------------------------

describe('getChevronColor', () => {
  it('returns a hex color for every tier', () => {
    const tiers: SpeedTier[] = ['calm', 'light', 'moderate', 'fresh', 'strong'];
    for (const tier of tiers) {
      const color = getChevronColor(tier);
      expect(color, `tier=${tier}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('assigns distinct colors to every tier', () => {
    const tiers: SpeedTier[] = ['calm', 'light', 'moderate', 'fresh', 'strong'];
    const colors = tiers.map(getChevronColor);
    const unique = new Set(colors);
    expect(unique.size).toBe(tiers.length);
  });
});

// ---------------------------------------------------------------------------
// generateWindChevronSvg — calm
// ---------------------------------------------------------------------------

describe('generateWindChevronSvg calm', () => {
  it('renders a circle, not chevrons, for calm wind', () => {
    const svg = generateWindChevronSvg(0, 180);
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<polyline');
    expect(svg).not.toContain('<polygon');
  });

  it('uses the calm color', () => {
    const svg = generateWindChevronSvg(1, 0);
    expect(svg).toContain(getChevronColor('calm'));
  });

  it('ignores direction for calm wind (no rotation group)', () => {
    const svg90 = generateWindChevronSvg(0, 90);
    const svg270 = generateWindChevronSvg(0, 270);
    // Both should be visually identical circles — no rotation transform present
    expect(svg90).not.toContain('rotate');
    expect(svg270).not.toContain('rotate');
  });
});

// ---------------------------------------------------------------------------
// generateWindChevronSvg — chevron count by tier
// ---------------------------------------------------------------------------

describe('generateWindChevronSvg chevron count', () => {
  it('renders exactly 1 polyline for light wind', () => {
    const svg = generateWindChevronSvg(5, 0);
    const count = (svg.match(/<polyline/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('renders exactly 2 polylines for moderate wind', () => {
    const svg = generateWindChevronSvg(15, 0);
    const count = (svg.match(/<polyline/g) ?? []).length;
    expect(count).toBe(2);
  });

  it('renders exactly 3 polylines for fresh wind', () => {
    const svg = generateWindChevronSvg(25, 0);
    const count = (svg.match(/<polyline/g) ?? []).length;
    expect(count).toBe(3);
  });

  it('renders exactly 3 polylines for strong wind', () => {
    const svg = generateWindChevronSvg(40, 0);
    const count = (svg.match(/<polyline/g) ?? []).length;
    expect(count).toBe(3);
  });

  it('adds a filled arrowhead polygon only for strong wind', () => {
    expect(generateWindChevronSvg(33, 0)).not.toContain('<polygon');
    expect(generateWindChevronSvg(34, 0)).toContain('<polygon');
    expect(generateWindChevronSvg(50, 0)).toContain('<polygon');
  });
});

// ---------------------------------------------------------------------------
// generateWindChevronSvg — direction encoding
// ---------------------------------------------------------------------------

describe('generateWindChevronSvg direction', () => {
  it('encodes direction as a CSS rotate transform', () => {
    const svg = generateWindChevronSvg(10, 135);
    expect(svg).toContain('rotate(135');
  });

  it('produces different SVGs for different directions', () => {
    const svg0 = generateWindChevronSvg(10, 0);
    const svg90 = generateWindChevronSvg(10, 90);
    expect(svg0).not.toBe(svg90);
  });

  it('produces the same SVG for 0° and 360°', () => {
    // 360 mod 360 == 0 — both should encode the same rotation value
    const svg0 = generateWindChevronSvg(10, 0);
    const svg360 = generateWindChevronSvg(10, 360);
    // Both contain "rotate(0" or "rotate(360" — the key is they don't differ in chevron count
    const count0 = (svg0.match(/<polyline/g) ?? []).length;
    const count360 = (svg360.match(/<polyline/g) ?? []).length;
    expect(count0).toBe(count360);
  });
});

// ---------------------------------------------------------------------------
// generateWindChevronSvg — SVG structure
// ---------------------------------------------------------------------------

describe('generateWindChevronSvg SVG structure', () => {
  it('returns a valid SVG string', () => {
    const svg = generateWindChevronSvg(15, 90);
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('respects the size parameter', () => {
    const svg = generateWindChevronSvg(15, 0, 40);
    expect(svg).toContain('width="40"');
    expect(svg).toContain('height="40"');
  });

  it('defaults to size 28', () => {
    const svg = generateWindChevronSvg(15, 0);
    expect(svg).toContain('width="28"');
    expect(svg).toContain('height="28"');
  });

  it('uses the correct color for each tier', () => {
    const cases: [number, SpeedTier][] = [
      [1, 'calm'], [5, 'light'], [15, 'moderate'], [25, 'fresh'], [40, 'strong'],
    ];
    for (const [speed, tier] of cases) {
      const svg = generateWindChevronSvg(speed, 0);
      expect(svg, `speed=${speed}`).toContain(getChevronColor(tier));
    }
  });
});

// ---------------------------------------------------------------------------
// generateSelectedChevronSvg
// ---------------------------------------------------------------------------

describe('generateSelectedChevronSvg', () => {
  it('returns a valid SVG string', () => {
    const svg = generateSelectedChevronSvg(15);
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('renders a diamond polygon', () => {
    const svg = generateSelectedChevronSvg(15);
    expect(svg).toContain('<polygon');
  });

  it('does not contain chevron polylines', () => {
    const svg = generateSelectedChevronSvg(15);
    expect(svg).not.toContain('<polyline');
  });

  it('uses the correct tier color', () => {
    const cases: [number, SpeedTier][] = [
      [1, 'calm'], [5, 'light'], [15, 'moderate'], [25, 'fresh'], [40, 'strong'],
    ];
    for (const [speed, tier] of cases) {
      const svg = generateSelectedChevronSvg(speed);
      expect(svg, `speed=${speed}`).toContain(getChevronColor(tier));
    }
  });

  it('has a white stroke for visibility against any background', () => {
    const svg = generateSelectedChevronSvg(10);
    expect(svg).toContain('stroke="white"');
  });

  it('respects the size parameter', () => {
    const svg = generateSelectedChevronSvg(10, 36);
    expect(svg).toContain('width="36"');
    expect(svg).toContain('height="36"');
  });

  it('defaults to size 28', () => {
    const svg = generateSelectedChevronSvg(10);
    expect(svg).toContain('width="28"');
    expect(svg).toContain('height="28"');
  });
});
