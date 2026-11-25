# Requirements: SCRUM-252 — whole pop-up visible near the map edge

## Scope

- In: placement of the three Leaflet pop-ups (saved location, wind barb, current chevron) so the
  whole card sits inside the visible map panel and clear of the floating top controls.
- Out: changing pop-up content, image export, or the grid-refresh suppression from SCRUM-251.

## Requirements

### 1. Shared binding options

1.1 WHEN a saved-location, wind-barb or current-chevron pop-up is bound, the system shall use one
shared set of placement options rather than Leaflet defaults.

1.2 The options shall keep auto-pan on, keep the pop-up in view, and reserve 12 px at the panel
edges and 88 px at the top for the zoom control and floating notices/legends.

### 2. Keeping the card inside

2.1 WHEN an open pop-up extends past the left, right or bottom padding, the system shall nudge it
back inside the panel by the overflow distance.

2.2 WHEN an open pop-up extends above the reserved top strip, the system shall nudge it down to
clear that strip.

2.3 WHEN a nudge exceeds 16 px in either axis (Euclidean distance), the system shall hide the
pop-up tip, so it cannot point at a marker the card no longer sits beside; smaller nudges shall
keep the tip.

2.4 WHEN the pop-up already fits, the system shall leave it exactly where Leaflet placed it.

### 3. Re-measuring

3.1 WHEN the tide block arrives after `popupopen`, the system shall re-run placement so a taller
card is still inside.

3.2 WHEN Leaflet's own auto-pan finishes, the system shall re-run placement at the settled
position.

### 4. Unchanged behaviour

4.1 WHEN a pop-up is opened away from an edge, its appearance and position shall match today's.

4.2 WHEN the user pans or zooms with a pop-up open, SCRUM-251's refresh suppression and pop-up
behaviour shall remain unchanged.

4.3 Pop-ups shall remain excluded from image export, and lint, typecheck and coverage gates shall
stay unchanged.
