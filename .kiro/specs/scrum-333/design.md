# SCRUM-333 — Design

## The table, again

`types.ts`, `TILE_LAYER_NAMES` (OSM Dark, OSM Light), `LIGHT_TILE_LAYERS` + `isLightBase` (only
`osm_standard`), `tileLayerConfig` (one overload arm, two cases) and `attributionText`. The URL lives
once, as `OSM_TILE_URL`, so the exact-URL rule cannot drift between the two bases.

Removing `RETIRED_TILE_LAYERS` from `useSettings` is what makes a stored `osm_dark` hold again; the
parser is then the plain membership test it was before SCRUM-301, with `carto_dark` as the fallback.

## Refusing only the range

The restriction is per mode, not per export, so it cannot reuse the Google `disabled` flag (which
blocks the whole dialog). `osmRangeExportBlockedReason(layer)` returns the reason or `undefined`;
`App` passes it as `rangeDisabledReason` to `MapExportDialog`, which forwards it to `ExportModeField`.
There the Range button is `disabled` with the reason as its `title`, and the reason is printed under
the group as `export-range-disabled-note`. A `useEffect` before the dialog's early return drops the
mode back to `view` if the restriction arrives while range is selected — the property holds whatever
order the props arrive in.

The note and the reason share one string pair in `mapTiles.ts` (`OSM_RANGE_EXPORT_NOTE` is the
owner's copy; `OSM_RANGE_EXPORT_REASON` starts with it), so the settings row and the dialog cannot
disagree.

## What stays off

No prefetch, no tile proxy, no server-side cache, no change to the Referrer-Policy. The `Not for
navigation` style notices do not apply: OpenStreetMap is a road map, and the settings row says only
the credit and the export limit.
