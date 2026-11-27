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
  /** Options passed to bindPopup, for placement assertions (SCRUM-252). */
  popupOptions?: Record<string, unknown>;
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

/** One tile layer created by the table; `kind` says whether it came from `tileLayer` or `tileLayer.wms`. */
export interface MockTileLayer {
  url?: string;
  options?: Record<string, unknown>;
  kind: 'xyz' | 'wms';
  /** Event handlers Leaflet would call, so tests can simulate tile errors and loads (SCRUM-217). */
  handlers: Record<string, Handler[]>;
  fire: (event: string) => void;
  on: ReturnType<typeof vi.fn>;
  addTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/** Every tile layer created, in order (kept for pane and clip assertions). */
export const createdTileLayers: MockTileLayer[] = [];

/** One polyline: the chart's 49.6 N boundary rule (SCRUM-215). */
export interface MockPolyline {
  latlngs: [number, number][];
  options: Record<string, unknown>;
  addTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/** Every polyline created, in order. */
export const createdPolylines: MockPolyline[] = [];

export interface MockMap {
  /** Element the map was created on (SCRUM-143 reads it for the overlay viewport). */
  container: HTMLElement;
  handlers: Record<string, Handler[]>;
  /** Simulate a map event, e.g. fire('moveend'). */
  fire: (event: string, ...args: unknown[]) => void;
  bounds: { south: number; north: number; west: number; east: number };
  size: { x: number; y: number };
  zoom: number;
  panes: Record<string, HTMLElement>;
  getZoom: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  zoomIn: ReturnType<typeof vi.fn>;
  zoomOut: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  getSize: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  createPane: ReturnType<typeof vi.fn>;
  getPane: ReturnType<typeof vi.fn>;
  containerPointToLatLng: ReturnType<typeof vi.fn>;
  latLngToContainerPoint: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
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
  marker.bindPopup = vi.fn((html: string, options?: Record<string, unknown>) => {
    marker.popupHtml = html;
    marker.popupOptions = options;
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

function makeMap(container?: HTMLElement): MockMap {
  const map = {
    container: container ?? document.createElement('div'),
    handlers: {},
    bounds: { south: 47.0, north: 49.0, west: -123.0, east: -121.0 },
    size: { x: 800, y: 600 },
    zoom: 13,
    panes: {} as Record<string, HTMLElement>,
  } as MockMap;
  map.getZoom = vi.fn(() => map.zoom);
  map.setZoom = vi.fn((zoom: number) => {
    map.zoom = zoom;
    return map;
  });
  map.getContainer = vi.fn(() => map.container);
  map.fire = (event, ...args) => (map.handlers[event] ?? []).forEach((fn) => fn(...args));
  map.getBounds = vi.fn(() => ({
    getSouth: () => map.bounds.south,
    getNorth: () => map.bounds.north,
    getWest: () => map.bounds.west,
    getEast: () => map.bounds.east,
  }));
  map.getSize = vi.fn(() => map.size);
  // Panes are detached divs: jsdom has no layout, and the gradient layer only needs a
  // parent it can remove on unmount (SCRUM-123). They are registered so `getPane` answers for a
  // pane the component created, as real Leaflet does (SCRUM-203 asserts the chart pane).
  map.createPane = vi.fn((name: string) => {
    const pane = document.createElement('div');
    map.panes[name] = pane;
    return pane;
  });
  map.getPane = vi.fn((name: string) => map.panes[name] ?? null);
  map.containerPointToLatLng = vi.fn(([x, y]: [number, number]) => ({
    lat: map.bounds.north - (y / map.size.y) * (map.bounds.north - map.bounds.south),
    lng: map.bounds.west + (x / map.size.x) * (map.bounds.east - map.bounds.west),
  }));
  map.latLngToContainerPoint = vi.fn(([lat, lng]: [number, number]) => ({
    x: ((lng - map.bounds.west) / (map.bounds.east - map.bounds.west)) * map.size.x,
    y: ((map.bounds.north - lat) / (map.bounds.north - map.bounds.south)) * map.size.y,
  }));
  map.on = vi.fn((event: string, fn: Handler) => {
    (map.handlers[event] ??= []).push(fn);
    return map;
  });
  map.off = vi.fn((event: string, fn: Handler) => {
    map.handlers[event] = (map.handlers[event] ?? []).filter((h) => h !== fn);
    return map;
  });
  map.once = vi.fn((event: string, fn: Handler) => {
    const wrapper: Handler = (...args) => {
      map.handlers[event] = (map.handlers[event] ?? []).filter((h) => h !== wrapper);
      fn(...args);
    };
    (map.handlers[event] ??= []).push(wrapper);
    return map;
  });
  map.flyTo = vi.fn();
  // The app's own zoom buttons (SCRUM-319) drive Leaflet's zoom methods, which announce the new
  // level the way the real map does.
  map.zoomIn = vi.fn((delta = 1) => {
    map.zoom = Math.min(map.zoom + delta, 19);
    map.fire('zoom');
    map.fire('zoomend');
    return map;
  });
  map.zoomOut = vi.fn((delta = 1) => {
    map.zoom = Math.max(map.zoom - delta, 0);
    map.fire('zoom');
    map.fire('zoomend');
    return map;
  });
  map.remove = vi.fn();
  mapInstances.push(map);
  return map;
}

// URL and options are kept so tests can check which layer a call asked for (SCRUM-175).
const layer = (
  url: string | undefined,
  options: Record<string, unknown> | undefined,
  kind: 'xyz' | 'wms' = 'xyz',
): MockTileLayer => {
  const created = {
    url,
    options,
    kind,
    handlers: {},
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  } as MockTileLayer;
  created.on = vi.fn((event: string, fn: Handler) => {
    (created.handlers[event] ??= []).push(fn);
    return created;
  });
  created.fire = (event) => (created.handlers[event] ?? []).forEach((fn) => fn());
  createdTileLayers.push(created);
  return created;
};

const leaflet = {
  map: vi.fn((container?: HTMLElement) => makeMap(container)),
  polyline: vi.fn((latlngs: [number, number][], options?: Record<string, unknown>) => {
    const line: MockPolyline = {
      latlngs,
      options: options ?? {},
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    };
    createdPolylines.push(line);
    return line;
  }),
  marker: vi.fn((latlng: [number, number], options?: Record<string, unknown>) => makeMarker(latlng, options)),
  divIcon: vi.fn((options: Record<string, unknown>) => ({ ...options })),
  tileLayer: Object.assign(
    vi.fn((url?: string, options?: Record<string, unknown>) => layer(url, options, 'xyz')),
    {
      // SCRUM-203 mounts the NOAA chart through L.tileLayer.wms, which Leaflet exposes as a
      // property of tileLayer; the mock keeps that shape.
      wms: vi.fn((url?: string, options?: Record<string, unknown>) => layer(url, options, 'wms')),
    },
  ),
  // The WMS mount needs a real CRS value; the mock only has to be recognisable (SCRUM-203).
  CRS: { EPSG3857: { code: 'EPSG:3857' }, EPSG4326: { code: 'EPSG:4326' } },
  latLngBounds: vi.fn((southWest: [number, number], northEast: [number, number]) => ({
    _southWest: southWest,
    _northEast: northEast,
    getSouth: () => southWest[0],
    getNorth: () => northEast[0],
    getWest: () => southWest[1],
    getEast: () => northEast[1],
    contains: () => true,
  })),
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
  createdTileLayers.length = 0;
  createdPolylines.length = 0;
  mapInstances.length = 0;
  leaflet.map.mockClear();
  leaflet.marker.mockClear();
  leaflet.divIcon.mockClear();
  leaflet.polyline.mockClear();
  leaflet.tileLayer.mockClear();
  leaflet.tileLayer.wms.mockClear();
  leaflet.latLngBounds.mockClear();
}
