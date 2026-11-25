/**
 * Recovery for a tab left open across a rebuild (SCRUM-241).
 *
 * Vite names every chunk after its contents, so a rebuild removes the chunk names an open tab
 * still asks for and its lazy imports fail with "Failed to fetch dynamically imported module"
 * (the PDF export, for one). Reload once to pick up the current build, and stay put when a reload
 * did not help, so a bad build cannot loop the page.
 */
export const PRELOAD_RELOAD_KEY = 'wind-map:preload-reload';
export const PRELOAD_RELOAD_INTERVAL_MS = 60_000;

export function reloadOnPreloadError(target: Window = window): void {
  target.addEventListener('vite:preloadError', () => {
    try {
      const last = Number(target.sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? 0);
      if (Date.now() - last < PRELOAD_RELOAD_INTERVAL_MS) return;
      target.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
    } catch {
      // Storage can be unavailable (private mode); a reload is still the right recovery.
    }
    target.location.reload();
  });
}
