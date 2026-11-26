import { describe, expect, it } from 'vitest';
import {
  BARB_LEGEND_KNOTS,
  barbLegendEntries,
  buildExportBaseName,
  buildExportFileName,
  buildExportFooter,
  buildExportHeader,
  buildRangeArchiveName,
  exportModelPrefix,
  sanitizeExportFileName,
  temperatureBands,
} from './mapExport';
import { CHART_TEMPERATURE_BANDS, getTemperatureColor } from '../components/WindBarb';

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
  it('credits OpenSeaMap and adds the navigation notice only with the seamark overlay on (SCRUM-175)', () => {
    const base = {
      unitSystem: 'imperial' as const,
      speedUnit: 'knots' as const,
      attribution: '© OpenStreetMap contributors',
      version: '0.10.0',
    };
    expect(buildExportFooter(base)).not.toContain('OpenSeaMap');
    const withSeamarks = buildExportFooter({ ...base, seamarks: true });
    expect(withSeamarks).toContain('Seamarks © OpenSeaMap contributors · Not for navigation');
    expect(withSeamarks.endsWith('· Wind Map v0.10.0')).toBe(true);
  });

  it('credits CHS NONNA only with the B.C. depth overlay on, ahead of the seamark credit (SCRUM-205)', () => {
    const base = {
      unitSystem: 'imperial' as const,
      speedUnit: 'knots' as const,
      attribution: '© NOAA Office of Coast Survey · Not for navigation',
      version: '0.10.0',
    };
    expect(buildExportFooter(base)).not.toContain('CHS');

    const withDepth = buildExportFooter({ ...base, bcDepth: true });
    expect(withDepth).toContain('Bathymetry © CHS NONNA · Not for navigation');
    expect(withDepth.endsWith('· Wind Map v0.10.0')).toBe(true);

    const both = buildExportFooter({ ...base, bcDepth: true, seamarks: true });
    expect(both.indexOf('CHS NONNA')).toBeLessThan(both.indexOf('OpenSeaMap'));
  });

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
        modelId: 'best_match',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'America/Los_Angeles',
        extension: 'png',
      }),
    ).toBe('best_match_2026-11-18_1400PST.png');
    expect(
      buildExportFileName({
        modelId: 'best_match',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'UTC',
        extension: 'jpeg',
      }),
    ).toBe('best_match_2026-11-18_2200UTC.jpeg');
  });

  it('leads with the selected model, so exports from different models differ (SCRUM-163)', () => {
    expect(
      buildExportFileName({
        modelId: 'ecmwf_ifs',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'America/Los_Angeles',
        extension: 'png',
      }),
    ).toBe('ecmwf_ifs_2026-11-18_1400PST.png');
    expect(
      buildExportFileName({
        modelId: 'gfs_seamless',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'UTC',
        extension: 'pdf',
      }),
    ).toBe('gfs_seamless_2026-11-18_2200UTC.pdf');
  });

  it('falls back to wind-map when the model id is unknown (SCRUM-163)', () => {
    expect(
      buildExportFileName({
        modelId: '',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'UTC',
        extension: 'png',
      }),
    ).toBe('wind-map_2026-11-18_2200UTC.png');
  });

  it('keeps an extension-free base name for the dialog preview (SCRUM-117)', () => {
    expect(
      buildExportBaseName({
        modelId: 'best_match',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'America/Los_Angeles',
      }),
    ).toBe('best_match_2026-11-18_1400PST');
    expect(
      buildExportFileName({
        modelId: 'best_match',
        validTime: '2026-11-18T22:00:00Z',
        timezone: 'UTC',
        extension: 'pdf',
      }),
    ).toBe('best_match_2026-11-18_2200UTC.pdf');
  });

  it('falls back to the capture time and strips punctuation from zone names', () => {
    const name = buildExportFileName({
      modelId: 'best_match',
      validTime: null,
      timezone: 'Asia/Kolkata',
      extension: 'png',
      now: new Date('2026-11-18T08:30:00Z'),
    });
    expect(name).toMatch(/^best_match_2026-11-18_1400[A-Za-z0-9]+\.png$/);
  });
});

describe('buildRangeArchiveName (SCRUM-156)', () => {
  const hours = [
    '2026-11-23T22:00:00.000Z',
    '2026-11-23T23:00:00.000Z',
    '2026-11-24T00:00:00.000Z',
  ];

  it('names a ZIP from the model, the first hour and the frame count', () => {
    expect(
      buildRangeArchiveName({
        modelId: 'best_match',
        hours,
        timezone: 'America/Los_Angeles',
        extension: 'zip',
      }),
    ).toBe('best_match_2026-11-23_1400PST_3hours.zip');
  });

  it('names a PDF the same way and uses the singular for one hour', () => {
    expect(
      buildRangeArchiveName({
        modelId: 'ecmwf_ifs',
        hours: [hours[0]],
        timezone: 'America/Los_Angeles',
        extension: 'pdf',
      }),
    ).toBe('ecmwf_ifs_2026-11-23_1400PST_1hour.pdf');
  });

  it('falls back to wind-map and a range suffix without hours', () => {
    expect(
      buildRangeArchiveName({ modelId: '', hours: [], timezone: 'UTC', extension: 'zip' }),
    ).toBe('wind-map_range.zip');
  });
});

