import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapView } from './MapView';
import type { SavedLocation } from '../types';

const popups: string[] = [];

vi.mock('leaflet', () => {
  const layer = () => ({ addTo: vi.fn(), remove: vi.fn() });
  return {
    default: {
      map: vi.fn(() => ({
        remove: vi.fn(),
        flyTo: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getBounds: vi.fn(() => ({ getSouth: () => 47, getNorth: () => 49, getWest: () => -123, getEast: () => -121 })),
        getSize: vi.fn(() => ({ x: 800, y: 600 })),
      })),
      control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
      tileLayer: vi.fn(layer),
      divIcon: vi.fn(() => ({})),
      marker: vi.fn(() => {
        const instance: any = {
          addTo: vi.fn(() => instance),
          bindPopup: vi.fn((html: string) => {
            popups.push(html);
            return instance;
          }),
          on: vi.fn(() => instance),
          remove: vi.fn(),
          openPopup: vi.fn(),
        };
        return instance;
      }),
    },
  };
});

afterEach(() => {
  cleanup();
  popups.length = 0;
});

const baseProps = {
  selectedLocation: null,
  onSelectLocation: () => {},
  weatherMap: {},
  tileLayerType: 'osm_dark' as const,
  cartoApiKey: '',
  selectedModel: 'best_match',
  windOverlayVisible: false,
  selectedGridPoint: null,
  onGridPointSelect: () => {},
};

describe('MapView popups (SCRUM-92)', () => {
  it('escapes location text so it cannot inject HTML', () => {
    const evil: SavedLocation = {
      id: 9,
      name: '<img src=x onerror="alert(1)">',
      latitude: 48,
      longitude: -122,
      admin1: '<b>bold</b>',
      country: 'A & B',
      is_default: false,
    };
    render(<MapView {...baseProps} locations={[evil]} />);

    expect(popups).toHaveLength(1);
    const html = popups[0];
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;, A &amp; B');

    // Parsed as HTML, the name is plain text, not an element.
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
