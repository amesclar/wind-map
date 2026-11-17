import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Navbar } from './Navbar';

vi.mock('../api/client', () => ({ searchGeocode: vi.fn().mockResolvedValue([]) }));

function renderNavbar(overrides: Partial<React.ComponentProps<typeof Navbar>> = {}) {
  const props: React.ComponentProps<typeof Navbar> = {
    models: [
      { id: 'best_match', name: 'Open-Meteo (Best Match)' },
      { id: 'gfs_seamless', name: 'NOAA GFS' },
    ],
    selectedModel: 'best_match',
    onSelectModel: vi.fn(),
    timezone: 'America/Los_Angeles',
    onSelectTimezone: vi.fn(),
    unitSystem: 'imperial',
    onToggleUnitSystem: vi.fn(),
    speedUnit: 'knots',
    onSelectSpeedUnit: vi.fn(),
    dirDisplay: 'barb',
    onSelectDirDisplay: vi.fn(),
    savedLocationsCount: 3,
    onOpenSavedLocations: vi.fn(),
    onSelectAndAddLocation: vi.fn(),
    onOpenMapSettings: vi.fn(),
    hasCartoKey: false,
    ...overrides,
  };
  const { container } = render(<Navbar {...props} />);
  const selectWith = (value: string) =>
    Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === value),
    )!;
  return { props, selectWith };
}

describe('Navbar (SCRUM-92)', () => {
  it('shows the saved-location count and opens the list', () => {
    const { props } = renderNavbar();
    const button = screen.getByTitle('List saved locations');
    expect(button.textContent).toContain('3');
    fireEvent.click(button);
    expect(props.onOpenSavedLocations).toHaveBeenCalled();
  });

  it('opens map settings and shows the API-key dot only when a key is set', () => {
    const { props } = renderNavbar();
    expect(screen.queryByTitle('API key active')).toBeNull();
    fireEvent.click(screen.getByTitle('Map Layers & CARTO API Key'));
    expect(props.onOpenMapSettings).toHaveBeenCalled();
  });

  it('shows the API-key dot when a CARTO key is set', () => {
    renderNavbar({ hasCartoKey: true });
    expect(screen.getByTitle('API key active')).toBeTruthy();
  });

  it('reports model, timezone, speed unit and direction display changes', () => {
    const { props, selectWith } = renderNavbar();
    fireEvent.change(selectWith('gfs_seamless'), { target: { value: 'gfs_seamless' } });
    fireEvent.change(selectWith('UTC'), { target: { value: 'UTC' } });
    fireEvent.change(selectWith('mph'), { target: { value: 'mph' } });
    fireEvent.change(selectWith('cardinal'), { target: { value: 'cardinal' } });

    expect(props.onSelectModel).toHaveBeenCalledWith('gfs_seamless');
    expect(props.onSelectTimezone).toHaveBeenCalledWith('UTC');
    expect(props.onSelectSpeedUnit).toHaveBeenCalledWith('mph');
    expect(props.onSelectDirDisplay).toHaveBeenCalledWith('cardinal');
  });

  it('toggles the unit system and describes the current one', () => {
    const { props } = renderNavbar({ unitSystem: 'metric' });
    const toggle = screen.getByTitle(/Toggle units \(currently Metric/);
    fireEvent.click(toggle);
    expect(props.onToggleUnitSystem).toHaveBeenCalled();
  });
});
