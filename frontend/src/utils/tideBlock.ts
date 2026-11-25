/**
 * Tide block for the map pop-ups (SCRUM-195).
 *
 * A pop-up builder only writes an empty slot carrying the point; the block is filled once the
 * pop-up opens, so a click that never happens costs no request. The selected hour is the app's
 * current hour, not a captured one, so the block always describes the same hour as the rest of
 * the pop-up.
 *
 * Heights are metres above global mean sea level in the API and are shown in feet for the
 * imperial display. That datum is not a chart datum and Open-Meteo calls the series unsuitable
 * for navigation, so the block says both.
 */

import { fetchPointTide } from '../api/client';
import type { TideExtreme, TidePointResponse, UnitSystem } from '../types';
import { escapeHtml } from './html';

/** One request per rounded point and hour; pop-up opens close together share it. */
const cache = new Map<string, Promise<TidePointResponse>>();
const CACHE_LIMIT = 100;

export function tideCacheKey(latitude: number, longitude: number, hour: string | null): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)},${hour ?? 'current'}`;
}

/** Load one point's tide, reusing an in-flight or finished request for the same key. */
export function loadPointTide(
  latitude: number,
  longitude: number,
  hour: string | null,
): Promise<TidePointResponse> {
  const key = tideCacheKey(latitude, longitude, hour);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = fetchPointTide(latitude, longitude, hour).catch((err: unknown) => {
    // A failed load must not be remembered: the next open should try again.
    cache.delete(key);
    throw err;
  });
  cache.set(key, pending);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

/** Metres above MSL as the pop-up shows it. */
export function formatTideHeight(heightM: number, unitSystem: UnitSystem): string {
  return unitSystem === 'imperial'
    ? `${(heightM * 3.28084).toFixed(1)} ft`
    : `${heightM.toFixed(1)} m`;
}

/** `2026-11-25T15:38` (UTC) as the browser's local HH:mm. */
export function formatTideTime(stamp: string): string {
  const moment = new Date(stamp.endsWith('Z') ? stamp : `${stamp}Z`);
  return moment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function extremeRow(
  extreme: TideExtreme | null,
  when: 'last' | 'next',
  unitSystem: UnitSystem,
): string {
  if (!extreme) return '';
  // Shape, not an arrow emoji: a triangle in the one accent colour, hidden from screen readers
  // because `last low` / `next high` already carries the meaning.
  const marker = extreme.type === 'high' ? '▲' : '▼';
  return [
    `<span aria-hidden="true" style="color: #cbd5e1;">${marker}</span>`,
    `<span>${formatTideHeight(extreme.height_m, unitSystem)}</span>`,
    `<span>${when} ${extreme.type}</span>`,
    `<span style="text-align: right;">${formatTideTime(extreme.time)}</span>`,
  ].join('');
}

/**
 * The tide block's HTML, or '' when the point has no water (inland, or outside the model).
 * `isNow` labels the first row `now`; otherwise `selectedLabel` names the selected hour.
 */
export function buildTideBlockHtml(
  tide: TidePointResponse,
  unitSystem: UnitSystem,
  isNow: boolean,
  selectedLabel: string | null,
): string {
  if (!tide.points.length) return '';
  const current = tide.points.find((sample) => sample.time === tide.hour);
  const state = isNow ? 'now' : (selectedLabel ?? '');
  const rows = [
    [
      '<span aria-hidden="true"></span>',
      `<span>${current ? formatTideHeight(current.height_m, unitSystem) : '--'}</span>`,
      `<span>${escapeHtml(state)}</span>`,
      '<span></span>',
    ].join(''),
    extremeRow(tide.last_extreme, 'last', unitSystem),
    extremeRow(tide.next_extreme, 'next', unitSystem),
  ].join('');
  return `
    <div style="margin-top: 6px; font-size: 11px; color: #cbd5e1;">
      <div style="font-weight: 600; color: #cbd5e1; margin-bottom: 2px;">Tide · above MSL</div>
      <div style="display: grid; grid-template-columns: 12px auto auto 1fr; column-gap: 4px; align-items: baseline; color: #cbd5e1;">
        ${rows}
      </div>
      <div style="margin-top: 2px; color: #9ca3af; font-size: 10px;">Not for navigation</div>
    </div>
  `;
}
