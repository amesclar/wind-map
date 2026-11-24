import { describe, expect, it } from 'vitest';
import { CURRENT_TIERS, currentTier } from './currentTiers';

describe('currentTier (SCRUM-99)', () => {
  it('uses the documented thresholds', () => {
    expect(currentTier(0).id).toBe('light');
    expect(currentTier(0.49).id).toBe('light');
    expect(currentTier(0.5).id).toBe('moderate');
    expect(currentTier(1.49).id).toBe('moderate');
    expect(currentTier(1.5).id).toBe('strong');
    expect(currentTier(2.99).id).toBe('strong');
    expect(currentTier(3).id).toBe('extreme');
    expect(currentTier(6).id).toBe('extreme');
  });

  it('treats a missing or negative speed as light', () => {
    expect(currentTier(-1).id).toBe('light');
    expect(currentTier(Number.NaN).id).toBe('light');
  });

  it('keeps one chevron only for light water and marks the top two tiers bold', () => {
    expect(CURRENT_TIERS.map((tier) => [tier.id, tier.chevrons, tier.bold])).toEqual([
      ['light', 1, false],
      ['moderate', 2, false],
      ['strong', 2, true],
      ['extreme', 2, true],
    ]);
  });

  it('has one colour per tier', () => {
    expect(CURRENT_TIERS.map((tier) => tier.color)).toEqual(['#38bdf8', '#06b6d4', '#0284c7', '#f59e0b']);
  });
});
