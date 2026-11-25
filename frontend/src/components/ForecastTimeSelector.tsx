import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { ModelAvailability, WeatherModelInfo } from '../types';
import {
  PLAY_STEP_HOURS,
  buildSteps,
  dayMarks,
  floorToHour,
  formatHorizon,
  formatRunTime,
  formatStepLabel,
  indexFromFraction,
  stepIndex,
} from '../utils/forecastWindow';

interface ForecastTimeSelectorProps {
  /** Cadence, horizon and run times from /api/weather/models (SCRUM-115). */
  model: WeatherModelInfo | null;
  /** Publication times from /api/weather/models/{model}/availability (SCRUM-256), when known. */
  availability?: ModelAvailability | null;
  /** Selected hour, ISO 8601; null means now. */
  forecastTime: string | null;
  onChange: (iso: string | null) => void;
  /** The user's display timezone, used for every label. */
  timezone: string;
  /** True while the map data for the current step is still loading; play waits for it. */
  loading?: boolean;
  /** Fixed clock for tests; defaults to the real time. */
  now?: Date;
  playIntervalMs?: number;
}

/** Used until /api/weather/models answers; the backend horizon replaces it. */
const FALLBACK_HORIZON_HOURS = 48;
const TRACK_EDGE_PADDING_PCT = 0; // handle centres may sit on the ends

const BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dark-600 text-gray-300 ' +
  'hover:bg-dark-700 hover:text-gray-100 disabled:opacity-40 disabled:hover:bg-transparent transition';

export const ForecastTimeSelector: React.FC<ForecastTimeSelectorProps> = ({
  model,
  availability = null,
  forecastTime,
  onChange,
  timezone,
  loading = false,
  now,
  playIntervalMs = 1000,
}) => {
  const startIso = useMemo(() => floorToHour(now ?? new Date()).toISOString(), [now]);
  const steps = useMemo(
    () => buildSteps(startIso, model?.horizon_hours ?? FALLBACK_HORIZON_HOURS),
    [startIso, model?.horizon_hours],
  );
  const selected = stepIndex(steps, forecastTime);
  const [preview, setPreview] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const index = Math.min(steps.length - 1, Math.max(0, preview ?? selected));
  const label = formatStepLabel(steps[index] ?? startIso, timezone);
  const marks = useMemo(
    () => dayMarks(startIso, model?.horizon_hours ?? FALLBACK_HORIZON_HOURS, timezone),
    [startIso, model?.horizon_hours, timezone],
  );
  const percent = (fraction: number) => `calc(${TRACK_EDGE_PADDING_PCT}% + ${fraction * (100 - 2 * TRACK_EDGE_PADDING_PCT)}%)`;

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(steps.length - 1, Math.max(0, next));
      onChange(clamped === 0 ? null : steps[clamped]);
    },
    [steps, onChange],
  );

  // Play one step per tick, but only once the current step's data has arrived, and stop at the end.
  useEffect(() => {
    if (!playing || loading) return;
    const timer = setTimeout(() => {
      if (selected >= steps.length - 1) {
        setPlaying(false);
        return;
      }
      commit(selected + PLAY_STEP_HOURS);
    }, playIntervalMs);
    return () => clearTimeout(timer);
  }, [playing, loading, selected, steps.length, playIntervalMs, commit]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      commit(selected - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      commit(selected + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      commit(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      commit(steps.length - 1);
    } else if (event.key === ' ') {
      event.preventDefault();
      setPlaying((value) => !value);
    }
  };

  const fractionFromEvent = (event: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return (event.clientX - rect.left) / rect.width;
  };

  // Run times are shown only when the API supplied them, so a partial model never crashes the bar.
  const runTime = (iso: string | undefined) =>
    iso && !Number.isNaN(Date.parse(iso)) ? formatRunTime(iso, timezone) : null;
  const lastRun = runTime(model?.last_run_utc);
  const nextRun = runTime(model?.next_run_utc);
  // A published run (SCRUM-256) is what the user is actually looking at; the derived cycle is the
  // fallback for composites with no single run, and the wording differs so the two never blur.
  const updated = runTime(availability?.available_utc ?? undefined);
  const nextUpdated = runTime(availability?.next_available_utc ?? undefined);
  const runLine = updated
    ? ` · updated ${updated}` + (nextUpdated ? ` (next ~${nextUpdated})` : '')
    : (lastRun ? ` · run ${lastRun}` : '') + (nextRun ? ` (next ${nextRun})` : '');
  const modelLine = model
    ? `${model.name} · every ${model.update_hours} h · ${formatHorizon(model.horizon_hours)}` + runLine
    : 'Loading the forecast window…';

  return (
    <div
      data-testid="forecast-time-selector"
      className="shrink-0 border-t border-dark-600 bg-dark-900/95 px-3 py-2"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause forecast' : 'Play forecast'}
          aria-pressed={playing}
          onClick={() => setPlaying((value) => !value)}
          className={`${BUTTON} bg-dark-800`}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onChange(null);
          }}
          disabled={forecastTime === null}
          className="shrink-0 rounded-lg border border-dark-600 px-2 py-1 text-[10px] font-semibold text-gray-300 hover:bg-dark-700 hover:text-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Now
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span data-testid="forecast-time-label" className="truncate text-xs font-semibold text-gray-100">
              {label}
            </span>
            <span data-testid="forecast-model-info" className="truncate text-[10px] text-gray-400">
              {modelLine}
            </span>
          </div>

          <div
            ref={trackRef}
            className="relative mt-2 h-5 touch-none select-none"
            onPointerDown={(event) => {
              setPlaying(false);
              setPreview(indexFromFraction(fractionFromEvent(event), steps.length));
            }}
            onPointerMove={(event) => {
              if (preview !== null) setPreview(indexFromFraction(fractionFromEvent(event), steps.length));
            }}
            onPointerUp={(event) => {
              const next = indexFromFraction(fractionFromEvent(event), steps.length);
              setPreview(null);
              commit(next);
            }}
            onPointerCancel={() => setPreview(null)}
          >
            <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-dark-600" />
            <div
              className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-sky-400"
              style={{ left: percent(0), width: `calc(${(index / Math.max(1, steps.length - 1)) * 100}% )` }}
            />
            {marks.map((mark) => (
              <span
                key={mark.key}
                aria-hidden="true"
                className="absolute top-full -translate-x-1/2 text-[9px] font-semibold text-gray-500"
                style={{ left: percent(mark.fraction) }}
              >
                {mark.label}
              </span>
            ))}
            {preview === null && (
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-500"
                style={{ left: percent(0) }}
              />
            )}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Forecast time"
              aria-valuemin={0}
              aria-valuemax={steps.length - 1}
              aria-valuenow={index}
              aria-valuetext={label}
              aria-disabled={false}
              onKeyDown={onKeyDown}
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-sky-400 bg-dark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              style={{ left: percent(index / Math.max(1, steps.length - 1)) }}
            />
          </div>
        </div>

        <button
          type="button"
          aria-label="Previous hour"
          onClick={() => commit(selected - 1)}
          disabled={selected === 0}
          className={BUTTON}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next hour"
          onClick={() => commit(selected + 1)}
          disabled={selected === steps.length - 1}
          className={BUTTON}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
