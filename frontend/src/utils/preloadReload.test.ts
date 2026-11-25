import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRELOAD_RELOAD_INTERVAL_MS,
  PRELOAD_RELOAD_KEY,
  reloadOnPreloadError,
} from './preloadReload';

function stubWindow(stored?: string) {
  const listeners = new Map<string, EventListener>();
  const store = new Map<string, string>();
  if (stored !== undefined) store.set(PRELOAD_RELOAD_KEY, stored);
  const reload = vi.fn();
  const target = {
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    sessionStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    },
    location: { reload },
  } as unknown as Window;
  return {
    target,
    reload,
    store,
    fire: () => listeners.get('vite:preloadError')!(new Event('vite:preloadError')),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('reloadOnPreloadError (SCRUM-241)', () => {
  it('reloads once and records when it did', () => {
    const { target, reload, store, fire } = stubWindow();

    reloadOnPreloadError(target);
    fire();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(store.get(PRELOAD_RELOAD_KEY))).toBeGreaterThan(0);
  });

  it('stays put when a reload happened a moment ago, so a bad build cannot loop', () => {
    const { target, reload, fire } = stubWindow(String(Date.now() - PRELOAD_RELOAD_INTERVAL_MS / 2));

    reloadOnPreloadError(target);
    fire();

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the last reload is old enough', () => {
    const { target, reload, fire } = stubWindow(String(Date.now() - PRELOAD_RELOAD_INTERVAL_MS - 1));

    reloadOnPreloadError(target);
    fire();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when session storage is unavailable', () => {
    const { target, reload, fire } = stubWindow();
    Object.defineProperty(target, 'sessionStorage', {
      get: () => {
        throw new Error('blocked');
      },
    });

    reloadOnPreloadError(target);
    fire();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
