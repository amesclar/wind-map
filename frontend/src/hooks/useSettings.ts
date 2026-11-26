import { useCallback, useState } from 'react';
import { isLightBase } from '../components/mapTiles';
import { DEFAULT_TIMEZONE, STORAGE_KEYS, TIMEZONES } from '../constants';
import type { AppConfig, MapTileLayer, UnitSystem, WindDirDisplay, WindSpeedUnit } from '../types';
import { useLocalStorageState } from './useLocalStorageState';

const TILE_LAYER_IDS: readonly MapTileLayer[] = [
  'carto_dark',
  'osm_dark',
  'osm_standard',
  'paper_chart',
  'seamap',
];

const parseTileLayer = (stored: string | null): MapTileLayer =>
  TILE_LAYER_IDS.includes(stored as MapTileLayer) ? (stored as MapTileLayer) : 'osm_dark';
const parseApiKey = (stored: string | null) => stored ?? '';
const serializeApiKey = (key: string) => key || null; // empty key removes it
const parseOverlay = (stored: string | null) => stored === null || stored === 'true'; // default on
const parseColorOverlay = (stored: string | null) => stored === 'true'; // default off (SCRUM-124)
// Off by default: the chart reduces the gradient on its own, so only other bases change (SCRUM-213).
const parseHighContrast = (stored: string | null) => stored === 'true';
const parseCurrents = (stored: string | null) => stored === 'true'; // default off (SCRUM-99)
const parseWaves = (stored: string | null) => stored === 'true'; // default off (SCRUM-234)
const parseSeamarks = (stored: string | null) => stored === 'true'; // default off (SCRUM-175)
const parseBcDepth = (stored: string | null) => stored === 'true'; // default off (SCRUM-205)

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
  const [windColorOverlayVisible, setWindColorOverlayVisible] = useLocalStorageState(
    STORAGE_KEYS.windColorOverlayVisible,
    parseColorOverlay,
  );
  // High contrast gradient (SCRUM-213): opt-in, so the chart's automatic reduction is the only
  // default and the other bases keep full colour until asked otherwise.
  const [windColorHighContrast, setWindColorHighContrast] = useLocalStorageState(
    STORAGE_KEYS.windColorHighContrast,
    parseHighContrast,
  );
  // Set by the layer toggle in SCRUM-100; the overlay itself ships in SCRUM-99.
  const [waterCurrentsVisible, setWaterCurrentsVisible] = useLocalStorageState(
    STORAGE_KEYS.waterCurrentsVisible,
    parseCurrents,
  );
  // Nautical seamark overlay (SCRUM-175): a community tile server, so off unless asked for.
  // Ocean waves (SCRUM-234): its own layer and fetch, like the currents.
  const [wavesVisible, setWavesVisible] = useLocalStorageState(STORAGE_KEYS.waterWavesVisible, parseWaves);
  const [seamarksVisible, setSeamarksVisible] = useLocalStorageState(
    STORAGE_KEYS.seamarks,
    parseSeamarks,
  );
  // B.C. depth context (SCRUM-205): CHS NONNA is an extra overseas request per tile, so off too.
  const [bcDepthVisible, setBcDepthVisible] = useLocalStorageState(
    STORAGE_KEYS.bcDepth,
    parseBcDepth,
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
        // A stored light base - the paper chart (SCRUM-203) or Seamap (SCRUM-206) - outranks the
        // key's session default, or the mode would be unreachable in production after every reload,
        // where the server key is always present. The key itself is still adopted, so switching to
        // CARTO later does not need a reload.
        if (!isLightBase(storedTileLayer)) setSessionTileLayer('carto_dark');
      }
    },
    [cartoApiKey, storedTileLayer],
  );

  return {
    tileLayer,
    setTileLayer,
    cartoApiKey: cartoApiKey || serverKey,
    saveCartoApiKey,
    windOverlayVisible,
    setWindOverlayVisible,
    windColorOverlayVisible,
    setWindColorOverlayVisible,
    windColorHighContrast,
    setWindColorHighContrast,
    waterCurrentsVisible,
    setWaterCurrentsVisible,
    wavesVisible,
    setWavesVisible,
    seamarksVisible,
    setSeamarksVisible,
    bcDepthVisible,
    setBcDepthVisible,
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