describe('exportModelPrefix (SCRUM-163)', () => {
  it('keeps a filename-safe lower-case model id', () => {
    expect(exportModelPrefix('ecmwf_ifs')).toBe('ecmwf_ifs');
    expect(exportModelPrefix('gfs_seamless')).toBe('gfs_seamless');
    expect(exportModelPrefix('best_match')).toBe('best_match');
  });

  it('lower-cases and replaces anything a file name cannot carry', () => {
    expect(exportModelPrefix(' GFS Seamless ')).toBe('gfs_seamless');
    expect(exportModelPrefix('ECMWF/IFS 0.25')).toBe('ecmwf_ifs_0_25');
    expect(exportModelPrefix('a//b')).toBe('a_b');
  });

  it('falls back to wind-map rather than producing an empty prefix', () => {
    expect(exportModelPrefix('')).toBe('wind-map');
    expect(exportModelPrefix('   ')).toBe('wind-map');
    expect(exportModelPrefix('...')).toBe('wind-map');
    expect(exportModelPrefix(undefined)).toBe('wind-map');
  });
});

describe('sanitizeExportFileName (SCRUM-162)', () => {
  const fallback = 'wind-map_2026-11-18_1400PST';

  it('keeps a plain name and appends the chosen extension', () => {
    expect(sanitizeExportFileName('my map', 'png', fallback)).toBe('my map.png');
    expect(sanitizeExportFileName('my map', 'jpeg', fallback)).toBe('my map.jpeg');
    expect(sanitizeExportFileName('my map', 'pdf', fallback)).toBe('my map.pdf');
  });

  it('removes path separators and reserved characters', () => {
    expect(sanitizeExportFileName('../a\\b:c*?"<>|d', 'png', fallback)).toBe('abcd.png');
    expect(sanitizeExportFileName('folder/name\\', 'pdf', fallback)).toBe('foldername.pdf');
  });

  it('ignores a typed extension so it cannot double up', () => {
    expect(sanitizeExportFileName('chart.PNG', 'jpeg', fallback)).toBe('chart.jpeg');
    expect(sanitizeExportFileName('chart.jpg', 'png', fallback)).toBe('chart.png');
    expect(sanitizeExportFileName('chart.pdf', 'png', fallback)).toBe('chart.png');
  });

  it('falls back when the name is empty, whitespace or only dots', () => {
    expect(sanitizeExportFileName('', 'png', fallback)).toBe(`${fallback}.png`);
    expect(sanitizeExportFileName('   ', 'png', fallback)).toBe(`${fallback}.png`);
    expect(sanitizeExportFileName('...', 'pdf', fallback)).toBe(`${fallback}.pdf`);
  });

  it('keeps spaces and non-ASCII letters, trimming the ends', () => {
    expect(sanitizeExportFileName('  Carte été  ', 'png', fallback)).toBe('Carte été.png');
  });
});

describe('legend contents (SCRUM-116)', () => {
  it('labels the six barb glyphs in the chosen speed unit (SCRUM-240)', () => {
    const knots = barbLegendEntries('knots');
    expect(knots.map((e) => e.knots)).toEqual([...BARB_LEGEND_KNOTS]);
    expect(knots.map((e) => e.caption)).toEqual(['calm', '5 kt', '10 kt', '15 kt', '20 kt', '50 kt']);

    const kmh = barbLegendEntries('kmh');
    expect(kmh.map((e) => e.caption)).toEqual([
      'calm',
      '9 km/h',
      '19 km/h',
      '28 km/h',
      '37 km/h',
      '93 km/h',
    ]);

    const ms = barbLegendEntries('ms');
    expect(ms.map((e) => e.caption)).toEqual(['calm', '3 m/s', '5 m/s', '8 m/s', '10 m/s', '26 m/s']);

    const mph = barbLegendEntries('mph');
    expect(mph[1].caption).toBe('6 mph');
    expect(mph[4].caption).toBe('23 mph');
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

  it('follows the darker ramp on the paper chart, where the barbs draw with it (SCRUM-216)', () => {
    const chart = temperatureBands('imperial', true);
    expect(chart.map((band) => band.color)).toEqual(
      CHART_TEMPERATURE_BANDS.map((band) => band.color),
    );
    // Captions are unchanged: the palette differs, the temperature bands do not.
    expect(chart[0].caption).toBe(temperatureBands('imperial')[0].caption);
  });
});
