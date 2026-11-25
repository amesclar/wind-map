export interface SavedLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string | null;
  country?: string | null;
  is_default: boolean;
  created_at?: string | null;
}

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string | null;
  country?: string | null;
  display_name: string;
}

export interface WeatherForecastPoint {
  time: string;
  temperature_c: number;
  temperature_f: number;
  wind_speed_knots: number;
  wind_speed_kmh: number;
  wind_speed_mph: number;
  wind_speed_ms: number;
  wind_gust_knots: number;
  wind_gust_kmh: number;
  wind_gust_mph: number;
  wind_gust_ms: number;
  wind_direction_deg: number;
  wind_direction_cardinal: string;
  humidity: number;
  weather_code: number;
}

export interface WeatherForecastResponse {
  location_id: number;
  location_name: string;
  latitude: number;
  longitude: number;
  model: string;
  timezone: string;
  cached: boolean;
  cached_at: number;
  current: WeatherForecastPoint;
  forecast: WeatherForecastPoint[];
  /** Hour `current` describes when one was requested (SCRUM-115); absent means live values. */
  valid_time?: string | null;
}

export interface WeatherModel {
  id: string;
  name: string;
}

/** GET /api/weather/models entry (SCRUM-115): cadence, horizon and run times. */
export interface WeatherModelInfo extends WeatherModel {
  /** Hours between model runs, and the UTC cycle hours those runs happen at. */
  update_hours: number;
  update_cycles_utc: number[];
  /** Forecast hours the model covers; the grid's `time` stays inside it. */
  horizon_hours: number;
  /** Most recent and next cycle boundary, ISO 8601 UTC. */
  last_run_utc: string;
  next_run_utc: string;
}

export type UnitSystem = 'imperial' | 'metric';
export type WindSpeedUnit = 'knots' | 'kmh' | 'mph' | 'ms';
export type WindDirDisplay = 'barb' | 'cardinal' | 'deg';

/** Base maps; `paper_chart` is the NOAA chart (SCRUM-203), which must not be darkened. */
export type MapTileLayer = 'carto_dark' | 'osm_dark' | 'osm_standard' | 'paper_chart';

/** Body of POST /api/locations. */
export type NewLocation = Pick<SavedLocation, 'name' | 'latitude' | 'longitude' | 'admin1' | 'country'>;

/** GET /api/config. */
export interface AppConfig {
  carto_api_key?: string;
  /** True when the server has Jira credentials, so the feedback button is shown (SCRUM-179). */
  feedback_enabled?: boolean;
}

/** Feedback types accepted by POST /api/feedback (SCRUM-179). */
export type FeedbackType = 'bug' | 'new feature' | 'comment';

/** Body of POST /api/feedback. */
export interface FeedbackPayload {
  type: FeedbackType;
  subject: string;
  comments: string;
  contact_email?: string;
  app_version: string;
  timezone: string;
  user_agent: string;
}

/** Response of POST /api/feedback: the Jira issue that was created. */
export interface FeedbackResult {
  issue_key: string;
  issue_url: string;
}

/** One point of GET /api/weather/grid. */
export interface GridWindPoint {
  latitude: number;
  longitude: number;
  wind_speed_knots: number;
  wind_direction_deg: number;
  /** Temperature in °F; colors the map barb (SCRUM-89). */
  temperature_f?: number | null;
  /** Forecast hour these values describe (SCRUM-115); null or absent means current. */
  time?: string | null;
}

/** One point of GET /api/currents/grid (SCRUM-96). */
export interface CurrentPoint {
  latitude: number;
  longitude: number;
  /** Speed in knots, and the direction the water flows **towards** in degrees. */
  velocity_knots: number;
  direction_deg: number;
  /** Forecast hour these values describe; null or absent means current conditions. */
  time?: string | null;
}

/** GET /api/currents/grid payload; land nodes are absent rather than zero. */
export interface CurrentGridResponse {
  points: CurrentPoint[];
  time: string | null;
}

/** The grid point whose barb is selected (highlighted) on the map. */
export type SelectedGridPoint = Pick<GridWindPoint, 'latitude' | 'longitude'>;
