import React from 'react';
import type { UnitSystem } from '../types';
import { WAVE_TIERS, WAVE_TIER_OUTLINE, waveRangeLabel } from '../utils/waveTiers';

/**
 * Compact key for the wave arrows (SCRUM-234): one swatch per height tier with its range in feet
 * or metres, from the same tier table the glyphs use.
 *
 * It shares the map's top-left with the currents key and sits below it while that layer is on,
 * because both can be shown together; the wind colour legend owns the full width at the bottom.
 */
export const WaveLegend: React.FC<{ unitSystem: UnitSystem; stacked?: boolean }> = ({
  unitSystem,
  stacked = false,
}) => {
  const unit = unitSystem === 'imperial' ? 'ft' : 'm';
  return (
    <div
      data-testid="wave-legend"
      role="img"
      aria-label={`Wave height scale in ${unit}: 0–1, 1–2, 2–4 and over 4`}
      className={`absolute left-3 ${stacked ? 'top-[4.75rem]' : 'top-3'} z-[750] pointer-events-none rounded-lg border border-dark-600/70 bg-dark-900/85 px-2.5 py-2 backdrop-blur-xs`}
    >
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-300">
        Waves ({unit})
      </div>
      <div className="flex items-center gap-2.5">
        {WAVE_TIERS.map((tier) => (
          <span key={tier.id} data-testid={`wave-legend-${tier.id}`} className="flex items-center gap-1 text-[9px] text-gray-300">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 border"
              style={{ backgroundColor: tier.color, borderColor: WAVE_TIER_OUTLINE }}
            />
            {waveRangeLabel(tier, unitSystem)}
          </span>
        ))}
      </div>
    </div>
  );
};
