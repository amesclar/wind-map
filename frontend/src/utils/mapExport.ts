/**
 * Header, footer, legend contents and file name for the map image export (SCRUM-116).
 *
 * Pure functions so the wording, units, timezone handling and file naming are unit tested
 * without a canvas or a browser.
 */
import type { UnitSystem, WindSpeedUnit } from '../types';
import { formatStepLabel, floorToHour } from './forecastWindow';
import { formatTemperatureFromF, roundKnotsInUnit, SPEED_UNIT_LABEL } from './units';

export interface ExportHeaderInput {
  /** Selected forecast hour (ISO 8601); null means the app is showing live values. */
  validTime: string | null;
  timezone: string;
  modelName: string;
  /** Model run time, ISO UTC (SCRUM-115); omitted when unknown. */
  runTimeUtc?: string | null;
  /** When the export is taken, used for the live case and the "captured" note. */
  capturedAt: Date;
}

export interface ExportHeader {
  /** Front line: the app name and the hour the image shows, in the user's timezone. */
  title: string;
  /** Reference lines: local and UTC time, model and run, capture time. */
  lines: string[];
}

/** Title plus two reference lines for the top of the image. */
export function buildExportHeader({
  validTime,
  timezone,
  modelName,
  runTimeUtc = null,
  capturedAt,
}: ExportHeaderInput): ExportHeader {
  // Live values describe the current hour, so the header names that hour rather than a minute.
  const iso = validTime ?? floorToHour(capturedAt).toISOString();
  const local = formatStepLabel(iso, timezone);
  const utc = formatStepLabel(iso, 'UTC');
  const captured = formatStepLabel(capturedAt.toISOString(), timezone);
  const run = runTimeUtc ? formatStepLabel(runTimeUtc, 'UTC') : null;
  return {
    title: `Wind Map · ${local}`,
    lines: [
      `${validTime ? 'Forecast hour' : 'Current hour'} · ${local} · ${utc}`,
      `Model: ${modelName}${run ? ` · Run: ${run}` : ''} · Captured: ${captured}`,
    ],
  };
}

export interface ExportFooterInput {
  unitSystem: UnitSystem;
  speedUnit: WindSpeedUnit;
  /** Plain-text attribution of the base map, e.g. "© OpenStreetMap contributors © CARTO". */
  attribution: string;
  version: string;
}

/** Units, the base-map attribution (required by OSM and CARTO) and the app version. */
export function buildExportFooter({ unitSystem, speedUnit, attribution, version }: ExportFooterInput): string {
  const temperature = unitSystem === 'imperial' ? '°F' : '°C';
  return `Units: ${SPEED_UNIT_LABEL[speedUnit]}, ${temperature} · ${attribution} · Wind Map v${version}`;
}

export interface ExportFileNameInput {
  validTime: string | null;
  timezone: string;
  extension: 'png' | 'jpeg';
  /** Capture time, used when no forecast hour is selected. */
  now?: Date;
}

const DATE_PARTS = (timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

const TIME_PARTS = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const ZONE_NAME = (timezone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' });

/** e.g. "wind-map_2026-11-18_1400PST.png": the shown hour, its zone and the format. */
export function buildExportFileName({
  validTime,
  timezone,
  extension,
  now = new Date(),
}: ExportFileNameInput): string {
  const date = new Date(validTime ?? now.toISOString());
  const part = (formatter: Intl.DateTimeFormat, type: Intl.DateTimeFormatPartTypes) =>
    formatter.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  const localDate = DATE_PARTS(timezone);
  const localTime = TIME_PARTS(timezone);
  const year = part(localDate, 'year');
  const month = part(localDate, 'month');
  const day = part(localDate, 'day');
  const hour = part(localTime, 'hour');
  const minute = part(localTime, 'minute');
  // "PST" stays; "GMT+2" loses its sign so the name stays portable.
  const zone = part(ZONE_NAME(timezone), 'timeZoneName').replace(/[^A-Za-z0-9]/g, '') || 'UTC';
  return `wind-map_${year}-${month}-${day}_${hour}${minute}${zone}.${extension}`;
}

export interface BarbLegendEntry {
  /** Speed in knots the glyph shows. */
  knots: number;
  /** Caption in the chosen speed unit, e.g. "9 km/h" or "calm". */
  caption: string;
}

/** The four glyphs in the legend: calm, a half barb, a full barb and a 50 kt pennant. */
export const BARB_LEGEND_KNOTS = [0, 5, 10, 50] as const;

export function barbLegendEntries(speedUnit: WindSpeedUnit): BarbLegendEntry[] {
  const unit = SPEED_UNIT_LABEL[speedUnit];
  return BARB_LEGEND_KNOTS.map((knots) => ({
    knots,
    caption: knots === 0 ? 'calm' : `${roundKnotsInUnit(knots, speedUnit)} ${unit}`,
  }));
}

export interface TemperatureBand {
  /** Same colors the barbs use (see `getTemperatureColor`). */
  color: string;
  caption: string;
}

/** The barb temperature classes, labelled in the user's temperature unit. */
export function temperatureBands(unitSystem: UnitSystem): TemperatureBand[] {
  const t = (fahrenheit: number) => formatTemperatureFromF(fahrenheit, unitSystem);
  return [
    { color: '#60a5fa', caption: `≤ ${t(32)}` },
    { color: '#2dd4bf', caption: `${t(32)}–${t(50)}` },
    { color: '#4ade80', caption: `${t(50)}–${t(68)}` },
    { color: '#fbbf24', caption: `${t(68)}–${t(80)}` },
    { color: '#fb923c', caption: `${t(80)}–${t(90)}` },
    { color: '#ef4444', caption: `> ${t(90)}` },
  ];
}
