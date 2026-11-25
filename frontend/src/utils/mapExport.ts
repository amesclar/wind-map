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

export type ExportExtension = 'png' | 'jpeg' | 'pdf';

export interface ExportBaseNameInput {
  /** `/api/weather/models` id, e.g. "ecmwf_ifs"; the name leads with it (SCRUM-163). */
  modelId: string;
  validTime: string | null;
  timezone: string;
  /** Capture time, used when no forecast hour is selected. */
  now?: Date;
}

/**
 * The model part of a generated file name (SCRUM-163): lower-case, spaces to underscores, with
 * only `[a-z0-9_-]` kept and repeats collapsed. A missing or unusable id falls back to
 * "wind-map", so an export is never named after nothing.
 */
export function exportModelPrefix(modelId: string | null | undefined): string {
  const slug = (modelId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'wind-map';
}

export interface ExportFileNameInput extends ExportBaseNameInput {
  extension: ExportExtension;
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

/** e.g. "ecmwf_ifs_2026-11-18_1400PST": the model, the shown hour and its zone, no extension. */
export function buildExportBaseName({
  modelId,
  validTime,
  timezone,
  now = new Date(),
}: ExportBaseNameInput): string {
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
  return `${exportModelPrefix(modelId)}_${year}-${month}-${day}_${hour}${minute}${zone}`;
}

/** The same name with the format's extension, e.g. "ecmwf_ifs_…1400PST.png", ".jpeg" or ".pdf". */
export function buildExportFileName({ extension, ...input }: ExportFileNameInput): string {
  return `${buildExportBaseName(input)}.${extension}`;
}

export type RangeArchiveExtension = 'zip' | 'pdf';

export interface RangeArchiveNameInput {
  modelId: string;
  /** The captured hours, used for the first hour and the count. */
  hours: string[];
  timezone: string;
  extension: RangeArchiveExtension;
}

/**
 * Name for a whole-range download (SCRUM-156): the model, the first hour and the frame count, e.g.
 * "best_match_2026-11-23_1200PST_5hours.zip". The count keeps cross-day ranges unambiguous.
 */
export function buildRangeArchiveName({
  modelId,
  hours,
  timezone,
  extension,
}: RangeArchiveNameInput): string {
  const prefix = exportModelPrefix(modelId);
  if (hours.length === 0) return `${prefix}_range.${extension}`;
  const first = buildExportBaseName({ modelId, validTime: hours[0], timezone });
  const count = hours.length;
  return `${first}_${count}hour${count === 1 ? '' : 's'}.${extension}`;
}

/** Path separators, reserved characters and control characters that are stripped from user names. */
// Control characters cannot appear in a portable file name, so they are matched deliberately.
// eslint-disable-next-line no-control-regex
const RESERVED_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const KNOWN_EXPORT_EXTENSION = /\.(?:png|jpe?g|pdf)$/i;

/**
 * Clean a name the user typed in the export dialog (SCRUM-162): remove path separators and reserved
 * characters, ignore a typed extension, fall back to the generated name when nothing usable is
 * left, and append the chosen format's extension. Spaces and non-ASCII letters are kept.
 */
export function sanitizeExportFileName(
  name: string,
  extension: ExportExtension,
  fallback: string,
): string {
  const cleaned = name
    .replace(KNOWN_EXPORT_EXTENSION, '')
    .replace(RESERVED_FILE_NAME_CHARS, '')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return `${cleaned || fallback}.${extension}`;
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
