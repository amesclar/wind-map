import { describe, expect, it } from 'vitest';
import {
  BARB_LEGEND_KNOTS,
  barbLegendEntries,
  buildExportBaseName,
  buildExportFileName,
  buildExportFooter,
  buildExportHeader,
  temperatureBands,
} from './mapExport';
import { getTemperatureColor } from '../components/WindBarb';

const CAPTURED = new Date('2026-11-23T04:05:00Z');

describe('buildExportHeader (SCRUM-116)', () => {
  it('names the forecast hour in local time and UTC with the model and run', () => {
    const header = buildExportHeader({
      validTime: '2026-11-23T04:00:00Z',
      timezone: 'America/Los_Angeles',
      modelName: 'NOAA GFS Seamless',
      runTimeUtc: '2026-11-23T00:00:00Z',
      capturedAt: CAPTURED,
    });
    expect(header.title).toBe('Wind Map · Sun 22 Nov 20:00 GMT-8');
    expect(header.lines[0]).toContain('Forecast hour');
    expect(header.lines[0]).toContain('Mon 23 Nov 04:00 UTC');
    expect(header.lines[0]).toContain('Sun 22 Nov 20:00 GMT-8');
    expect(header.lines[1]).toContain('Model: NOAA GFS Seamless');
    expect(header.lines[1]).toContain('Run: Mon 23 Nov 00:00 UTC');
    expect(header.lines[1]).toContain('Captured:');
  });

  it('uses the current hour for live values and omits an unknown run time', () => {
    const header = buildExportHeader({
      validTime: null,
      timezone: 'UTC',
      modelName: 'Open-Meteo (Best Match)',
      capturedAt: CAPTURED,
    });
    expect(header.title).toBe('Wind Map · Mon 23 Nov 04:00 UTC');
    expect(header.lines[0].startsWith('Current hour')).toBe(true);
    expect(header.lines[1]).not.toContain('Run:');
  });
});

describe('buildExportFooter (SCRUM-116)', () => {
  it('carries the units, attribution and app version', () => {
    expect(
      buildExportFooter({
        unitSystem: 'imperial',
        speedUnit: 'mph',
        attribution: '© OpenStreetMap contributors © CARTO',
        version: '0.7.0',
      }),
    ).toBe('Units: mph, °F · © OpenStreetMap contributors © CARTO · Wind Map v0.7.0');
    expect(
      buildExportFooter({
        unitSystem: 'metric',
        speedUnit: 'ms',
        attribution: '© OpenStreetMap contributors',
        version: '1.2.3',
      }),
    ).toContain('Units: m/s, °C · © OpenStreetMap contributors · Wind Map v1.2.3');
  });
});

describe('buildExportFileName (SCRUM-116)', () => {
  it('names the file after the shown hour, its zone and the format', () => {
    expect(
      buildExportFileName({
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'America/Los_Angeles',
        extension: 'png',
      }),
    ).toBe('wind-map_2026-11-18_1400PST.png');
    expect(
      buildExportFileName({ validTime: '2026-11-18T22:00:00Z', timezone: 'UTC', extension: 'jpeg' }),
    ).toBe('wind-map_2026-11-18_2200UTC.jpeg');
  });

  it('keeps an extension-free base name for the dialog preview (SCRUM-117)', () => {
    expect(
      buildExportBaseName({ validTime: '2026-11-18T22:00:00Z', timezone: 'America/Los_Angeles' }),
    ).toBe('wind-map_2026-11-18_1400PST');
    expect(
      buildExportFileName({ validTime: '2026-11-18T22:00:00Z', timezone: 'UTC', extension: 'pdf' }),
    ).toBe('wind-map_2026-11-18_2200UTC.pdf');
  });

  it('falls back to the capture time and strips punctuation from zone names', () => {
    const name = buildExportFileName({
      validTime: null,
      timezone: 'Asia/Kolkata',
      extension: 'png',
      now: new Date('2026-11-18T08:30:00Z'),
    });
    expect(name).toMatch(/^wind-map_2026-11-18_1400[A-Za-z0-9]+\.png$/);
  });
});

describe('legend contents (SCRUM-116)', () => {
  it('labels the four barb glyphs in the chosen speed unit', () => {
    const knots = barbLegendEntries('knots');
    expect(knots.map((e) => e.knots)).toEqual([...BARB_LEGEND_KNOTS]);
    expect(knots.map((e) => e.caption)).toEqual(['calm', '5 kt', '10 kt', '50 kt']);

    const kmh = barbLegendEntries('kmh');
    expect(kmh.map((e) => e.caption)).toEqual(['calm', '9 km/h', '19 km/h', '93 km/h']);

    const mph = barbLegendEntries('mph');
    expect(mph[1].caption).toBe('6 mph');
  });

  it('uses the same temperature colors as the barbs, labelled in the unit system', () => {
    const imperial = temperatureBands('imperial');
    expect(imperial[0].color).toBe(getTemperatureColor(20));
    expect(imperial[1].color).toBe(getTemperatureColor(40));
    expect(imperial[2].color).toBe(getTemperatureColor(60));
    expect(imperial[3].color).toBe(getTemperatureColor(70));
    expect(imperial[4].color).toBe(getTemperatureColor(85));
    expect(imperial[5].color).toBe(getTemperatureColor(95));
    expect(imperial[0].caption).toBe('≤ 32°F');
    expect(imperial[5].caption).toBe('> 90°F');

    const metric = temperatureBands('metric');
    expect(metric[0].caption).toBe('≤ 0°C');
    expect(metric[3].caption).toBe('20°C–27°C');
  });
});
