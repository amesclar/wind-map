/**
 * The per-hour render loop for a range export (SCRUM-155).
 *
 * Every side effect is injected (`setHour`, `waitForFrame`, `capture`), so the loop can be tested
 * without Leaflet, timers or a canvas. `App` supplies the real implementations: it moves the
 * on-screen map, waits for that hour's grid and tiles, and captures the composed canvas.
 */

export interface RangeFrame {
  /** The hour the frame shows, ISO 8601. */
  time: string;
  canvas: HTMLCanvasElement;
}

export interface RangeProgress {
  /** Frames captured so far, including the one just finished. */
  done: number;
  total: number;
  /** The hour the next capture will show (or the one just captured on completion). */
  time: string;
}

/** A failure that names the hour and keeps the frames captured before it. */
export class RangeCaptureError extends Error {
  constructor(
    message: string,
    readonly time: string,
    readonly frames: RangeFrame[],
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RangeCaptureError';
  }
}

export interface RangeCaptureDeps {
  /** Show `iso` on the map. */
  setHour: (iso: string) => void;
  /** Resolve once that hour's grid data and tiles are ready; rejects on the deadline. */
  waitForFrame: (iso: string, signal: AbortSignal) => Promise<void>;
  /** Capture the composed image for the hour currently set. */
  capture: (iso: string) => Promise<HTMLCanvasElement>;
  /** "Thu 14:00 PST", for the progress line and the error message. */
  labelHour: (iso: string) => string;
  /** Aborting stops after the frame in progress. */
  signal?: AbortSignal;
  /**
   * Minimum gap between two frames (SCRUM-332), from `RANGE_PACE_MS` in the real caller. The wait
   * is skipped after the last frame and when a cancel lands during it.
   */
  paceMs?: number;
  onProgress?: (progress: RangeProgress) => void;
}

export interface RangeCaptureResult {
  status: 'completed' | 'cancelled';
  frames: RangeFrame[];
}

const aborted = (signal?: AbortSignal) => Boolean(signal?.aborted);

/**
 * Capture one frame per hour, in order. Cancelling returns `cancelled` with the frames captured
 * so far (the caller downloads nothing then); a failure throws `RangeCaptureError`.
 */
export async function captureRange(
  hours: string[],
  deps: RangeCaptureDeps,
): Promise<RangeCaptureResult> {
  const frames: RangeFrame[] = [];
  const total = hours.length;
  for (let index = 0; index < hours.length; index++) {
    const hour = hours[index];
    if (aborted(deps.signal)) return { status: 'cancelled', frames };

    deps.setHour(hour);
    try {
      await deps.waitForFrame(hour, deps.signal ?? new AbortController().signal);
      if (aborted(deps.signal)) return { status: 'cancelled', frames };
      const canvas = await deps.capture(hour);
      frames.push({ time: hour, canvas });
      deps.onProgress?.({ done: index + 1, total, time: hour });
      // Pace the loop rather than bursting the provider with every frame's tiles at once.
      const pace = deps.paceMs ?? 0;
      if (pace > 0 && index < hours.length - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, pace));
        if (aborted(deps.signal)) return { status: 'cancelled', frames };
      }
    } catch (err) {
      if (aborted(deps.signal)) return { status: 'cancelled', frames };
      const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
      throw new RangeCaptureError(
        `Could not capture ${deps.labelHour(hour)}${detail}`,
        hour,
        frames,
        err,
      );
    }
  }
  return { status: 'completed', frames };
}
