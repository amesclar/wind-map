import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WaveLegend } from './WaveLegend';
import { WAVE_TIERS, WAVE_TIER_OUTLINE } from '../utils/waveTiers';

const swatches = () => WAVE_TIERS.map((tier) => screen.getByTestId(`wave-legend-${tier.id}`).textContent);

describe('WaveLegend (SCRUM-234)', () => {
  it('labels the four tiers in metres for the metric display', () => {
    render(<WaveLegend unitSystem="metric" />);

    expect(swatches()).toEqual(['0–1 m', '1–2 m', '2–4 m', '4+ m']);
    expect(screen.getByTestId('wave-legend').getAttribute('role')).toBe('img');
    expect(screen.getByTestId('wave-legend').getAttribute('aria-label')).toBe(
      'Wave height scale in m: 0–1, 1–2, 2–4 and over 4',
    );
    expect(screen.getByTestId('wave-legend').textContent).toContain('Waves (m)');
  });

  it('switches the ranges and the heading to feet for the imperial display', () => {
    render(<WaveLegend unitSystem="imperial" />);

    expect(swatches()).toEqual(['0–3 ft', '3–6 ft', '6–13 ft', '13+ ft']);
    expect(screen.getByTestId('wave-legend').textContent).toContain('Waves (ft)');
  });

  it('draws one opaque swatch per tier with the arrow outline', () => {
    const { container } = render(<WaveLegend unitSystem="metric" />);

    const dots = [...container.querySelectorAll('[aria-hidden="true"]')] as HTMLElement[];
    expect(dots).toHaveLength(WAVE_TIERS.length);
    expect(dots.map((dot) => dot.style.backgroundColor)).toEqual([
      'rgb(147, 197, 253)',
      'rgb(56, 189, 248)',
      'rgb(245, 158, 11)',
      'rgb(239, 68, 68)',
    ]);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(WAVE_TIER_OUTLINE.slice(i, i + 2), 16));
    expect(dots.every((dot) => dot.style.borderColor === `rgb(${r}, ${g}, ${b})`)).toBe(true);
  });

  it('never takes pointer events, so it cannot block the map', () => {
    render(<WaveLegend unitSystem="metric" />);
    expect(screen.getByTestId('wave-legend').className).toContain('pointer-events-none');
  });
});
