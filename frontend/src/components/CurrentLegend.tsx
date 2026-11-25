import React from 'react';
import type { WindSpeedUnit } from '../types';
import { CURRENT_TIERS, CURRENT_TIER_OUTLINE, tierRangeLabel } from '../utils/currentTiers';
import { SPEED_UNIT_LABEL } from '../utils/units';

/**
 * Compact key for the ocean-current chevrons (SCRUM-100): one swatch per tier with its knot
 * range in the user's speed unit, from the same tier table the glyph uses.
 *
 * It sits at the map's top-left as a small card rather than a strip, because the wind colour
 * legend already owns the full width above the attribution and both layers can be on at once.
 */
export const CurrentLegend: React.FC<{ speedUnit: WindSpeedUnit }> = ({ speedUnit }) => {
  const label = SPEED_UNIT_LABEL[speedUnit];
  return (
    <div
      data-testid="current-legend"
      role="img"
      aria-label={`Water current speed scale in ${label}: light, moderate, strong and extreme`}
      className="absolute left-3 top-3 z-[750] pointer-events-none rounded-lg border border-dark-600/70 bg-dark-900/85 px-2.5 py-2 backdrop-blur-xs"
    >
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-300">
        Currents ({label})
      </div>
      <div className="flex items-center gap-2.5">
        {CURRENT_TIERS.map((tier) => (
          <span key={tier.id} data-testid={`current-legend-${tier.id}`} className="flex items-center gap-1 text-[9px] text-gray-300">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full border"
              style={{ backgroundColor: tier.color, borderColor: CURRENT_TIER_OUTLINE }}
            />
            {tierRangeLabel(tier, speedUnit)}
          </span>
        ))}
      </div>
    </div>
  );
};
