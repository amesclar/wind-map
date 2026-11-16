import { describe, it, expect } from 'vitest';
import { getTemperatureColor, generateWindBarbSvg } from './WindBarb';

// ---------------------------------------------------------------------------
// getTemperatureColor
// ---------------------------------------------------------------------------

describe('getTemperatureColor', () => {
  it('returns ice blue at or below freezing', () => {
    expect(getTemperatureColor(32)).toBe('#60a5fa');
    expect(getTemperatureColor(0)).toBe('#60a5fa');
    expect(getTemperatureColor(-10)).toBe('#60a5fa');
  });

  it('returns teal between 33 and 50 °F', () => {
    expect(getTemperatureColor(33)).toBe('#2dd4bf');
    expect(getTemperatureColor(50)).toBe('#2dd4bf');
  });

  it('returns fresh green between 51 and 68 °F', () => {
    expect(getTemperatureColor(51)).toBe('#4ade80');
    expect(getTemperatureColor(68)).toBe('#4ade80');
  });

  it('returns warm amber between 69 and 80 °F', () => {
    expect(getTemperatureColor(69)).toBe('#fbbf24');
    expect(getTemperatureColor(80)).toBe('#fbbf24');
  });

  it('returns orange between 81 and 90 °F', () => {
    expect(getTemperatureColor(81)).toBe('#fb923c');
    expect(getTemperatureColor(90)).toBe('#fb923c');
  });

  it('returns red above 90 °F', () => {
    expect(getTemperatureColor(91)).toBe('#ef4444');
    expect(getTemperatureColor(110)).toBe('#ef4444');
  });

  it('returns a hex color for every boundary value', () => {
    const boundaries = [32, 50, 68, 80, 90];
    for (const t of boundaries) {
      expect(getTemperatureColor(t)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — calm conditions (< 2 kt)
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg calm', () => {
  it('renders two concentric circles for calm wind', () => {
    const svg = generateWindBarbSvg(0, 0, 55);
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<line');
  });

  it('renders calm barb for 1 knot', () => {
    const svg = generateWindBarbSvg(1, 180, 55);
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<line');
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — feather calculation
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg feathers', () => {
  it('renders a half barb for 5 knots', () => {
    // 5 kt → staff line + 1 half-barb line = 2 lines total
    const svg = generateWindBarbSvg(5, 0, 55, 44, false);
    const lineCount = (svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(2);
  });

  it('renders a full barb for 10 knots', () => {
    // 10 kt → staff line + 1 full-barb line = 2 lines total
    const svg = generateWindBarbSvg(10, 0, 55, 44, false);
    const lineCount = (svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(2);
  });

  it('renders a pennant for 50 knots', () => {
    const svg = generateWindBarbSvg(50, 0, 55, 44, false);
    expect(svg).toContain('<polygon');
  });

  it('renders two pennants for 100 knots', () => {
    const svg = generateWindBarbSvg(100, 0, 55, 44, false);
    const pennantCount = (svg.match(/<polygon/g) ?? []).length;
    expect(pennantCount).toBe(2);
  });

  it('renders pennant + full barb for 60 knots', () => {
    const svg = generateWindBarbSvg(60, 0, 55, 44, false);
    // 1 pennant (50 kt) + 1 full barb (10 kt)
    expect((svg.match(/<polygon/g) ?? []).length).toBe(1);
    // staff + 1 full-barb line = 2 lines
    expect((svg.match(/<line /g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — direction encoding
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg direction', () => {
  it('encodes direction as a rotate transform', () => {
    const svg = generateWindBarbSvg(15, 90, 55, 44, false);
    expect(svg).toContain('rotate(90');
  });

  it('produces different SVGs for N vs S wind', () => {
    const north = generateWindBarbSvg(15, 0, 55, 44, false);
    const south = generateWindBarbSvg(15, 180, 55, 44, false);
    expect(north).not.toBe(south);
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — label
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg label', () => {
  it('shows a temperature label when showLabel is true', () => {
    const svg = generateWindBarbSvg(10, 0, 55, 44, true);
    expect(svg).toContain('<text');
  });

  it('omits the label when showLabel is false', () => {
    const svg = generateWindBarbSvg(10, 0, 55, 44, false);
    expect(svg).not.toContain('<text');
  });

  it('shows temperature in the label', () => {
    const svg = generateWindBarbSvg(10, 0, 55, 44, true);
    expect(svg).toContain('55');
  });

  it('calm barb still shows label when requested', () => {
    const svg = generateWindBarbSvg(0, 0, 55, 44, true);
    expect(svg).toContain('<text');
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — SVG structure
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg structure', () => {
  it('returns a valid SVG string', () => {
    const svg = generateWindBarbSvg(15, 90, 55, 44, false);
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('respects the size parameter', () => {
    const svg = generateWindBarbSvg(15, 0, 55, 60, false);
    expect(svg).toContain('width="60"');
    expect(svg).toContain('height="60"');
  });

  it('defaults to size 44', () => {
    const svg = generateWindBarbSvg(15, 0, 55);
    expect(svg).toContain('width="44"');
    expect(svg).toContain('height="44"');
  });

  it('uses temperature-matched color', () => {
    const svg = generateWindBarbSvg(10, 0, 32, 44, false);
    expect(svg).toContain('#60a5fa');
  });
});
