import React, { useEffect, useState } from 'react';
import type { WindSpeedUnit } from '../types';
import { legendTicks, MAX_WIND_KNOTS, windColorCssGradient } from '../utils/windColorScale';
import { knotsToUnit, SPEED_UNIT_LABEL } from '../utils/units';

// The scale belongs to windColorScale so the export legend can share it; re-exported here for the
// component's existing imports and tests (SCRUM-165).
export { legendTicks } from '../utils/windColorScale';

/**
 * The strip's fixed offset above the bottom of the map, which keeps it clear of the attribution.
 * The offset itself lives in index.css (`.wind-color-legend`), so the constant stays documented
 * here. The forecast drawer that used to push the strip up is gone (SCRUM-126).
 */
export const LEGEND_BOTTOM_PX = 24;
export const LEGEND_HEIGHT_PX = 24;
/**
 * Above Leaflet's content panes (gradient 250, markers 600, pop-ups 700) so the strip is not
 * hidden, but below its controls (800) so the zoom buttons still win (SCRUM-168).
 */
export const LEGEND_Z_INDEX = 750;
/** Below this width only every second tick is labelled. */
export const NARROW_LEGEND_PX = 640;

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
 * Full-width strip under the map: the same gradient as the overlay with tick labels in the
 * user's speed unit (SCRUM-124). It never takes pointer events, and on narrow screens it drops
 * every second label so they stop colliding. Its vertical offset is `.wind-color-legend` in
 * index.css, a fixed 24px above the map attribution (SCRUM-126).
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
      className="wind-color-legend absolute inset-x-0 pointer-events-none flex items-center gap-2 px-2 bg-dark-900/75 backdrop-blur-xs border-y border-dark-600/70"
      style={{ height: LEGEND_HEIGHT_PX, zIndex: LEGEND_Z_INDEX }}
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
