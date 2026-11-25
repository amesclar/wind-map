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
  waterCurrentsVisible: false,
  onToggleWaterCurrents: vi.fn(),
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
