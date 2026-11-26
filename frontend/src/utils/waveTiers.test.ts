import { describe, expect, it } from 'vitest';
import {
  WAVE_ATTRIBUTION_TEXT,
  WAVE_TIERS,
  formatWaveHeight,
  waveRangeLabel,
  waveTier,
} from './waveTiers';

describe('waveTier (SCRUM-234)', () => {
  it('places heights in the ticket’s four tiers at their boundaries', () => {
    expect(waveTier(0).id).toBe('calm');
    expect(waveTier(0.9).id).toBe('calm');
    expect(waveTier(1).id).toBe('moderate');
    expect(waveTier(1.99).id).toBe('moderate');
    expect(waveTier(2).id).toBe('rough');
    expect(waveTier(3.9).id).toBe('rough');
    expect(waveTier(4).id).toBe('high');
    expect(waveTier(9).id).toBe('high');
  });

  it('draws rougher water larger (SCRUM-263 made every arrow bigger)', () => {
    expect(WAVE_TIERS.map((tier) => tier.size)).toEqual([28, 34, 40, 46]);
  });

  it('labels the ranges in feet or metres', () => {
    expect(WAVE_TIERS.map((tier) => waveRangeLabel(tier, 'metric'))).toEqual([
      '0–1 m',
      '1–2 m',
      '2–4 m',
      '4+ m',
    ]);
    expect(WAVE_TIERS.map((tier) => waveRangeLabel(tier, 'imperial'))).toEqual([
      '0–3 ft',
      '3–6 ft',
      '6–13 ft',
      '13+ ft',
    ]);
  });

  it('formats a height in the chosen unit', () => {
    expect(formatWaveHeight(1, 'imperial')).toBe('3.3 ft');
    expect(formatWaveHeight(1.6, 'imperial')).toBe('5.2 ft');
    expect(formatWaveHeight(1.6, 'metric')).toBe('1.6 m');
  });

  it('names the Marine source for pop-ups and export credits', () => {
    expect(WAVE_ATTRIBUTION_TEXT).toContain('Copernicus Marine');
  });
});
