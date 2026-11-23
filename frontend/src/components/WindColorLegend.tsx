import React, { useEffect, useState } from 'react';
import type { WindSpeedUnit } from '../types';
import { MAX_WIND_KNOTS, windColorCssGradient } from '../utils/windColorScale';
import { knotsToUnit, SPEED_UNIT_LABEL } from '../utils/units';

/**
 * Gap above the timeline drawer and the floor used when no drawer is showing, so the strip
 * still clears the attribution. The offsets live in index.css (`.wind-color-legend`, which
 * reads `--drawer-height` published by the drawer), so the constants stay documented here.
 */
export const LEGEND_GAP_PX = 6;
export const LEGEND_MIN_BOTTOM_PX = 24;
export const LEGEND_HEIGHT_PX = 24;
/** Below this width only every second tick is labelled. */
export const NARROW_LEGEND_PX = 640;

/** Smallest round step per unit that keeps the labels short. */
const TICK_STEPS: Record<WindSpeedUnit, number> = { knots: 5, kmh: 10, mph: 5, ms: 5 };

/** Whole-number ticks from 0 to the top of the scale, in the chosen unit (SCRUM-124). */
export function legendTicks(unit: WindSpeedUnit): number[] {
  const step = TICK_STEPS[unit];
  const max = knotsToUnit(MAX_WIND_KNOTS, unit);
  const ticks: number[] = [];
  for (let value = 0; value <= max + 0.001; value += step) ticks.push(Math.round(value));
  return ticks;
}

function useNarrowLegend(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_LEGEND_PX,
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_LEGEND_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

/**
 * Full-width strip under the map, above the drawer: the same gradient as the overlay with
 * tick labels in the user's speed unit (SCRUM-124). It never takes pointer events, and on
 * narrow screens it drops every second label so they stop colliding. Its vertical offset is
 * `.wind-color-legend` in index.css, which rides on the drawer's published height so an
 * expanded forecast panel cannot cover it (SCRUM-144).
 */
export const WindColorLegend: React.FC<{ speedUnit: WindSpeedUnit }> = ({ speedUnit }) => {
  const narrow = useNarrowLegend();
  const ticks = legendTicks(speedUnit);
  const max = knotsToUnit(MAX_WIND_KNOTS, speedUnit);
  const label = SPEED_UNIT_LABEL[speedUnit];

  return (
    <div
      data-testid="wind-color-legend"
      role="img"
      aria-label={`Wind speed color scale from 0 to ${Math.round(max)} ${label}`}
      className="wind-color-legend absolute inset-x-0 z-30 pointer-events-none flex items-center gap-2 px-2 bg-dark-900/75 backdrop-blur-xs border-y border-dark-600/70"
      style={{ height: LEGEND_HEIGHT_PX }}
    >
      <div
        className="relative flex-1 h-2.5 rounded-xs border border-black/50"
        style={{ background: windColorCssGradient() }}
      >
        {ticks.map((value, index) => {
          const isLast = index === ticks.length - 1;
          if (narrow && index % 2 === 1 && !isLast) return null;
          return (
            <span
              key={value}
              data-testid="wind-color-legend-tick"
              className="absolute top-1/2 text-[9px] font-semibold leading-none text-white"
              style={{
                left: `${(value / max) * 100}%`,
                transform: `translateY(-50%) ${
                  index === 0 ? '' : isLast ? 'translateX(-100%)' : 'translateX(-50%)'
                }`,
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.9)',
              }}
            >
              {value}
            </span>
          );
        })}
      </div>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-300">{label}</span>
    </div>
  );
};
