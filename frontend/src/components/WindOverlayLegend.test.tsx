import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { WindOverlayLegend } from './WindOverlayLegend';

afterEach(() => cleanup());

describe('WindOverlayLegend', () => {
  it('renders when visible is true', () => {
    render(<WindOverlayLegend visible={true} />);
    expect(screen.getByTestId('wind-overlay-legend')).toBeTruthy();
  });

  it('renders nothing when visible is false', () => {
    const { container } = render(<WindOverlayLegend visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows all five speed tier labels', () => {
    const { container } = render(<WindOverlayLegend visible={true} />);
    const labelSpans = container.querySelectorAll('span.w-16');
    const labels = Array.from(labelSpans).map((el) => el.textContent?.trim());
    expect(labels).toContain('Calm');
    expect(labels).toContain('Light');
    expect(labels).toContain('Moderate');
    expect(labels).toContain('Fresh');
    expect(labels).toContain('Strong');
  });

  it('shows speed range annotations', () => {
    const { container } = render(<WindOverlayLegend visible={true} />);
    const rangeSpans = container.querySelectorAll('span.text-gray-500');
    const ranges = Array.from(rangeSpans).map((el) => el.textContent?.trim());
    expect(ranges).toContain('< 2 kt');
    expect(ranges).toContain('2–9 kt');
    expect(ranges).toContain('10–19 kt');
    expect(ranges).toContain('20–33 kt');
    expect(ranges).toContain('≥ 34 kt');
  });

  it('renders an SVG chevron for each tier', () => {
    const { container } = render(<WindOverlayLegend visible={true} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(5);
  });

  it('has pointer-events none so it does not block map interaction', () => {
    render(<WindOverlayLegend visible={true} />);
    const legend = screen.getByTestId('wind-overlay-legend');
    expect((legend as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('is positioned at the top-left of the map (SCRUM-87)', () => {
    render(<WindOverlayLegend visible={true} />);
    const legend = screen.getByTestId('wind-overlay-legend');
    const classes = (legend as HTMLElement).className;
    expect(classes).toContain('top-4');
    expect(classes).toContain('left-3');
    expect(classes).not.toContain('bottom-');
  });
});
