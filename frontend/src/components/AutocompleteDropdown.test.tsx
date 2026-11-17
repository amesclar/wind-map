import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutocompleteDropdown } from './AutocompleteDropdown';
import * as api from '../api/client';
import type { GeocodeResult } from '../types';

vi.mock('../api/client', () => ({ searchGeocode: vi.fn() }));

const DEBOUNCE_MS = 280;

const miami: GeocodeResult = {
  name: 'Miami',
  latitude: 25.7617,
  longitude: -80.1918,
  admin1: 'Florida',
  country: 'United States',
  display_name: 'Miami, Florida, United States',
};

const input = () => screen.getByPlaceholderText('Add location (e.g. Seattle, Paris)...');

/** Advance past the debounce and let the search promise settle. */
async function flushSearch() {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE_MS);
  });
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.searchGeocode).mockReset().mockResolvedValue([miami]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AutocompleteDropdown (SCRUM-92)', () => {
  it('debounces typing into a single search for the final query', async () => {
    render(<AutocompleteDropdown onSelectAndAdd={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'Mi' } });
    fireEvent.change(input(), { target: { value: 'Mia' } });
    fireEvent.change(input(), { target: { value: 'Miami' } });

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    });
    expect(api.searchGeocode).not.toHaveBeenCalled();

    await flushSearch();
    expect(api.searchGeocode).toHaveBeenCalledTimes(1);
    expect(api.searchGeocode).toHaveBeenCalledWith('Miami');
    expect(screen.getByText('Miami')).toBeTruthy();
    expect(screen.getByText('Florida, United States')).toBeTruthy();
  });

  it('does not search for queries shorter than 2 characters', async () => {
    render(<AutocompleteDropdown onSelectAndAdd={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'M' } });
    await flushSearch();
    expect(api.searchGeocode).not.toHaveBeenCalled();
  });

  it('adds the clicked result and clears the box', async () => {
    const onSelectAndAdd = vi.fn();
    render(<AutocompleteDropdown onSelectAndAdd={onSelectAndAdd} />);
    fireEvent.change(input(), { target: { value: 'Miami' } });
    await flushSearch();

    fireEvent.click(screen.getByText('Miami'));
    expect(onSelectAndAdd).toHaveBeenCalledWith(miami);
    expect((input() as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Florida, United States')).toBeNull();
  });

  it('adds the first result when Enter is pressed', async () => {
    const onSelectAndAdd = vi.fn();
    render(<AutocompleteDropdown onSelectAndAdd={onSelectAndAdd} />);
    fireEvent.change(input(), { target: { value: 'Miami' } });
    await flushSearch();

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSelectAndAdd).toHaveBeenCalledWith(miami);
  });

  it('shows no dropdown when the search fails', async () => {
    vi.mocked(api.searchGeocode).mockRejectedValue(new Error('down'));
    render(<AutocompleteDropdown onSelectAndAdd={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'Miami' } });
    await flushSearch();
    expect(screen.queryByText('Florida, United States')).toBeNull();
  });

  it('closes the dropdown on a click outside', async () => {
    render(
      <div>
        <AutocompleteDropdown onSelectAndAdd={vi.fn()} />
        <p>outside</p>
      </div>,
    );
    fireEvent.change(input(), { target: { value: 'Miami' } });
    await flushSearch();
    expect(screen.getByText('Florida, United States')).toBeTruthy();

    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByText('Florida, United States')).toBeNull();
  });
});
