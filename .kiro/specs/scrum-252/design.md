# Design: SCRUM-252

## Overview

Leaflet's auto-pan keeps a pop-up inside the map container, but not clear of the app's floating
controls, and it cannot fit a tall card in the little space a corner marker leaves. The fix has
two layers: reserve room before Leaflet pans, then measure and nudge whatever still overflows.

## Helper (`frontend/src/utils/popupPlacement.ts`)

- `POPUP_EDGE_PADDING = 12`, `POPUP_TOP_PADDING = 88`, `POPUP_TIP_TOLERANCE_PX = 16`.
- `POPUP_OPTIONS`: `autoPan: true`, `keepInView: true`, padding top-left
  `[12, 88]`, bottom-right `[12, 12]`.
- `popupNudge(popup, container)` returns the translation that brings the card inside; it handles
  one axis independently and rounds to whole pixels.
- `tipVisible({x, y})` is the Euclidean distance test against the tolerance.
- `placePopupInView(map, popup)` clears any previous margins before measuring, applies the nudge
  as `marginLeft`/`marginTop` (Leaflet's own positioning transform is left alone) and toggles
  `.leaflet-popup-tip-container`.

## Wiring

- `MapView`, `WindOverlay` and `CurrentOverlay` pass `POPUP_OPTIONS` to every `bindPopup`.
- `MapView`'s existing `popupopen` listener, which already fills the tide slot, now calls
  `placePopupInView` first, again on the map's next `moveend` (the end of Leaflet's auto-pan) and
  again after the tide block is inserted. One listener covers every pop-up on the map.

## Correctness

- 2.1/2.2/2.4: pure geometry; `popupNudge` returns zero when the rect already fits.
- 2.3: the tip display is derived from the same nudge, so it cannot disagree with the card.
- 3.1/3.2: explicit re-measure calls after content growth and after the pan settles.
- 4.1: no margins are set for a centred pop-up.
- 4.2: `useWindGrid` is untouched.

## Tests

- `popupPlacement.test.ts` covers all four edges, a corner, the shared option values and the tip
  threshold.
- `MapView.test.tsx` asserts a saved-location pop-up binds the shared options and that a
  `popupopen` at the top-left corner gets margins and a hidden tip (jsdom returns empty rects).
- `WindOverlay.component.test.tsx` and `CurrentOverlay.test.tsx` assert the shared options on the
  other two call sites.
- Leaflet's test mock now records `bindPopup` options, passes map-event arguments and implements
  `once`, so the wiring can be exercised without a real map.

## Risks

- Margins persist while the same pop-up is open across a user pan; the card stays inside the panel
  and the next open resets them.
- Measuring mid-animation is handled by the `moveend` re-measure; the immediate call covers the
  no-pan case.
