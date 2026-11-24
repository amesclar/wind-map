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
    savedLocationsCount: 3,
    onOpenSavedLocations: vi.fn(),
    onSelectAndAddLocation: vi.fn(),
    onOpenMapSettings: vi.fn(),
    onOpenPreferences: vi.fn(),
    onOpenModelGuide: vi.fn(),
    hasCartoKey: false,
    onOpenExportDialog: vi.fn(),
    savingMap: false,
    feedbackEnabled: true,
    onOpenFeedback: vi.fn(),
    ...overrides,
  };
  const { container } = render(<Navbar {...props} />);
  const selectWith = (value: string) =>
    Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === value),
    )!;
  return { props, container, selectWith };
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

  it('reports model changes', () => {
    const { props, selectWith } = renderNavbar();
    fireEvent.change(selectWith('gfs_seamless'), { target: { value: 'gfs_seamless' } });
    expect(props.onSelectModel).toHaveBeenCalledWith('gfs_seamless');
  });

  it('opens the model update frequency guide from the icon beside the model selector (SCRUM-110)', () => {
    const { props } = renderNavbar();
    const button = screen.getByRole('button', { name: 'Model Update Cycles & Frequency' });
    fireEvent.click(button);
    expect(props.onOpenModelGuide).toHaveBeenCalled();
  });

  it('opens the export dialog from the download trigger (SCRUM-117, SCRUM-157)', () => {
    const { props } = renderNavbar();
    fireEvent.click(screen.getByTitle('Export map image'));
    expect(props.onOpenExportDialog).toHaveBeenCalled();
  });

  it('places the export trigger immediately left of Preferences (SCRUM-157)', () => {
    const { container } = renderNavbar();
    const buttons = Array.from(container.querySelectorAll('button'));
    const exportIndex = buttons.findIndex((b) => b.getAttribute('title') === 'Export map image');
    const preferencesIndex = buttons.findIndex((b) => b.getAttribute('title') === 'Preferences');

    expect(exportIndex).toBeGreaterThan(-1);
    expect(preferencesIndex).toBe(exportIndex + 1);
  });

  it('opens Preferences from the gear button; unit and timezone controls are gone (SCRUM-107)', () => {
    const { props, container } = renderNavbar();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(props.onOpenPreferences).toHaveBeenCalled();

    expect(container.querySelectorAll('select')).toHaveLength(1); // the model selector only
    expect(screen.queryByTitle(/Toggle units/)).toBeNull();
    expect(screen.queryByText('°F')).toBeNull();
  });

  it('shows the feedback button between the guide and export, keeping export left of the gear (SCRUM-179)', () => {
    const { props, container } = renderNavbar();
    const buttons = Array.from(container.querySelectorAll('header button'));
    const titles = buttons.map((b) => b.getAttribute('title'));
    const feedback = titles.indexOf('Send feedback');
    expect(titles.indexOf('Model Update Cycles & Frequency')).toBeLessThan(feedback);
    expect(feedback).toBeLessThan(titles.indexOf('Export map image'));
    expect(titles.indexOf('Export map image')).toBe(titles.indexOf('Preferences') - 1);
    const button = screen.getByRole('button', { name: 'Send feedback' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(button);
    expect(props.onOpenFeedback).toHaveBeenCalled();
  });

  it('hides the feedback button when the server has no Jira configuration (SCRUM-179)', () => {
    renderNavbar({ feedbackEnabled: false });
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
  });
});
