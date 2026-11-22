import { useCallback, useState } from 'react';
import { DEFAULT_TIMEZONE, STORAGE_KEYS, TIMEZONES } from '../constants';
import type { AppConfig, MapTileLayer, UnitSystem, WindDirDisplay, WindSpeedUnit } from '../types';
import { useLocalStorageState } from './useLocalStorageState';

const TILE_LAYER_IDS: readonly MapTileLayer[] = ['carto_dark', 'osm_dark', 'osm_standard'];

const parseTileLayer = (stored: string | null): MapTileLayer =>
  TILE_LAYER_IDS.includes(stored as MapTileLayer) ? (stored as MapTileLayer) : 'osm_dark';
const parseApiKey = (stored: string | null) => stored ?? '';
const serializeApiKey = (key: string) => key || null; // empty key removes it
const parseOverlay = (stored: string | null) => stored === null || stored === 'true'; // default on

/** Tile layer, CARTO API key and wind overlay visibility, persisted to localStorage. */
export function useMapSettings() {
  const [storedTileLayer, setStoredTileLayer] = useLocalStorageState(STORAGE_KEYS.tileLayer, parseTileLayer);
  // Layer chosen for this session only (server-provided CARTO key); never saved.
  const [sessionTileLayer, setSessionTileLayer] = useState<MapTileLayer | null>(null);
  const tileLayer = sessionTileLayer ?? storedTileLayer;
  const setTileLayer = useCallback(
    (layer: MapTileLayer) => {
      setSessionTileLayer(null);
      setStoredTileLayer(layer);
    },
    [setStoredTileLayer],
  );
  const [cartoApiKey, setCartoApiKeyState] = useLocalStorageState(
    STORAGE_KEYS.cartoApiKey,
    parseApiKey,
    serializeApiKey,
  );
  const [windOverlayVisible, setWindOverlayVisible] = useLocalStorageState(
    STORAGE_KEYS.windOverlayVisible,
    parseOverlay,
  );

  /** Saving a key switches to the CARTO layer; clearing it keeps the current layer. */
  const saveCartoApiKey = useCallback(
    (key: string) => {
      setCartoApiKeyState(key);
      if (key) setTileLayer('carto_dark');
    },
    [setCartoApiKeyState, setTileLayer],
  );

  /** Use the server's CARTO key unless the user saved their own (server key isn't stored). */
  const [serverKey, setServerKey] = useState('');
  const applyServerConfig = useCallback(
    (config: AppConfig) => {
      if (config.carto_api_key && !cartoApiKey) {
        setServerKey(config.carto_api_key);
        setSessionTileLayer('carto_dark');
      }
    },
    [cartoApiKey],
  );

  return {
    tileLayer,
    setTileLayer,
    cartoApiKey: cartoApiKey || serverKey,
    saveCartoApiKey,
    windOverlayVisible,
    setWindOverlayVisible,
    applyServerConfig,
  };
}

const UNIT_SYSTEMS: readonly UnitSystem[] = ['imperial', 'metric'];
const SPEED_UNITS: readonly WindSpeedUnit[] = ['knots', 'kmh', 'mph', 'ms'];
const DIR_DISPLAYS: readonly WindDirDisplay[] = ['barb', 'cardinal', 'deg'];

/** Parser returning the stored value when it is one of `allowed`, else `fallback`. */
const oneOf =
  <T extends string>(allowed: readonly T[], fallback: T) =>
  (stored: string | null): T =>
    allowed.includes(stored as T) ? (stored as T) : fallback;

const parseUnitSystem = oneOf(UNIT_SYSTEMS, 'imperial');
const parseSpeedUnit = oneOf(SPEED_UNITS, 'knots');
const parseDirDisplay = oneOf(DIR_DISPLAYS, 'barb');
const parseTimezone = oneOf(
  TIMEZONES.map((tz) => tz.id),
  DEFAULT_TIMEZONE,
);

/** Temperature unit, wind speed unit and direction display, persisted and independent (SCRUM-107). */
export function useUnitPreferences() {
  const [unitSystem, setUnitSystem] = useLocalStorageState(STORAGE_KEYS.unitSystem, parseUnitSystem);
  const [speedUnit, setSpeedUnit] = useLocalStorageState(STORAGE_KEYS.speedUnit, parseSpeedUnit);
  const [dirDisplay, setDirDisplay] = useLocalStorageState(STORAGE_KEYS.dirDisplay, parseDirDisplay);
  return { unitSystem, setUnitSystem, speedUnit, setSpeedUnit, dirDisplay, setDirDisplay };
}

/** Display timezone, persisted (SCRUM-107). */
export function useTimezone() {
  const [timezone, setTimezone] = useLocalStorageState(STORAGE_KEYS.timezone, parseTimezone);
  return { timezone, setTimezone };
}
