import {
  SavedLocation,
  GeocodeResult,
  WeatherForecastResponse,
  WeatherModel,
} from '../types';

const API_BASE = '/api';

export async function fetchLocations(): Promise<SavedLocation[]> {
  const res = await fetch(`${API_BASE}/locations`);
  if (!res.ok) throw new Error('Failed to load locations');
  return res.json();
}

export async function addLocation(data: {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string | null;
  country?: string | null;
}): Promise<SavedLocation> {
  const res = await fetch(`${API_BASE}/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to add location');
  return res.json();
}

export async function deleteLocation(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/locations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete location');
}

export async function fetchModels(): Promise<WeatherModel[]> {
  const res = await fetch(`${API_BASE}/weather/models`);
  if (!res.ok) throw new Error('Failed to load weather models');
  return res.json();
}

export async function fetchWeather(
  locationId: number,
  model: string = 'best_match',
  timezone: string = 'America/Los_Angeles'
): Promise<WeatherForecastResponse> {
  const params = new URLSearchParams({
    location_id: locationId.toString(),
    model,
    timezone,
  });
  const res = await fetch(`${API_BASE}/weather?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load weather data');
  return res.json();
}

export async function fetchAllWeather(
  model: string = 'best_match',
  timezone: string = 'America/Los_Angeles'
): Promise<WeatherForecastResponse[]> {
  const params = new URLSearchParams({ model, timezone });
  const res = await fetch(`${API_BASE}/weather/all?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load all weather data');
  return res.json();
}

export async function searchGeocode(query: string): Promise<GeocodeResult[]> {
  if (!query || query.trim().length < 2) return [];
  const res = await fetch(
    `${API_BASE}/geocode?q=${encodeURIComponent(query.trim())}`
  );
  if (!res.ok) return [];
  return res.json();
}
