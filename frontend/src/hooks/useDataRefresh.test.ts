import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_CLOCK_TICK_MS, useDataRefresh } from './useDataRefresh';

const RUN = '2026-11-25T18:17:00Z';
const runAt = Date.parse(RUN);

function renderGate(overrides: Partial<Parameters<typeof useDataRefresh>[0]> = {}) {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const options = {
    dataAsOf: runAt + 60_000,
    runUtc: RUN,
    onRefresh,
    ...overrides,
  };
  const view = renderHook((props: typeof options) => useDataRefresh(props), { initialProps: options });
  return { ...view, onRefresh };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDataRefresh (SCRUM-113)', () => {
  it('stays disabled while the data on screen covers the newest run', () => {
    const { result } = renderGate();

    expect(result.current.canRefresh).toBe(false);
  });

  it('enables when the source published a run newer than the data', () => {
    const { result } = renderGate({ dataAsOf: runAt - 60_000 });

    expect(result.current.canRefresh).toBe(true);
  });

  it('wakes up on its own clock tick once a run lands', async () => {
    const { result, rerender } = renderGate();
    expect(result.current.canRefresh).toBe(false);

    // The same data, but the model has published a newer run meanwhile.
    rerender({ dataAsOf: runAt + 60_000, runUtc: '2026-11-26T00:17:00Z', onRefresh: vi.fn() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_CLOCK_TICK_MS);
    });

    expect(result.current.canRefresh).toBe(true);
  });

  it('stays disabled with no data or no known run', () => {
    expect(renderGate({ dataAsOf: null }).result.current.canRefresh).toBe(false);
    expect(renderGate({ dataAsOf: runAt - 60_000, runUtc: null }).result.current.canRefresh).toBe(false);
    expect(renderGate({ dataAsOf: runAt - 60_000, runUtc: 'not a date' }).result.current.canRefresh).toBe(false);
  });

  it('runs one refresh at a time and reports busy until it settles', async () => {
    let settle: () => void = () => {};
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderGate({ dataAsOf: runAt - 60_000, onRefresh });

    act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(true);
    expect(result.current.canRefresh).toBe(false);

    act(() => result.current.refresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
      await Promise.resolve();
    });
    expect(result.current.refreshing).toBe(false);
    expect(result.current.canRefresh).toBe(true);
  });

  it('keeps the old data and re-enables after a failure', async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error('upstream down'));
    const { result } = renderGate({ dataAsOf: runAt - 60_000, onRefresh });

    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });

    expect(result.current.error).toBe('Refresh failed; showing the data already on screen.');
    expect(result.current.refreshing).toBe(false);
    expect(result.current.canRefresh).toBe(true);
  });
});
