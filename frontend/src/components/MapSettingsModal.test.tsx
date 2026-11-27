import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MapSettingsModal } from './MapSettingsModal';
import { isLightTileLayer } from './mapTiles';
import type { MapTileLayer } from '../types';

const BASE_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  tileLayer: 'carto_dark' as const,
  onChangeTileLayer: vi.fn(),
  cartoApiKey: '',
  onSaveCartoApiKey: vi.fn(),
  windOverlayVisible: true,
  onToggleWindOverlay: vi.fn(),
  windColorOverlayVisible: false,
  onToggleWindColorOverlay: vi.fn(),
  windColorHighContrast: false,
  onToggleWindColorHighContrast: vi.fn(),
  waterCurrentsVisible: false,
  onToggleWaterCurrents: vi.fn(),
  wavesVisible: false,
  onToggleWaves: vi.fn(),
  seamarksVisible: false,
  onToggleSeamarks: vi.fn(),
  bcDepthVisible: false,
  onToggleBcDepth: vi.fn(),
};

describe('MapSettingsModal wind overlay toggle', () => {
  it('renders the wind overlay toggle', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);
    expect(screen.getByTestId('wind-overlay-toggle')).toBeTruthy();
  });

  it('toggle is pressed when windOverlayVisible is true', () => {
    render(<MapSettingsModal {...BASE_PROPS} windOverlayVisible={true} />);
    expect(screen.getByTestId('wind-overlay-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('toggle is not pressed when windOverlayVisible is false', () => {
    render(<MapSettingsModal {...BASE_PROPS} windOverlayVisible={false} />);
    expect(screen.getByTestId('wind-overlay-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onToggleWindOverlay with false when toggled off', () => {
    const onToggle = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} windOverlayVisible={true} onToggleWindOverlay={onToggle} />);
    fireEvent.click(screen.getByTestId('wind-overlay-toggle'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('calls onToggleWindOverlay with true when toggled on', () => {
    const onToggle = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} windOverlayVisible={false} onToggleWindOverlay={onToggle} />);
    fireEvent.click(screen.getByTestId('wind-overlay-toggle'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<MapSettingsModal {...BASE_PROPS} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('MapSettingsModal seamark toggle (SCRUM-175)', () => {
  it('is off by default and calls the handler with the flipped value', () => {
    const onToggle = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} seamarksVisible={false} onToggleSeamarks={onToggle} />);
    const toggle = screen.getByTestId('seamarks-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('is disabled on the paper chart and explains that the chart draws its own aids (SCRUM-214)', () => {
    const onToggle = vi.fn();
    render(
      <MapSettingsModal
        {...BASE_PROPS}
        tileLayer="paper_chart"
        seamarksVisible
        onToggleSeamarks={onToggle}
      />,
    );

    const toggle = screen.getByTestId('seamarks-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('info-seamarks'));
    expect(
      within(screen.getByTestId('map-settings-body')).getByText(/already draws NOAA's aids/),
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('stays usable on the other bases', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="carto_dark" seamarksVisible />);
    const toggle = screen.getByTestId('seamarks-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the pressed state and the licence credit with the navigation notice', () => {
    render(<MapSettingsModal {...BASE_PROPS} seamarksVisible />);
    expect(screen.getByTestId('seamarks-toggle').getAttribute('aria-pressed')).toBe('true');
    const body = screen.getByTestId('map-settings-body');
    expect(within(body).getByText(/OpenSeaMap/)).toBeTruthy();
    // The chart note carries the same notice (SCRUM-203), so both are expected here.
    expect(within(body).getAllByText(/Not for navigation/).length).toBeGreaterThanOrEqual(2);
  });
});

describe('MapSettingsModal B.C. depth toggle (SCRUM-205)', () => {
  it('is off by default and calls the handler with the flipped value', () => {
    const onToggle = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} bcDepthVisible={false} onToggleBcDepth={onToggle} />);
    const toggle = screen.getByTestId('bc-depth-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('names CHS, the navigation notice and the derivative notice', () => {
    render(<MapSettingsModal {...BASE_PROPS} bcDepthVisible />);
    const body = screen.getByTestId('map-settings-body');
    expect(within(body).getByText(/B\.C\. Depth \(CHS NONNA\)/)).toBeTruthy();
    expect(within(body).getByText(/Bathymetry © CHS NONNA/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('info-bc_depth'));
    expect(within(body).getByText(/Canadian Hydrographic Service/)).toBeTruthy();
    expect(screen.getByTestId('bc-depth-toggle').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('MapSettingsModal wave toggle (SCRUM-234)', () => {
  it('is off by default and calls the handler with the flipped value', () => {
    const onToggle = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} wavesVisible={false} onToggleWaves={onToggle} />);

    const toggle = screen.getByTestId('waves-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('shows the pressed state and says waves can be shown with currents', () => {
    render(<MapSettingsModal {...BASE_PROPS} wavesVisible />);

    expect(screen.getByTestId('waves-toggle').getAttribute('aria-pressed')).toBe('true');
    const body = screen.getByTestId('map-settings-body');
    expect(within(body).getByText(/Show wave height and direction/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('info-waves'));
    expect(within(body).getByText(/together with the currents/)).toBeTruthy();
  });
});

describe('MapSettingsModal paper chart radio (SCRUM-203)', () => {
  it('offers a non-default radio that reports its choice', () => {
    const onChange = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} onChangeTileLayer={onChange} />);

    const options = within(screen.getByTestId('map-settings-column-options'));
    // SCRUM-301 retired the OpenStreetMap radios and SCRUM-333 restored them: CARTO, OSM Dark,
    // OSM Light, NOAA, OpenWater, Satellite.
    expect(options.getAllByRole('radio')).toHaveLength(6);

    const radio = screen.getByTestId('tile-layer-paper-chart').querySelector('input')!;
    expect((radio as HTMLInputElement).checked).toBe(false);
    fireEvent.click(radio);
    expect(onChange).toHaveBeenCalledWith('paper_chart');
  });

  it('states the NOAA credit, the navigation notice and the coverage limit', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="paper_chart" />);

    const body = screen.getByTestId('map-settings-body');
    expect(within(body).getByText(/© NOAA Office of Coast Survey/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('info-paper_chart'));
    expect(within(body).getByText(/Canadian border/)).toBeTruthy();
    expect(
      (screen.getByTestId('tile-layer-paper-chart').querySelector('input') as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});

describe('MapSettingsModal Seamap radio (SCRUM-206)', () => {
  it('offers a fifth, non-default radio with the licence split and the navigation notice', () => {
    const onChange = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} onChangeTileLayer={onChange} />);

    const radio = screen.getByTestId('tile-layer-seamap').querySelector('input')!;
    expect((radio as HTMLInputElement).checked).toBe(false);
    fireEvent.click(radio);
    expect(onChange).toHaveBeenCalledWith('seamap');

    const body = screen.getByTestId('map-settings-body');
    expect(
      within(body).getByText(/© Open Waters: Seamap · © OpenStreetMap contributors/),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId('info-seamap'));
    expect(within(body).getByText(/not soundings/)).toBeTruthy();
    expect(within(body).getByText(/overzoom beyond that/)).toBeTruthy();
  });

  it('reflects the stored choice', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="seamap" />);

    expect(
      (screen.getByTestId('tile-layer-seamap').querySelector('input') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('selects Satellite and displays the export restriction note (SCRUM-311)', () => {
    const onChange = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} onChangeTileLayer={onChange} />);

    const option = screen.getByTestId('tile-layer-google-satellite');
    expect(within(option).getByText('Satellite', { selector: '.text-sm' })).toBeTruthy();
    expect(within(option).getByText(/Export unavailable on Google Maps/)).toBeTruthy();

    const radio = option.querySelector('input') as HTMLInputElement;
    fireEvent.click(radio);
    expect(onChange).toHaveBeenCalledWith('google_satellite');
  });

  it('hides Google Satellite when the server has no Google key (SCRUM-311)', () => {
    render(<MapSettingsModal {...BASE_PROPS} googleSatelliteEnabled={false} />);

    expect(screen.queryByTestId('tile-layer-google-satellite')).toBeNull();
  });

  it('reflects Google Satellite stored choice', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="google_satellite" />);

    expect(
      (
        screen.getByTestId('tile-layer-google-satellite').querySelector('input') as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
});

describe('MapSettingsModal wind color gradient toggle (SCRUM-124)', () => {
  it('reflects the current state', () => {
    const { rerender } = render(<MapSettingsModal {...BASE_PROPS} windColorOverlayVisible={false} />);
    expect(
      screen.getByTestId('wind-color-overlay-toggle').getAttribute('aria-pressed'),
    ).toBe('false');

    rerender(<MapSettingsModal {...BASE_PROPS} windColorOverlayVisible />);
    expect(
      screen.getByTestId('wind-color-overlay-toggle').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('toggles the gradient independently of the barbs', () => {
    const onToggle = vi.fn();
    render(
      <MapSettingsModal
        {...BASE_PROPS}
        windOverlayVisible
        onToggleWindColorOverlay={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId('wind-color-overlay-toggle'));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(BASE_PROPS.onToggleWindOverlay).not.toHaveBeenCalled();
  });
});

describe('MapSettingsModal water currents note (SCRUM-238)', () => {
  it('explains the model resolution when the currents info is opened', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    fireEvent.click(screen.getByTestId('info-currents'));
    const note = screen.getByTestId('currents-resolution-note');
    expect(note.textContent).toContain('6 to 9 km');
    expect(note.textContent).toContain('Port Susan');
  });

  it('stays available when the layer is on', () => {
    render(<MapSettingsModal {...BASE_PROPS} waterCurrentsVisible />);

    fireEvent.click(screen.getByTestId('info-currents'));
    expect(screen.getByTestId('currents-resolution-note')).toBeTruthy();
  });
});

describe('MapSettingsModal water currents toggle (SCRUM-100)', () => {
  it('is off by default and reflects the current state', () => {
    const { rerender } = render(<MapSettingsModal {...BASE_PROPS} />);
    expect(screen.getByTestId('water-currents-toggle').getAttribute('aria-pressed')).toBe('false');

    rerender(<MapSettingsModal {...BASE_PROPS} waterCurrentsVisible />);
    expect(screen.getByTestId('water-currents-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles independently of both wind layers', () => {
    const onToggle = vi.fn();
    render(
      <MapSettingsModal
        {...BASE_PROPS}
        windOverlayVisible
        windColorOverlayVisible
        onToggleWaterCurrents={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId('water-currents-toggle'));

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(BASE_PROPS.onToggleWindOverlay).not.toHaveBeenCalled();
    expect(BASE_PROPS.onToggleWindColorOverlay).not.toHaveBeenCalled();
  });
});

describe('MapSettingsModal high contrast gradient (SCRUM-213)', () => {
  it('is off by default and reports the flipped value', () => {
    const onToggle = vi.fn();
    render(
      <MapSettingsModal
        {...BASE_PROPS}
        windColorHighContrast={false}
        onToggleWindColorHighContrast={onToggle}
      />,
    );

    const toggle = screen.getByTestId('wind-color-high-contrast-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('says the chart already draws lighter, and reflects the saved choice', () => {
    render(<MapSettingsModal {...BASE_PROPS} windColorHighContrast />);

    expect(screen.getByTestId('wind-color-high-contrast-toggle').getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByTestId('info-wind_high_contrast'));
    expect(
      within(screen.getByTestId('map-settings-body')).getByText(
        /always does this so its soundings stay readable/,
      ),
    ).toBeTruthy();
  });
});

describe('MapSettingsModal base-map theme (SCRUM-221)', () => {
  it.each([
    ['carto_dark', 'dark'],
    ['seamap', 'dark'],
    ['google_satellite', 'dark'],
    ['paper_chart', 'light'],
  ] as const)('themes %s as %s', (layer, expected) => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer={layer} />);
    expect(screen.getByTestId('map-settings-panel').getAttribute('data-theme')).toBe(expected);
  });

  it('restyles while open when the base changes', () => {
    const { rerender } = render(<MapSettingsModal {...BASE_PROPS} tileLayer="carto_dark" />);
    expect(screen.getByTestId('map-settings-panel').getAttribute('data-theme')).toBe('dark');

    rerender(<MapSettingsModal {...BASE_PROPS} tileLayer="paper_chart" />);
    expect(screen.getByTestId('map-settings-panel').getAttribute('data-theme')).toBe('light');

    rerender(<MapSettingsModal {...BASE_PROPS} tileLayer="seamap" />);
    expect(screen.getByTestId('map-settings-panel').getAttribute('data-theme')).toBe('dark');
  });

  it('uses light surfaces and readable text on a light base', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="paper_chart" />);

    const panel = screen.getByTestId('map-settings-panel');
    expect(panel.className).toContain('bg-slate-50');
    expect(panel.className).not.toContain('bg-dark-800');
    fireEvent.click(screen.getByTestId('info-paper_chart'));
    const description = within(screen.getByTestId('map-settings-body')).getByText(
      /Canadian border/,
    );
    expect(description.className).toContain('text-slate-600');
  });

  it('keeps the dark surfaces on a dark base', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="carto_dark" />);

    const panel = screen.getByTestId('map-settings-panel');
    expect(panel.className).toContain('bg-dark-800');
    expect(panel.className).not.toContain('bg-slate-50');
  });

  it('draws every description at 12 px and no 11 px text anywhere in the body', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const body = screen.getByTestId('map-settings-body');
    expect(body.innerHTML).not.toContain('text-[11px]');
    fireEvent.click(screen.getByTestId('info-carto_dark'));
    expect(within(body).getByText(/CARTO requires an API key/).className).toContain('text-xs');
    fireEvent.click(screen.getByTestId('info-currents'));
    expect(screen.getByTestId('info-panel-currents').textContent).toContain('6 to 9 km');
    expect(screen.getByTestId('info-panel-currents').className).toContain('text-xs');
    fireEvent.click(screen.getByTestId('info-paper_chart'));
    expect(within(body).getByText(/Canadian border/).className).toContain('text-xs');
  });

  it('keeps each option name visibly above its description', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const body = screen.getByTestId('map-settings-body');
    expect(within(body).getByText('Show wind barbs across map').className).toContain('text-sm');
    expect(within(body).getByText('High contrast gradient').className).toContain('text-sm');
  });
});

describe('isLightTileLayer (SCRUM-221)', () => {
  it.each([
    ['carto_dark', false],
    ['seamap', false],
    ['google_satellite', false],
    ['paper_chart', true],
  ] as const)('returns %s for %s', (layer, expected) => {
    expect(isLightTileLayer(layer as MapTileLayer)).toBe(expected);
  });
});

describe('MapSettingsModal base map names (SCRUM-322)', () => {
  it.each([
    ['carto_dark', 'CARTO'],
    ['paper_chart', 'NOAA'],
    ['seamap', 'OpenWater'],
    ['google_satellite', 'Satellite'],
  ])('labels %s as %s', (layer, name) => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer={layer as MapTileLayer} />);

    const option = screen.getByTestId(`tile-layer-${layer.replaceAll('_', '-')}`);
    expect(within(option).getByText(name, { exact: true, selector: '.text-sm' })).toBeTruthy();
  });

  it('drops the long names from the visible titles', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const options = screen.getByTestId('map-settings-column-options');
    for (const old of [
      'CARTO Dark Matter',
      'Nautical Paper Chart',
      'Open Waters Seamap',
      'Google Satellite (Hybrid)',
    ]) {
      expect(within(options).queryByText(old, { exact: true })).toBeNull();
    }
  });
});

describe('MapSettingsModal info glyphs (SCRUM-323)', () => {
  const INFO_IDS = [
    'carto_dark',
    'paper_chart',
    'seamap',
    'google_satellite',
    'wind',
    'wind_color',
    'wind_high_contrast',
    'currents',
    'waves',
    'seamarks',
    'bc_depth',
  ];

  it('starts with every detail collapsed', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    for (const id of INFO_IDS) {
      expect(screen.getByTestId(`info-${id}`).getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId(`info-${id}-panel`)).toBeNull();
    }
  });

  it('opens one detail at a time and closes it on a second click', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    fireEvent.click(screen.getByTestId('info-carto_dark'));
    expect(screen.getByTestId('info-panel-carto_dark').textContent).toContain(
      'CARTO requires an API key',
    );
    expect(screen.getByTestId('info-carto_dark').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('info-paper_chart'));
    expect(screen.queryByTestId('info-panel-carto_dark')).toBeNull();
    expect(screen.getByTestId('info-panel-paper_chart')).toBeTruthy();

    fireEvent.click(screen.getByTestId('info-paper_chart'));
    expect(screen.queryByTestId('info-panel-paper_chart')).toBeNull();
  });

  it('does not select a base map or flip a layer when the glyph is clicked', () => {
    const onChange = vi.fn();
    const onWind = vi.fn();
    render(
      <MapSettingsModal
        {...BASE_PROPS}
        onChangeTileLayer={onChange}
        onToggleWindOverlay={onWind}
      />,
    );

    fireEvent.click(screen.getByTestId('info-carto_dark'));
    fireEvent.click(screen.getByTestId('info-wind'));

    expect(onChange).not.toHaveBeenCalled();
    expect(onWind).not.toHaveBeenCalled();
  });

  it('keeps Not for navigation visible without opening any detail', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="paper_chart" />);

    expect(
      within(screen.getByTestId('map-settings-body')).getAllByText(/Not for navigation/).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('MapSettingsModal layout (SCRUM-183)', () => {
  it('puts the map options and key in one column and the layers in the other', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const options = within(screen.getByTestId('map-settings-column-options'));
    const layers = within(screen.getByTestId('map-settings-column-layers'));

    expect(options.getByRole('radio', { name: /CARTO/ })).toBeTruthy();
    expect(options.getByRole('button', { name: 'Save Key' })).toBeTruthy();
    expect(layers.getByTestId('wind-overlay-toggle')).toBeTruthy();
    expect(layers.getByTestId('wind-color-overlay-toggle')).toBeTruthy();
    expect(layers.getByTestId('water-currents-toggle')).toBeTruthy();
  });

  it('keeps Done in the footer, outside the scrolling body', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const body = screen.getByTestId('map-settings-body');
    const footer = screen.getByTestId('map-settings-footer');

    expect(body.className).toContain('overflow-y-auto');
    expect(footer.contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    expect(body.contains(footer)).toBe(false);
  });
});

// SCRUM-333: the Foundation's tiles return as an opt-in, with the export limit stated here.
describe('MapSettingsModal OpenStreetMap rows (SCRUM-333)', () => {
  it.each(['osm-dark', 'osm-standard'])('shows the %s row with its credit and the time-lapse note', (id) => {
    render(<MapSettingsModal {...BASE_PROPS} />);
    const row = screen.getByTestId(`tile-layer-${id}`);
    expect(row.textContent).toContain(id === 'osm-dark' ? 'OSM Dark' : 'OSM Light');
    expect(row.textContent).toContain('Time-lapsed exports not supported');
    expect(row.textContent).toContain('OpenStreetMap contributors');
  });

  it('selects a stored OpenStreetMap base and reports a change', () => {
    const onChangeTileLayer = vi.fn();
    render(
      <MapSettingsModal
        {...BASE_PROPS}
        tileLayer={'osm_dark' as MapTileLayer}
        onChangeTileLayer={onChangeTileLayer}
      />,
    );

    const checked = screen.getByTestId('tile-layer-osm-dark').querySelector('input')!;
    expect((checked as HTMLInputElement).checked).toBe(true);

    const light = screen.getByTestId('tile-layer-osm-standard').querySelector('input')!;
    fireEvent.click(light);
    expect(onChangeTileLayer).toHaveBeenCalledWith('osm_standard');
  });
});
