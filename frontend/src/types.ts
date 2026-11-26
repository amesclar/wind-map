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
  /** SCRUM-225: null when Open-Meteo has no value; shown as "No data", never as 0 or 32 °F. */
  temperature_c: number | null;
  temperature_f: number | null;
  wind_speed_knots: number | null;
  wind_speed_kmh: number | null;
  wind_speed_mph: number | null;
  wind_speed_ms: number | null;
  wind_gust_knots: number | null;
  wind_gust_kmh: number | null;
  wind_gust_mph: number | null;
  wind_gust_ms: number | null;
  wind_direction_deg: number | null;
  wind_direction_cardinal: string | null;
  /** null when the provider has no value for the hour (NDFD can gap); not rendered today. */
  humidity: number | null;
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

/**
 * GET /api/weather/models/{model}/availability (SCRUM-256): when the newest run of the selected
 * model was published, and when the next one is due. Every field is null for a model with no
 * single upstream run (best_match, the seamless blends), which keeps the derived cycle clock.
 */
export interface ModelAvailability {
  model: string;
  run_utc: string | null;
  available_utc: string | null;
  next_available_utc: string | null;
}

export type UnitSystem = 'imperial' | 'metric';
export type WindSpeedUnit = 'knots' | 'kmh' | 'mph' | 'ms';
export type WindDirDisplay = 'barb' | 'cardinal' | 'deg';

/**
 * Base maps; `paper_chart` is the NOAA chart (SCRUM-203) and `seamap` the Open Waters vector style
 * (SCRUM-206). Both are light sheets and must not be darkened.
 */
export type MapTileLayer = 'carto_dark' | 'osm_dark' | 'osm_standard' | 'paper_chart' | 'seamap' | 'google_satellite';

/** Body of POST /api/locations. */
export type NewLocation = Pick<SavedLocation, 'name' | 'latitude' | 'longitude' | 'admin1' | 'country'>;

/** GET /api/config. */
export interface AppConfig {
  carto_api_key?: string;
  /** True when the server has Jira credentials, so the feedback button is shown (SCRUM-179). */
  feedback_enabled?: boolean;
  /** True when GCP_MAP_KEY is set, enabling Google Satellite basemap (SCRUM-311). */
  google_satellite_enabled?: boolean;
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
  /** Up to 3 validated files, sent in the same multipart request (SCRUM-219). */
  files?: File[];
}

/** Response of POST /api/feedback: the Jira issue that was created. */
export interface FeedbackResult {
  issue_key: string;
  issue_url: string;
  /** True when the issue was filed but its files could not be attached (SCRUM-219). */
  attachments_failed?: boolean;
}

/** One point of GET /api/weather/grid. */
export interface GridWindPoint {
  latitude: number;
  longitude: number;
  /** SCRUM-225: null when the model has no value for the point; no barb is drawn for it. */
  wind_speed_knots: number | null;
  /** Gust for the same moment (SCRUM-210); absent when the model has none for the point. */
  wind_gust_knots?: number | null;
  wind_direction_deg: number | null;
  /** Temperature in °F; colors the map barb (SCRUM-89). */
  temperature_f?: number | null;
  /** Forecast hour these values describe (SCRUM-115); null or absent means current. */
  time?: string | null;
}

/** One point of GET /api/currents/grid (SCRUM-96). */
export interface CurrentPoint {
  /** The Marine model cell the value came from, not the requested map point (SCRUM-238). */
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

/** One point of GET /api/waves/grid (SCRUM-234). */
export interface WavePoint {
  /** The Marine model cell the value came from, not the requested map point. */
  latitude: number;
  longitude: number;
  /** Significant wave height in metres; the UI converts to feet for imperial. */
  height_m: number;
  /** Where the waves come **from**, meteorological convention; the arrow adds 180°. */
  direction_deg: number;
  /** Peak period in seconds. */
  period_s: number;
  /** Forecast hour these values describe; null or absent means current conditions. */
  time?: string | null;
}

/** GET /api/waves/grid payload; inland nodes are absent rather than zero. */
export interface WaveGridResponse {
  points: WavePoint[];
  time: string | null;
}

/** One hourly value of GET /api/waves/point (SCRUM-233). */
export interface WaveSeriesPoint {
  time: string;
  height_m: number;
  direction_deg: number;
  period_s: number;
}

/** GET /api/waves/point payload: hourly waves from the current hour, empty inland. */
export interface WavePointResponse {
  latitude: number;
  longitude: number;
  horizon_hours: number;
  points: WaveSeriesPoint[];
}

/** The grid point whose barb is selected (highlighted) on the map. */
export type SelectedGridPoint = Pick<GridWindPoint, 'latitude' | 'longitude'>;

/** One hourly sea-level sample from GET /api/tides/point (SCRUM-195). */
export interface TideSample {
  /** UTC minute stamp, e.g. `2026-11-25T12:00`; read it as UTC. */
  time: string;
  /** Metres above global mean sea level. */
  height_m: number;
}

/** A high or low tide, time refined to the minute (SCRUM-195). */
export interface TideExtreme {
  type: 'high' | 'low';
  time: string;
  height_m: number;
}

/** GET /api/tides/point payload; `points` is empty over land (SCRUM-195). */
export interface TidePointResponse {
  latitude: number;
  longitude: number;
  /** The reference for the heights: mean sea level, not a chart datum. */
  datum: string;
  unit: string;
  hour: string;
  points: TideSample[];
  last_extreme: TideExtreme | null;
  next_extreme: TideExtreme | null;
  /** The extreme after the next one (SCRUM-250). */
  next_extreme_after: TideExtreme | null;
}
