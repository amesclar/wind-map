import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavedLocationsModal } from './SavedLocationsModal';
import { makeLocation } from '../test/fixtures';

const oakHarbor = makeLocation();
const seattle = makeLocation({ id: 2, name: 'Seattle, WA', is_default: false });
const unnamedRegion = makeLocation({
  id: 3,
  name: 'Open water',
  admin1: null,
  country: null,
  latitude: 48.123,
  longitude: -123.456,
  is_default: false,
});

function renderModal(overrides: Partial<React.ComponentProps<typeof SavedLocationsModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    locations: [oakHarbor, seattle, unnamedRegion],
    selectedLocationId: 1,
    onSelectLocation: vi.fn(),
    onDeleteLocation: vi.fn(),
    ...overrides,
  };
  render(<SavedLocationsModal {...props} />);
  return props;
}

describe('SavedLocationsModal (SCRUM-92)', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <SavedLocationsModal
        isOpen={false}
        onClose={vi.fn()}
        locations={[oakHarbor]}
        selectedLocationId={null}
        onSelectLocation={vi.fn()}
        onDeleteLocation={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('lists locations with the count, default badge, and coordinates when there is no region', () => {
    renderModal();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Oak Harbor, WA')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getAllByText('Washington, United States')).toHaveLength(2);
    expect(screen.getByText('48.12°, -123.46°')).toBeTruthy();
  });

  it('shows an empty state with no locations', () => {
    renderModal({ locations: [] });
    expect(screen.getByText(/No saved locations/)).toBeTruthy();
  });

  it('selects a location and closes', () => {
    const props = renderModal();
    fireEvent.click(screen.getByText('Seattle, WA'));
    expect(props.onSelectLocation).toHaveBeenCalledWith(seattle);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('deletes a location without selecting it', () => {
    const props = renderModal();
    fireEvent.click(screen.getByLabelText('Remove Seattle, WA'));
    expect(props.onDeleteLocation).toHaveBeenCalledWith(2);
    expect(props.onSelectLocation).not.toHaveBeenCalled();
  });

  it('closes from the footer button', () => {
    const props = renderModal();
    fireEvent.click(screen.getByText('Close'));
    expect(props.onClose).toHaveBeenCalled();
  });
});
