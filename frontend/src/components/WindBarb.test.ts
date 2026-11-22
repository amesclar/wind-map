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
    const svg = generateWindBarbSvg({ speedKnots: 0, directionDeg: 0, tempF: 55 });
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<line');
  });

  it('renders calm barb for 1 knot', () => {
    const svg = generateWindBarbSvg({ speedKnots: 1, directionDeg: 180, tempF: 55 });
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
    const svg = generateWindBarbSvg({ speedKnots: 5, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
    const lineCount = (svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(2);
  });

  it('renders a full barb for 10 knots', () => {
    // 10 kt → staff line + 1 full-barb line = 2 lines total
    const svg = generateWindBarbSvg({ speedKnots: 10, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
    const lineCount = (svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(2);
  });

  it('renders a pennant for 50 knots', () => {
    const svg = generateWindBarbSvg({ speedKnots: 50, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
    expect(svg).toContain('<polygon');
  });

  it('renders two pennants for 100 knots', () => {
    const svg = generateWindBarbSvg({ speedKnots: 100, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
    const pennantCount = (svg.match(/<polygon/g) ?? []).length;
    expect(pennantCount).toBe(2);
  });

  it('renders pennant + full barb for 60 knots', () => {
    const svg = generateWindBarbSvg({ speedKnots: 60, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
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
    const svg = generateWindBarbSvg({ speedKnots: 15, directionDeg: 90, tempF: 55, size: 44, showLabel: false });
    expect(svg).toContain('rotate(90');
  });

  it('produces different SVGs for N vs S wind', () => {
    const north = generateWindBarbSvg({ speedKnots: 15, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
    const south = generateWindBarbSvg({ speedKnots: 15, directionDeg: 180, tempF: 55, size: 44, showLabel: false });
    expect(north).not.toBe(south);
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — label
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg label', () => {
  it('shows a temperature label when showLabel is true', () => {
    const svg = generateWindBarbSvg({ speedKnots: 10, directionDeg: 0, tempF: 55, size: 44, showLabel: true });
    expect(svg).toContain('<text');
  });

  it('omits the label when showLabel is false', () => {
    const svg = generateWindBarbSvg({ speedKnots: 10, directionDeg: 0, tempF: 55, size: 44, showLabel: false });
    expect(svg).not.toContain('<text');
  });

  it('shows temperature in the label', () => {
    const svg = generateWindBarbSvg({ speedKnots: 10, directionDeg: 0, tempF: 55, size: 44, showLabel: true });
    expect(svg).toContain('55');
  });

  it('calm barb still shows label when requested', () => {
    const svg = generateWindBarbSvg({ speedKnots: 0, directionDeg: 0, tempF: 55, size: 44, showLabel: true });
    expect(svg).toContain('<text');
  });
});

// ---------------------------------------------------------------------------
// generateWindBarbSvg — SVG structure
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg structure', () => {
  it('returns a valid SVG string', () => {
    const svg = generateWindBarbSvg({ speedKnots: 15, directionDeg: 90, tempF: 55, size: 44, showLabel: false });
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('respects the size parameter', () => {
    const svg = generateWindBarbSvg({ speedKnots: 15, directionDeg: 0, tempF: 55, size: 60, showLabel: false });
    expect(svg).toContain('width="60"');
    expect(svg).toContain('height="60"');
  });

  it('defaults to size 44', () => {
    const svg = generateWindBarbSvg({ speedKnots: 15, directionDeg: 0, tempF: 55 });
    expect(svg).toContain('width="44"');
    expect(svg).toContain('height="44"');
  });

  it('uses temperature-matched color', () => {
    const svg = generateWindBarbSvg({ speedKnots: 10, directionDeg: 0, tempF: 32, size: 44, showLabel: false });
    expect(svg).toContain('#60a5fa');
  });
});

// ---------------------------------------------------------------------------
// colorOverride (SCRUM-89)
// ---------------------------------------------------------------------------

describe('generateWindBarbSvg colorOverride', () => {
  it('uses the override color instead of the temperature color', () => {
    const svg = generateWindBarbSvg({
      speedKnots: 15,
      directionDeg: 90,
      tempF: 100,
      size: 32,
      showLabel: false,
      colorOverride: '#4ade80',
    });
    expect(svg).toContain('#4ade80');
    expect(svg).not.toContain(getTemperatureColor(100));
  });

  it('keeps the same geometry with and without an override', () => {
    const strip = (s: string) => s.replace(/#[0-9a-f]{6}/gi, 'C');
    expect(
      strip(
        generateWindBarbSvg({
          speedKnots: 27,
          directionDeg: 305,
          tempF: 50,
          size: 40,
          showLabel: false,
          colorOverride: '#4ade80',
        })
      )
    ).toBe(
      strip(
        generateWindBarbSvg({
          speedKnots: 27,
          directionDeg: 305,
          tempF: 50,
          size: 40,
          showLabel: false,
        })
      )
    );
  });
});
