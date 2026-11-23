/** App-wide defaults (SCRUM-92). Keep in step with backend/app/config.py. */

export const DEFAULT_MODEL = 'best_match';
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/** Timezones offered in the Preferences pop-up. */
export const TIMEZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { id: 'America/Denver', label: 'Mountain (MT)' },
  { id: 'America/Chicago', label: 'Central (CT)' },
  { id: 'America/New_York', label: 'Eastern (ET)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Europe/London', label: 'London (GMT)' },
  { id: 'Europe/Paris', label: 'Paris (CET)' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

/** Hours between forecast slices (backend FORECAST_STEP_HOURS). */
export const FORECAST_STEP_HOURS = 3;

/** Default map view when no location is selected yet (Oak Harbor, WA). */
export const DEFAULT_MAP_CENTER: [number, number] = [48.2939, -122.6064];
export const DEFAULT_MAP_ZOOM = 8;

/** localStorage keys. */
export const STORAGE_KEYS = {
  tileLayer: 'map_tile_layer',
  cartoApiKey: 'carto_api_key',
  windOverlayVisible: 'wind_overlay_visible',
  windColorOverlayVisible: 'wind_color_overlay_visible',
  unitSystem: 'unit_system',
  speedUnit: 'speed_unit',
  dirDisplay: 'dir_display',
  timezone: 'timezone',
} as const;
