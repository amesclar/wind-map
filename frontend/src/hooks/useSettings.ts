import { useCallback, useState } from 'react';
import { STORAGE_KEYS } from '../constants';
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

/** Temperature system, wind speed unit and direction display (not persisted). */
export function useUnitPreferences() {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [speedUnit, setSpeedUnit] = useState<WindSpeedUnit>('knots');
  const [dirDisplay, setDirDisplay] = useState<WindDirDisplay>('barb');

  /** Imperial ↔ metric also switches the speed unit (knots ↔ km/h). */
  const toggleUnitSystem = useCallback(() => {
    const next: UnitSystem = unitSystem === 'imperial' ? 'metric' : 'imperial';
    setUnitSystem(next);
    setSpeedUnit(next === 'metric' ? 'kmh' : 'knots');
  }, [unitSystem]);

  return { unitSystem, toggleUnitSystem, speedUnit, setSpeedUnit, dirDisplay, setDirDisplay };
}
