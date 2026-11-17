/**
 * Shared Leaflet mock for component tests (SCRUM-92 phase 2).
 *
 * jsdom can't measure layout, so the real Leaflet map throws during tests. Use it with:
 *
 *   vi.mock('leaflet', () => import('../test/leafletMock'));
 *
 * and import the helpers (markerAt, mapInstances, resetLeafletMock, ...) from this module.
 * Both resolve to the same module instance, so the state below is shared.
 */
import { vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

export interface MockMarker {
  latlng: [number, number];
  options: Record<string, unknown>;
  icon: unknown;
  popupHtml: string | null;
  handlers: Record<string, Handler>;
  /** Simulate a Leaflet event on this marker, e.g. fire('click'). */
  fire: (event: string) => void;
  addTo: ReturnType<typeof vi.fn>;
  bindPopup: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  setIcon: ReturnType<typeof vi.fn>;
  setLatLng: ReturnType<typeof vi.fn>;
  setPopupContent: ReturnType<typeof vi.fn>;
  openPopup: ReturnType<typeof vi.fn>;
}

export interface MockMap {
  handlers: Record<string, Handler[]>;
  /** Simulate a map event, e.g. fire('moveend'). */
  fire: (event: string) => void;
  bounds: { south: number; north: number; west: number; east: number };
  size: { x: number; y: number };
  getBounds: ReturnType<typeof vi.fn>;
  getSize: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  flyTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/** Every marker created, in order (including removed ones). */
export const createdMarkers: MockMarker[] = [];
/** Every map created, in order. */
export const mapInstances: MockMap[] = [];

function makeMarker(latlng: [number, number], options: Record<string, unknown> = {}): MockMarker {
  const marker = {
    latlng,
    options,
    icon: options.icon,
    popupHtml: null,
    handlers: {},
  } as MockMarker;
  marker.fire = (event) => marker.handlers[event]?.();
  marker.addTo = vi.fn(() => marker);
  marker.bindPopup = vi.fn((html: string) => {
    marker.popupHtml = html;
    return marker;
  });
  marker.on = vi.fn((event: string, fn: Handler) => {
    marker.handlers[event] = fn;
    return marker;
  });
  marker.remove = vi.fn();
  marker.setIcon = vi.fn((icon: unknown) => {
    marker.icon = icon;
    return marker;
  });
  marker.setLatLng = vi.fn((latlng: [number, number]) => {
    marker.latlng = latlng;
    return marker;
  });
  marker.setPopupContent = vi.fn((html: string) => {
    marker.popupHtml = html;
    return marker;
  });
  marker.openPopup = vi.fn();
  createdMarkers.push(marker);
  return marker;
}

function makeMap(): MockMap {
  const map = {
    handlers: {},
    bounds: { south: 47.0, north: 49.0, west: -123.0, east: -121.0 },
    size: { x: 800, y: 600 },
  } as MockMap;
  map.fire = (event) => (map.handlers[event] ?? []).forEach((fn) => fn());
  map.getBounds = vi.fn(() => ({
    getSouth: () => map.bounds.south,
    getNorth: () => map.bounds.north,
    getWest: () => map.bounds.west,
    getEast: () => map.bounds.east,
  }));
  map.getSize = vi.fn(() => map.size);
  map.on = vi.fn((event: string, fn: Handler) => {
    (map.handlers[event] ??= []).push(fn);
    return map;
  });
  map.off = vi.fn((event: string, fn: Handler) => {
    map.handlers[event] = (map.handlers[event] ?? []).filter((h) => h !== fn);
    return map;
  });
  map.flyTo = vi.fn();
  map.remove = vi.fn();
  mapInstances.push(map);
  return map;
}

const layer = () => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() });

const leaflet = {
  map: vi.fn(() => makeMap()),
  marker: vi.fn((latlng: [number, number], options?: Record<string, unknown>) => makeMarker(latlng, options)),
  divIcon: vi.fn((options: Record<string, unknown>) => ({ ...options })),
  tileLayer: vi.fn(layer),
  control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
};

export default leaflet;

/** Latest marker created at these coordinates. */
export function markerAt(lat: number, lon: number): MockMarker | undefined {
  return [...createdMarkers].reverse().find((m) => m.latlng[0] === lat && m.latlng[1] === lon);
}

/** Markers that are currently on the map (created and not removed). */
export function liveMarkers(): MockMarker[] {
  return createdMarkers.filter((m) => m.remove.mock.calls.length === 0);
}

/** The most recently created map. */
export function currentMap(): MockMap {
  const map = mapInstances[mapInstances.length - 1];
  if (!map) throw new Error('No Leaflet map has been created');
  return map;
}

/** Clear recorded maps/markers and call history. Call in beforeEach. */
export function resetLeafletMock(): void {
  createdMarkers.length = 0;
  mapInstances.length = 0;
  leaflet.map.mockClear();
  leaflet.marker.mockClear();
  leaflet.divIcon.mockClear();
  leaflet.tileLayer.mockClear();
}
