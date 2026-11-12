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
}

export interface WeatherModel {
  id: string;
  name: string;
}

export type UnitSystem = 'imperial' | 'metric';
export type WindSpeedUnit = 'knots' | 'kmh' | 'mph' | 'ms';
export type WindDirDisplay = 'barb' | 'cardinal' | 'deg';


export type MapTileLayer = 'carto_dark' | 'osm_dark' | 'osm_standard';
