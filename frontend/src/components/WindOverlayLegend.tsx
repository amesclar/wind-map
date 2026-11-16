import React from 'react';
import { getChevronColor, generateWindChevronSvg } from './WindChevron';

// Each row: label shown to user, representative speed (used to generate the
// SVG so the chevron count and color match exactly what appears on the map),
// and a human-readable speed range.
const TIERS = [
  { label: 'Calm',     speed: 0,  range: '< 2 kt'   },
  { label: 'Light',    speed: 5,  range: '2–9 kt'   },
  { label: 'Moderate', speed: 15, range: '10–19 kt' },
  { label: 'Fresh',    speed: 25, range: '20–33 kt' },
  { label: 'Strong',   speed: 40, range: '≥ 34 kt'  },
] as const;

interface WindOverlayLegendProps {
  visible: boolean;
}

export const WindOverlayLegend: React.FC<WindOverlayLegendProps> = ({ visible }) => {
  if (!visible) return null;

  return (
    <div
      data-testid="wind-overlay-legend"
      className="absolute top-4 left-3 z-[500] bg-dark-900/90 border border-dark-600 rounded-lg px-3 py-2 backdrop-blur-sm shadow-lg"
      style={{ pointerEvents: 'none' }}
    >
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
        Wind Speed
      </div>
      <div className="space-y-1">
        {TIERS.map(({ label, speed, range }) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className="flex-shrink-0"
              dangerouslySetInnerHTML={{ __html: generateWindChevronSvg(speed, 0, 20) }}
            />
            <span className="text-[11px] text-gray-300 w-16">{label}</span>
            <span className="text-[10px] text-gray-500">{range}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
