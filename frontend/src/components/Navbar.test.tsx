import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Navbar } from './Navbar';
import { APP_VERSION } from '../version';

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
    mapName: 'OSM-Dark',
    onOpenPreferences: vi.fn(),
    onRefresh: vi.fn(),
    hasCartoKey: false,
    onOpenExportDialog: vi.fn(),
    savingMap: false,
    feedbackEnabled: true,
    onOpenFeedback: vi.fn(),
    ...overrides,
  };
  const { container, rerender } = render(<Navbar {...props} />);
  const selectWith = (value: string) =>
    Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === value),
    )!;
  return { props, container, selectWith, rerender };
}

describe('Navbar (SCRUM-92)', () => {
  it('shows the saved-location count and opens the list', () => {
    const { props } = renderNavbar();
    const button = screen.getByTitle('List saved locations');
    expect(button.textContent).toContain('3');
    fireEvent.click(button);
    expect(props.onOpenSavedLocations).toHaveBeenCalled();
  });

  it('names the selected base map on the map-settings button (SCRUM-326)', () => {
    const { props, rerender } = renderNavbar();
    const button = screen.getByTitle('Map Layers & CARTO API Key');
    expect(button.textContent).toContain('OSM-Dark');
    expect(button.textContent).not.toContain('Map');

    for (const name of ['OSM-Light', 'CARTO', 'NOAA', 'OpenWater', 'Satellite']) {
      rerender(<Navbar {...props} mapName={name} />);
      expect(screen.getByTestId('map-settings-button').textContent).toContain(name);
    }
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

  it('has no model guide button any more (SCRUM-232)', () => {
    renderNavbar();
    expect(screen.queryByRole('button', { name: 'Model Update Cycles & Frequency' })).toBeNull();
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

  it('keeps the toolbar order feedback · export · gear (SCRUM-179, SCRUM-232)', () => {
    const { props, container } = renderNavbar();
    const buttons = Array.from(container.querySelectorAll('header button'));
    const titles = buttons.map((b) => b.getAttribute('title'));
    const feedback = titles.indexOf('Send feedback');
    expect(feedback).toBeGreaterThan(-1);
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

  it('shows the regional label the API gives a model (SCRUM-231)', () => {
    const { selectWith } = renderNavbar({
      models: [
        { id: 'best_match', name: 'Open-Meteo (Best Match)' },
        { id: 'ncep_rrfs_north_america', name: 'RRFS (North America)' },
      ],
    });

    const labels = Array.from(selectWith('ncep_rrfs_north_america').options).map((o) => o.textContent);
    expect(labels).toContain('RRFS (North America)');
  });
});

describe('refresh hint (SCRUM-257)', () => {
  const hint = { text: 'Latest run already loaded', detail: 'Next run available ~16:17' };

  it('stays hidden until the icon is hovered, then names the next run', () => {
    renderNavbar({ refreshHint: hint });
    expect(screen.queryByTestId('refresh-hint-box')).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId('refresh-zone'));
    const box = screen.getByTestId('refresh-hint-box');
    expect(box.textContent).toContain('Latest run already loaded');
    expect(box.textContent).toContain('Next run available ~16:17');

    fireEvent.mouseLeave(screen.getByTestId('refresh-zone'));
    expect(screen.queryByTestId('refresh-hint-box')).toBeNull();
  });

  it('describes the disabled button to assistive tech without a hover', () => {
    renderNavbar({ refreshHint: hint });
    const button = screen.getByTestId('refresh-data') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)!.textContent).toBe(
      'Latest run already loaded · Next run available ~16:17',
    );
  });

  it('fires nothing while disabled and follows new hint text', () => {
    const { props, rerender } = renderNavbar({ refreshHint: hint });
    fireEvent.click(screen.getByTestId('refresh-data'));
    expect(props.onRefresh).not.toHaveBeenCalled();

    rerender(<Navbar {...props} refreshHint={{ text: 'Waiting for the first forecast', detail: null }} />);
    fireEvent.mouseEnter(screen.getByTestId('refresh-zone'));
    expect(screen.getByTestId('refresh-hint-box').textContent).toBe('Waiting for the first forecast');
  });

  it('invites the click while the button is enabled', () => {
    const { props } = renderNavbar({ canRefresh: true, refreshHint: { text: 'Refresh data now', detail: null } });
    fireEvent.mouseEnter(screen.getByTestId('refresh-zone'));
    expect(screen.getByTestId('refresh-hint-box').textContent).toBe('Refresh data now');
    fireEvent.click(screen.getByTestId('refresh-data'));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('version badge copy (SCRUM-319)', () => {
  const stubClipboard = (writeText: ReturnType<typeof vi.fn>) =>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.useRealTimers();
  });

  it('copies the version with the client details and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderNavbar();

    fireEvent.click(screen.getByTestId('app-version'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain(`Wind Map v${APP_VERSION}`);
    expect(copied).toContain(
      `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown'}`,
    );
    expect(copied).toContain('Browser: ');
    expect(copied).toContain(navigator.userAgent.slice(0, 200));
    // No map reported a zoom here.
    expect(copied).toContain('Map zoom: unknown');
    expect(screen.getByTestId('version-copy-status').textContent).toBe(
      `v${APP_VERSION} copied to clipboard`,
    );
  });

  it('names the live map zoom (SCRUM-320)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderNavbar({ mapZoom: 14 });

    fireEvent.click(screen.getByTestId('app-version'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Map zoom: 14');
  });

  it('clears the confirmation by itself', async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    renderNavbar();

    fireEvent.click(screen.getByTestId('app-version'));
    await act(async () => {});
    expect(screen.getByTestId('version-copy-status')).toBeTruthy();

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByTestId('version-copy-status')).toBeNull();
  });

  it('says so when the clipboard refuses', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    renderNavbar();

    fireEvent.click(screen.getByTestId('app-version'));

    await waitFor(() =>
      expect(screen.getByTestId('version-copy-status').textContent).toBe(
        'Could not copy the version',
      ),
    );
  });
});
