import React from 'react';
import type { UnitSystem, WindSpeedUnit } from '../types';
import { SPEED_UNIT_LABEL } from '../utils/units';
import { CURRENT_TIERS, tierRangeLabel } from '../utils/currentTiers';
import { WAVE_TIERS, waveRangeLabel } from '../utils/waveTiers';
import { generateWindBarbSvg } from './WindBarb';
import { generateCurrentChevronSvg } from './WaterCurrentChevron';
import { generateWaveKeySvg } from './WaveArrow';

/**
 * Examples drawn in the key: a half barb (5 kt), a full plus a half (15 kt) and three fulls plus a
 * half (35 kt), so the additive shapes an ordinary wind builds can be read without a pop-up
 * (SCRUM-263). A pennant needs 50 kt, which is gale strength and rarer on the map.
 */
export const MAP_KEY_WIND_KNOTS = [5, 15, 35] as const;

/**
 * One neutral grey for every wind example (SCRUM-263). On the map a barb's colour is the
 * temperature, not the speed, so a temperature-coloured swatch would teach the wrong thing; the
 * note under the row says where the colour comes from instead.
 */
export const MAP_KEY_WIND_COLOR = '#cbd5e1';

/** Every key glyph shares one size, whatever size the map draws that tier (SCRUM-263). */
export const MAP_KEY_GLYPH_PX = 20;

/**
 * Wind barbs draw larger than the other key glyphs (SCRUM-304). At the shared 20 px a staff was
 * about 1 px wide and the barb's ink 7.6 px tall against the chevron's 10 px, so the barbs read as
 * the smallest thing in the key; at 28 px the ink matches the chevrons' height.
 */
export const MAP_KEY_WIND_GLYPH_PX = 28;

/**
 * What each glyph's orientation means (SCRUM-294). One parallel line per layer, in the key and in
 * its `aria-label`: shape and colour say how much, but never which way the glyph points.
 */
export const MAP_KEY_ORIENTATION = {
  wind: 'staff points where the wind comes from',
  currents: 'chevron points where the water flows',
  waves: 'heads point where the waves travel',
} as const;

function windKeySvg(speedKnots: number): string {
  return generateWindBarbSvg({
    speedKnots,
    directionDeg: 0,
    tempF: 50,
    size: MAP_KEY_WIND_GLYPH_PX,
    showLabel: false,
    colorOverride: MAP_KEY_WIND_COLOR,
  });
}

/**
 * The map key (SCRUM-263): one card at the map's top-left that replaces the separate currents and
 * waves keys.
 *
 * Wind is always there, because barbs are the base layer, and it is drawn the way the barbs are
 * drawn rather than as colour swatches: the glyph shows the speed in its feathers, and the colour
 * on the map is the temperature. The currents row (chevrons) and the waves row (arrows) appear
 * only while their layer is on, each with the tier ranges in the user's units, so the card never
 * lists a layer the map is not showing.
 */
export const MapLegend: React.FC<{
  speedUnit: WindSpeedUnit;
  unitSystem: UnitSystem;
  /** Draws the currents row; the chevrons are on the map when this is true. */
  currents?: boolean;
  /** Draws the waves row; the arrows are on the map when this is true. */
  waves?: boolean;
}> = ({ speedUnit, unitSystem, currents = false, waves = false }) => {
  const speedLabel = SPEED_UNIT_LABEL[speedUnit];
  const waveUnit = unitSystem === 'imperial' ? 'ft' : 'm';
  const parts = [`Map key: wind barbs in knots, ${MAP_KEY_ORIENTATION.wind}, coloured by temperature`];
  if (currents) parts.push(`currents in ${speedLabel}, ${MAP_KEY_ORIENTATION.currents}`);
  if (waves) parts.push(`wave heights in ${waveUnit}, ${MAP_KEY_ORIENTATION.waves}`);

  return (
    <div
      data-testid="map-legend"
      role="img"
      aria-label={parts.join('; ')}
      className="absolute left-3 top-3 z-[750] pointer-events-none max-w-[300px] rounded-lg border border-dark-600/70 bg-dark-900/85 px-2.5 py-2 backdrop-blur-xs"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">Map key</div>

      <div data-testid="map-legend-wind" className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] leading-none text-gray-300">Wind (kt)</span>
        {MAP_KEY_WIND_KNOTS.map((knots) => (
          <span
            key={knots}
            data-testid={`map-legend-wind-${knots}`}
            className="inline-flex items-center gap-1 text-[10px] leading-none text-gray-300"
          >
            <span
              aria-hidden="true"
              className="inline-flex shrink-0"
              dangerouslySetInnerHTML={{ __html: windKeySvg(knots) }}
            />
            <span>{knots}</span>
          </span>
        ))}
      </div>
      <div data-testid="map-legend-wind-note" className="mt-1 text-[10px] leading-tight text-gray-400">
        <div data-testid="map-legend-wind-direction">{MAP_KEY_ORIENTATION.wind}</div>
        <div>colour = temperature</div>
      </div>

      {currents && (
        <div data-testid="map-legend-currents" className="mt-1.5 border-t border-dark-600/60 pt-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
            Currents ({speedLabel})
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {CURRENT_TIERS.map((tier) => (
              <span
                key={tier.id}
                data-testid={`map-legend-current-${tier.id}`}
                className="flex items-center gap-1 text-[10px] leading-none text-gray-300"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex shrink-0"
                  dangerouslySetInnerHTML={{
                    __html: generateCurrentChevronSvg(tier.minKnots, 0, MAP_KEY_GLYPH_PX),
                  }}
                />
                {tierRangeLabel(tier, speedUnit)}
              </span>
            ))}
          </div>
          <div
            data-testid="map-legend-currents-note"
            className="mt-1 text-[10px] leading-tight text-gray-400"
          >
            {MAP_KEY_ORIENTATION.currents}
          </div>
        </div>
      )}

      {waves && (
        <div data-testid="map-legend-waves" className="mt-1.5 border-t border-dark-600/60 pt-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
            Waves ({waveUnit})
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {WAVE_TIERS.map((tier) => (
              <span
                key={tier.id}
                data-testid={`map-legend-wave-${tier.id}`}
                className="flex items-center gap-1 text-[10px] leading-none text-gray-300"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex shrink-0"
                  // Cropped to its own ink with the heads up, so the value sits against the symbol.
                  dangerouslySetInnerHTML={{
                    __html: generateWaveKeySvg(tier.minMetres, MAP_KEY_GLYPH_PX),
                  }}
                />
                {waveRangeLabel(tier, unitSystem)}
              </span>
            ))}
          </div>
          <div
            data-testid="map-legend-waves-note"
            className="mt-1 text-[10px] leading-tight text-gray-400"
          >
            {MAP_KEY_ORIENTATION.waves}
          </div>
        </div>
      )}
    </div>
  );
};
