import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WeatherModelGuideModal } from './WeatherModelGuideModal';

const FIXTURE = [
  '# Fixture guide',
  '',
  '| Model | Region | Update Frequency | Notes |',
  '|---|---|---|---|',
  '| NOAA GFS | Global | Every 6 hours | Six-hourly cycles. |',
  '| Odd Model | Global | Twice daily | No badge for this one. |',
].join('\n');

describe('WeatherModelGuideModal (SCRUM-110)', () => {
  it('renders every model family from the bundled guide', () => {
    render(<WeatherModelGuideModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Model Update Cycles & Frequency')).toBeTruthy();
    expect(screen.getByText('Model / Family')).toBeTruthy();
    expect(screen.getByText('NOAA HRRR')).toBeTruthy();
    expect(screen.getByText('CMC GEM')).toBeTruthy();
    expect(screen.getByText('Open-Meteo Marine (Waves)')).toBeTruthy();
  });

  it('shows 4 x 1h, 3 x 3h and 6 x 6h cadence badges', () => {
    render(<WeatherModelGuideModal isOpen onClose={vi.fn()} />);
    expect(screen.getAllByTestId('cadence-1h')).toHaveLength(4);
    expect(screen.getAllByTestId('cadence-3h')).toHaveLength(3);
    expect(screen.getAllByTestId('cadence-6h')).toHaveLength(6);
  });

  it('presents the guide as a general reference', () => {
    render(<WeatherModelGuideModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText(/not all selectable in this app/)).toBeTruthy();
    expect(screen.getByText(/Regional 2\.5 km & Global/)).toBeTruthy();
  });

  it('falls back to the prose frequency when no badge applies', () => {
    render(<WeatherModelGuideModal isOpen onClose={vi.fn()} markdown={FIXTURE} />);
    expect(screen.getByTestId('cadence-6h').textContent).toBe('6h');
    expect(screen.getByText('Twice daily')).toBeTruthy();
    expect(screen.getAllByTestId(/^cadence-/).length).toBe(1);
  });

  it('scrolls vertically and lets the table scroll sideways on narrow screens', () => {
    render(<WeatherModelGuideModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('model-guide-body').className).toContain('overflow-y-auto');
    expect(screen.getByTestId('model-guide-table').className).toContain('overflow-x-auto');
  });

  it('closes from the X and Done buttons', () => {
    const onClose = vi.fn();
    render(<WeatherModelGuideModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close model update guide'));
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not render when closed', () => {
    const { container } = render(<WeatherModelGuideModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
