import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurrentLegend } from './CurrentLegend';
import { CURRENT_TIERS } from '../utils/currentTiers';

const swatches = () =>
  CURRENT_TIERS.map((tier) => screen.getByTestId(`current-legend-${tier.id}`).textContent);

describe('CurrentLegend (SCRUM-100)', () => {
  it('labels the four tiers with their knot ranges', () => {
    render(<CurrentLegend speedUnit="knots" />);

    expect(swatches()).toEqual(['0–0.5', '0.5–1.5', '1.5–3', '3+']);
    expect(screen.getByTestId('current-legend').getAttribute('role')).toBe('img');
    expect(screen.getByTestId('current-legend').getAttribute('aria-label')).toBe(
      'Water current speed scale in kt: light, moderate, strong and extreme',
    );
  });

  it('converts the ranges into the chosen speed unit', () => {
    const { unmount } = render(<CurrentLegend speedUnit="kmh" />);
    expect(swatches()).toEqual(['0–0.9', '0.9–2.8', '2.8–5.6', '5.6+']);
    unmount();

    render(<CurrentLegend speedUnit="mph" />);
    expect(swatches()).toEqual(['0–0.6', '0.6–1.7', '1.7–3.5', '3.5+']);
  });

  it('shows one swatch per tier in the tier colour', () => {
    const { container } = render(<CurrentLegend speedUnit="knots" />);

    const dots = [...container.querySelectorAll('[aria-hidden="true"]')] as HTMLElement[];
    expect(dots).toHaveLength(CURRENT_TIERS.length);
    expect(dots.map((dot) => dot.style.backgroundColor)).toEqual([
      'rgb(56, 189, 248)',
      'rgb(6, 182, 212)',
      'rgb(2, 132, 199)',
      'rgb(245, 158, 11)',
    ]);
  });

  it('never takes pointer events, so it cannot block the map', () => {
    render(<CurrentLegend speedUnit="knots" />);

    expect(screen.getByTestId('current-legend').className).toContain('pointer-events-none');
  });
});
