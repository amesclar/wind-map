import { describe, expect, it } from 'vitest';
import { cadenceFromFrequency, horizonHoursFromText, parseModelGuide } from './modelGuide';
import guideMarkdown from '../assets/weather-models.md?raw';

describe('cadenceFromFrequency', () => {
  it.each([
    ['Every 1 hour', '1h'],
    ['Every 3 hours', '3h'],
    ['Every 6 hours', '6h'],
    ['every 6 hr', '6h'],
  ])('maps %s to %s', (frequency, expected) => {
    expect(cadenceFromFrequency(frequency)).toBe(expected);
  });

  it('returns null for a cadence the guide does not badge', () => {
    expect(cadenceFromFrequency('Every 2 hours')).toBeNull();
  });

  it('returns null when no cadence is stated', () => {
    expect(cadenceFromFrequency('Twice daily')).toBeNull();
  });
});

describe('horizonHoursFromText (SCRUM-115)', () => {
  it.each([
    ['7.5 days', 180],
    ['16 days', 384],
    ['18 h (48 h on 00/06/12/18 UTC)', 18],
    ['2.5-day horizon', 60],
    ['—', null],
    ['', null],
  ])('turns %s into %s hours', (text, expected) => {
    expect(horizonHoursFromText(text)).toBe(expected);
  });
});

describe('parseModelGuide', () => {
  const guide = parseModelGuide(guideMarkdown);

  it('reads the title and header cells from the bundled guide', () => {
    expect(guide.title).toBe('Weather prediction models update frequency comparison');
    expect(guide.headers).toEqual([
      'Model / Family',
      'Region',
      'Update Frequency',
      'Cycle Times (UTC) / Notes',
      'Time Horizon',
    ]);
  });

  it('parses all 13 model families with their 4/3/6 cadences', () => {
    expect(guide.rows).toHaveLength(13);
    const cadences = guide.rows.map((row) => row.cadence);
    expect(cadences.filter((c) => c === '1h')).toHaveLength(4);
    expect(cadences.filter((c) => c === '3h')).toHaveLength(3);
    expect(cadences.filter((c) => c === '6h')).toHaveLength(6);
    expect(cadences).not.toContain(null);
  });

  it('reads the time horizon of the selectable families (SCRUM-115)', () => {
    const hours = (model: string) => guide.rows.find((row) => row.model === model)?.horizonHours;
    expect(hours('NOAA GFS')).toBe(384);
    expect(hours('ECMWF IFS (HRES 9 km)')).toBe(360);
    expect(hours('DWD ICON Global')).toBe(180);
    expect(hours('NOAA HRRR')).toBe(18);
    // Rows whose horizon the table does not state stay empty.
    const marine = guide.rows.find((row) => row.model === 'Open-Meteo Marine (Waves)');
    expect(marine?.horizon).toBe('—');
    expect(marine?.horizonHours).toBeNull();
  });

  it('keeps the row text of the corrected document', () => {
    const cmc = guide.rows.find((row) => row.model === 'CMC GEM');
    expect(cmc?.notes).toBe('00, 06, 12, 18 UTC (Regional 2.5 km & Global).');

    const ifs = guide.rows.find((row) => row.model === 'ECMWF IFS (HRES 9 km)');
    expect(ifs?.notes).toContain('~2 hr dissemination lag');
    expect(ifs?.notes).not.toContain('\\~');
  });

  it('pads short rows instead of dropping them', () => {
    const parsed = parseModelGuide(
      ['# Guide', '', '| Model | Region | Update Frequency | Notes |', '|---|---|---|---|', '| Only Model |'].join(
        '\n',
      ),
    );
    expect(parsed.rows).toEqual([
      { model: 'Only Model', region: '', frequency: '', cadence: null, notes: '', horizon: '', horizonHours: null },
    ]);
  });

  it('returns no table for markdown without one', () => {
    const parsed = parseModelGuide('# Just a title\n\nSome prose.');
    expect(parsed).toEqual({ title: 'Just a title', headers: [], rows: [] });
    expect(parseModelGuide('').title).toBe('');
  });
});
