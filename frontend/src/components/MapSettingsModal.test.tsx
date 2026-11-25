import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MapSettingsModal } from './MapSettingsModal';

const BASE_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  tileLayer: 'osm_dark' as const,
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
    expect(
      within(screen.getByTestId('map-settings-body')).getByText(/already draws NOAA's aids/),
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('stays usable on the other bases', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="osm_dark" seamarksVisible />);
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
    expect(within(body).getByText(/Canadian Hydrographic Service/)).toBeTruthy();
    expect(screen.getByTestId('bc-depth-toggle').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('MapSettingsModal paper chart radio (SCRUM-203)', () => {
  it('offers a fourth, non-default radio that reports its choice', () => {
    const onChange = vi.fn();
    render(<MapSettingsModal {...BASE_PROPS} onChangeTileLayer={onChange} />);

    const options = within(screen.getByTestId('map-settings-column-options'));
    expect(options.getAllByRole('radio')).toHaveLength(5);

    const radio = screen.getByTestId('tile-layer-paper-chart').querySelector('input')!;
    expect((radio as HTMLInputElement).checked).toBe(false);
    fireEvent.click(radio);
    expect(onChange).toHaveBeenCalledWith('paper_chart');
  });

  it('states the NOAA credit, the navigation notice and the coverage limit', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="paper_chart" />);

    const body = screen.getByTestId('map-settings-body');
    expect(within(body).getByText(/© NOAA Office of Coast Survey/)).toBeTruthy();
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
    expect(within(body).getByText(/not soundings/)).toBeTruthy();
    expect(within(body).getByText(/overzoom beyond that/)).toBeTruthy();
  });

  it('reflects the stored choice', () => {
    render(<MapSettingsModal {...BASE_PROPS} tileLayer="seamap" />);

    expect(
      (screen.getByTestId('tile-layer-seamap').querySelector('input') as HTMLInputElement).checked,
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
  it('explains the model resolution under the water currents toggle', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const note = screen.getByTestId('currents-resolution-note');
    expect(note.textContent).toContain('6 to 9 km');
    expect(note.textContent).toContain('Port Susan');
  });

  it('stays visible when the layer is on', () => {
    render(<MapSettingsModal {...BASE_PROPS} waterCurrentsVisible />);

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
    expect(
      within(screen.getByTestId('map-settings-body')).getByText(
        /always does this so its soundings stay readable/,
      ),
    ).toBeTruthy();
  });
});

describe('MapSettingsModal layout (SCRUM-183)', () => {
  it('puts the map options and key in one column and the layers in the other', () => {
    render(<MapSettingsModal {...BASE_PROPS} />);

    const options = within(screen.getByTestId('map-settings-column-options'));
    const layers = within(screen.getByTestId('map-settings-column-layers'));

    expect(options.getByRole('radio', { name: /OpenStreetMap Dark/ })).toBeTruthy();
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
