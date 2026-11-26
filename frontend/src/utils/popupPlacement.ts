/**
 * Pop-up placement on the map (SCRUM-252).
 *
 * Leaflet's auto-pan only knows the map container, so a pop-up opened by a marker near an edge can
 * run under the floating controls or past the panel. Every pop-up binds with `POPUP_OPTIONS`,
 * which reserves room for those controls; `placePopupInView` nudges the card the rest of the way
 * when even a full pan cannot fit it (the tide block makes the card tall).
 */

import type L from 'leaflet';

/** Room kept between a pop-up and the edges of the map panel. */
export const POPUP_EDGE_PADDING = 12;
/** Room kept at the top for the zoom control and the floating notices and legends. */
export const POPUP_TOP_PADDING = 88;
/** A nudge up to this far still leaves the tip close enough to the marker to keep it. */
export const POPUP_TIP_TOLERANCE_PX = 16;

/** Binding options shared by the saved-location, wind-barb and current-chevron pop-ups. */
export const POPUP_OPTIONS: L.PopupOptions = {
  autoPan: true,
  keepInView: true,
  autoPanPaddingTopLeft: [POPUP_EDGE_PADDING, POPUP_TOP_PADDING],
  autoPanPaddingBottomRight: [POPUP_EDGE_PADDING, POPUP_EDGE_PADDING],
};

export interface PopupRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far a pop-up must move to sit inside the panel; `{0, 0}` means it already fits. */
export function popupNudge(popup: PopupRect, container: PopupRect): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (popup.left < container.left + POPUP_EDGE_PADDING) {
    x = container.left + POPUP_EDGE_PADDING - popup.left;
  } else if (popup.right > container.right - POPUP_EDGE_PADDING) {
    x = container.right - POPUP_EDGE_PADDING - popup.right;
  }
  if (popup.top < container.top + POPUP_TOP_PADDING) {
    y = container.top + POPUP_TOP_PADDING - popup.top;
  } else if (popup.bottom > container.bottom - POPUP_EDGE_PADDING) {
    y = container.bottom - POPUP_EDGE_PADDING - popup.bottom;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** The tip still points at the marker unless the card had to move far away from it. */
export function tipVisible(nudge: { x: number; y: number }): boolean {
  return Math.hypot(nudge.x, nudge.y) <= POPUP_TIP_TOLERANCE_PX;
}

/**
 * Nudge an open pop-up inside the map panel. Safe to call again after its content changes or after
 * Leaflet's own auto-pan settles; the previous nudge is removed before measuring.
 */
export function placePopupInView(map: L.Map, popup: HTMLElement | null | undefined): void {
  if (!popup?.isConnected) return;
  popup.style.marginLeft = '';
  popup.style.marginTop = '';
  const container = map.getContainer();
  if (!container) return;
  const nudge = popupNudge(popup.getBoundingClientRect(), container.getBoundingClientRect());
  if (nudge.x) popup.style.marginLeft = `${nudge.x}px`;
  if (nudge.y) popup.style.marginTop = `${nudge.y}px`;
  const tip = popup.querySelector<HTMLElement>('.leaflet-popup-tip-container');
  if (tip) tip.style.display = tipVisible(nudge) ? '' : 'none';
}
