import { describe, expect, it, vi } from 'vitest';
import { RangeCaptureError, captureRange, type RangeCaptureDeps } from './rangeCapture';

const HOURS = [
  '2026-11-24T22:00:00.000Z',
  '2026-11-24T23:00:00.000Z',
  '2026-11-25T00:00:00.000Z',
];

const labelHour = (iso: string) => `hour ${iso.slice(11, 16)}`;

function harness(overrides: Partial<RangeCaptureDeps> = {}) {
  const events: string[] = [];
  const frames: HTMLCanvasElement[] = [];
  const deps: RangeCaptureDeps = {
    setHour: vi.fn((iso: string) => events.push(`set ${iso}`)),
    waitForFrame: vi.fn(async (iso: string) => {
      events.push(`wait ${iso}`);
    }),
    capture: vi.fn(async (iso: string) => {
      events.push(`capture ${iso}`);
      const canvas = { id: iso } as HTMLCanvasElement;
      frames.push(canvas);
      return canvas;
    }),
    labelHour,
    onProgress: vi.fn(),
    ...overrides,
  };
  return { deps, events, frames };
}

describe('captureRange (SCRUM-155)', () => {
  it('captures exactly one frame per hour, in order, after that hour is shown and ready', async () => {
    const { deps, events } = harness();

    const result = await captureRange(HOURS, deps);

    expect(result.status).toBe('completed');
    expect(result.frames.map((f) => f.time)).toEqual(HOURS);
    expect(events).toEqual([
      `set ${HOURS[0]}`,
      `wait ${HOURS[0]}`,
      `capture ${HOURS[0]}`,
      `set ${HOURS[1]}`,
      `wait ${HOURS[1]}`,
      `capture ${HOURS[1]}`,
      `set ${HOURS[2]}`,
      `wait ${HOURS[2]}`,
      `capture ${HOURS[2]}`,
    ]);
    expect(deps.capture).toHaveBeenCalledTimes(HOURS.length);
  });

  it('reports progress for every captured frame', async () => {
    const onProgress = vi.fn();
    const { deps } = harness({ onProgress });

    await captureRange(HOURS, deps);

    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { done: 1, total: 3, time: HOURS[0] },
      { done: 2, total: 3, time: HOURS[1] },
      { done: 3, total: 3, time: HOURS[2] },
    ]);
  });

  it('does nothing for an empty range', async () => {
    const { deps } = harness();
    const result = await captureRange([], deps);
    expect(result).toEqual({ status: 'completed', frames: [] });
    expect(deps.setHour).not.toHaveBeenCalled();
  });

  it('stops before the first frame when it starts cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps } = harness({ signal: controller.signal });

    const result = await captureRange(HOURS, deps);

    expect(result).toEqual({ status: 'cancelled', frames: [] });
    expect(deps.setHour).not.toHaveBeenCalled();
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it('stops before the next hour when cancelled during a wait and saves nothing', async () => {
    const controller = new AbortController();
    const { deps } = harness({ signal: controller.signal });
    vi.mocked(deps.waitForFrame).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
      controller.abort();
    });

    const result = await captureRange(HOURS, deps);

    expect(result.status).toBe('cancelled');
    expect(result.frames).toHaveLength(1);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.setHour).toHaveBeenCalledTimes(2);
  });

  it('stops after the frame in progress when cancelled during a capture', async () => {
    const controller = new AbortController();
    const { deps } = harness({ signal: controller.signal });
    vi.mocked(deps.capture).mockImplementationOnce(async (iso: string) => {
      controller.abort();
      return { id: iso } as HTMLCanvasElement;
    });

    const result = await captureRange(HOURS, deps);

    expect(result.status).toBe('cancelled');
    expect(result.frames).toHaveLength(1);
    expect(deps.capture).toHaveBeenCalledTimes(1);
  });

  it('throws an error naming the failing hour and keeps the frames so far', async () => {
    const { deps, frames } = harness();
    vi.mocked(deps.waitForFrame).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
      throw new Error('grid data did not arrive');
    });

    const failure = captureRange(HOURS, deps);

    await expect(failure).rejects.toBeInstanceOf(RangeCaptureError);
    await expect(failure).rejects.toMatchObject({
      time: HOURS[1],
      message: 'Could not capture hour 23:00: grid data did not arrive',
      frames: [{ time: HOURS[0], canvas: frames[0] }],
    });
  });

  it('treats an abort during a failing wait as a cancel, not an error', async () => {
    const controller = new AbortController();
    const { deps } = harness({ signal: controller.signal });
    vi.mocked(deps.waitForFrame).mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(captureRange(HOURS, deps)).resolves.toEqual({
      status: 'cancelled',
      frames: [],
    });
  });

  it('passes the abort signal to the readiness wait', async () => {
    const controller = new AbortController();
    const { deps } = harness({ signal: controller.signal });

    await captureRange(HOURS.slice(0, 1), deps);

    expect(deps.waitForFrame).toHaveBeenCalledWith(HOURS[0], controller.signal);
  });
});
