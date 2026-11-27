# SCRUM-333 — OpenStreetMap bases as an opt-in, with current-view-only export

## Why

SCRUM-301 removed the two `tile.openstreetmap.org` bases because the app's use of the Foundation's
volunteer servers was judged non-compliant. SCRUM-331 re-read the policy and concluded the only
prohibited part was the range export, which moves the map and captures frames of tiles nobody is
viewing. Limit export to the current view and the remaining traffic is the policy's own permitted
example.

## Requirements

- R1 `osm_dark` and `osm_standard` return to `MapTileLayer`, the radios, the layer table and the
  stored-value parser. Neither is ever the default; an unknown stored id still lands on `carto_dark`.
- R2 The tiles are the policy's exact URL, with `© OpenStreetMap contributors` in the Leaflet credit
  and in the export footer. `osm_dark` is the same light tiles under `.osm-dark-tiles`.
- R3 The range export is unavailable on both, and the copy is the owner's (2026-11-27):
  **"Time-lapsed exports not supported"**, shown on both Map Settings rows and in the export dialog.
  The current-view export keeps working.
- R4 OSM Light is a light sheet (barbs, temperature ramp, settings theme); OSM Dark is dark.
- R5 The technical rules SCRUM-288 established stay: `Referrer-Policy: strict-origin-when-cross-origin`
  pinned by a test, no no-cache headers, no prefetch.
- R6 If SCRUM-332 lands first, the disabled mode is its times picker; the restriction and copy do not
  change.

## Acceptance

Both bases render keyless, neither is the default, Map Settings shows the note on both, a range export
cannot be started on them, the view export still works, and CARTO is what every fresh browser gets.
