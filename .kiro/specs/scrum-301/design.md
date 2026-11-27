# SCRUM-301 — Design

## Overview

One table already selects the base map (`tileLayerConfig` in `frontend/src/components/mapTiles.ts`),
so the change is a removal plus a default, not a new mechanism: two `MapTileLayer` members go, the
fallback and the stored-value parser move to `carto_dark`, and the three keyless substrates that
borrowed `osm_dark` borrow `carto_dark` instead. Nothing in the backend changes.

## Where the layer list lives

| Concern | File | Change |
| --- | --- | --- |
| The union of bases | `frontend/src/types.ts` | `MapTileLayer` loses `osm_dark` and `osm_standard`; the comment names CARTO as the default. |
| Names, tone, URLs | `frontend/src/components/mapTiles.ts` | Drop the two table entries and `OSM_URL`; `LIGHT_TILE_LAYERS` keeps only `paper_chart`; `tileLayerConfig` loses both `case`s and the `osm_dark`/`osm_standard` overload; `attributionText` gains CARTO as the credited default. |
| Stored value and default | `frontend/src/hooks/useSettings.ts` | `TILE_LAYER_IDS` loses both ids; `parseTileLayer` returns `carto_dark` for anything unknown, and maps the two retired ids onto it (requirement 1.2). |
| Mount | `frontend/src/hooks/useBaseLayers.ts` | The chart, Seamap and Google substrates call `tileLayerConfig('carto_dark', cartoApiKey)`. |
| Radios | `frontend/src/components/MapSettingsModal.tsx` | The two OpenStreetMap rows and their info panels are deleted; CARTO's row moves to the top and stays first. |

`OSM_ATTRIBUTION` stays: CARTO's credit is `© OpenStreetMap contributors © CARTO` (its data is
OpenStreetMap's, ODbL), and the Seamap style carries the same line.

## The stored-value migration

`useLocalStorageState` parses on read and writes only when a setter runs, so a retired id is
translated in the parser rather than rewritten in storage:

```ts
const RETIRED_TILE_LAYERS = new Set(['osm_dark', 'osm_standard']);
const parseTileLayer = (stored: string | null): MapTileLayer => {
  if (stored && RETIRED_TILE_LAYERS.has(stored)) return 'carto_dark';
  return TILE_LAYER_IDS.includes(stored as MapTileLayer) ? (stored as MapTileLayer) : 'carto_dark';
};
```

That satisfies 1.2 without a write on mount, and a browser that never had a preference simply takes
the new default. `applyServerConfig` is unchanged: it only promotes `carto_dark` for the session
when the server key is present and no light base is stored, and a stored `paper_chart` or `seamap`
still outranks it (1.3, 1.4).

## The keyless case

`tileLayerConfig('carto_dark', '')` keeps building the unkeyed `dark_all` URL. CARTO answers it
with its `API KEY REQUIRED` notice tile (verified 2026-11-27: three coordinates, one 2,513-byte
body), which is the provider's own signal and must stay visible. No layer is added to hide or cover
it, and the app reports it as a tile failure through SCRUM-302's notice rather than pretending the
map loaded. A key is present in every deployment via `GET /api/config`.

## The CSS dark filter

`.osm-dark-tiles` only ever darkened the `osm_dark` base. With that base gone no layer carries the
class, so `captureDom.collectTiles` marks every tile `dark: false` and the export paints the CARTO
tiles exactly as they arrive, which is what it already does for every other base. The filter, the
`DARK_TILE_FILTER` constant and the `dark` flag stay in place: they are the generic "this tile needs
the filter applied while drawing" path, they are still covered by
`frontend/src/utils/captureMap.test.ts`, and deleting them would widen this ticket into the export
pipeline for no behaviour change. `frontend/src/index.css` keeps the rule for the same reason.

## Correctness properties

1. For every `MapTileLayer`, `tileLayerConfig(layer).url` contains no `tile.openstreetmap.org`
   (2.1). Asserted over the union, not per case, so a future entry cannot reintroduce it.
2. `parseTileLayer(null) === 'carto_dark'`, and both retired ids parse to `carto_dark` (1.1, 1.2).
3. The chart, Seamap and Satellite substrates resolve to the CARTO URL (2.3).
4. `attributionText('carto_dark')` names both providers (3.2, 3.1).
5. `isLightTileLayer` is true only for `paper_chart`, so the dialog's theme follows 4.2 with the
   two light bases left.

## Testing

- `frontend/src/components/mapTiles.test.ts`: the layer table, the attribution, the no-OSM sweep
  over the union, and the chart/Seamap class assertions that named the filter.
- `frontend/src/hooks/useSettings.test.ts`: the default, the two retired ids, and the light bases
  still winning over the server key's session default.
- `frontend/src/components/MapSettingsModal.test.tsx`: the radios offered and their order, the
  theme per base, and the info panels that moved.
- `frontend/src/components/MapView.test.tsx`: the substrate assertions and the base-switch cases
  that used `osm_dark`.
