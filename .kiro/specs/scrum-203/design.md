# SCRUM-203 paper chart mode design

## Overview

`paper_chart` becomes the fourth `MapTileLayer`. It is the only value that is not an XYZ tile
template: NOAA Chart Display is a WMS, and its tiles are fully opaque paper, so it replaces the
base map outright rather than sitting on one. The value flows through the same places as the
existing three — the settings parser, `tileLayerConfig`, the base-map radios, `attributionText` and
the export footer — plus a small, map-adjacent contrast pass and a coverage notice.

## Glossary

| Term | Meaning |
| :--- | :--- |
| Paper chart | NOAA Chart Display raster, WMS 1.1.1, `SRS=EPSG:3857`, paper symbology |
| Chart base | The state where `tileLayer === 'paper_chart'` |
| Coverage | U.S. waters only; Canada, inland and open ocean have no chart in this mode |
| Two-tone halo | A light inner glow inside the existing dark outer glow (barbs, chevrons) |

## Architecture

### Tile table (`frontend/src/components/mapTiles.ts`)

`TileLayerConfig` becomes a discriminated union, so the mount code cannot silently treat a WMS as
an XYZ template:

```ts
export type TileLayerConfig =
  | { kind: 'xyz'; url: string; options: L.TileLayerOptions }
  | { kind: 'wms'; url: string; options: L.WMSOptions };
```

New constants:

```ts
export const NOAA_CHART_URL =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer';
export const NOAA_CHART_LAYERS = '1,2,3,4,5,6,7,8,9,10,11,12';
export const NOAA_ATTRIBUTION = '&copy; <a href="https://nauticalcharts.noaa.gov/">NOAA Office of Coast Survey</a>';
export const NOAA_ATTRIBUTION_TEXT = '© NOAA Office of Coast Survey';
export const NOAA_NOTICE = 'Not for navigation';
export const NOAA_COVERAGE_NOTICE =
  'NOAA chart coverage is U.S. waters only — Canada, inland and open ocean show blank chart paper.';
export const CHART_TILE_CLASS = 'noaa-chart-tiles';
```

`tileLayerConfig('paper_chart')` returns:

```ts
{
  kind: 'wms',
  url: NOAA_CHART_URL,
  options: {
    layers: NOAA_CHART_LAYERS,
    format: 'image/png',
    version: '1.1.1',
    crs: L.CRS.EPSG3857,        // the service's 4326 axis order is lat,lon and returns blanks
    attribution: NOAA_ATTRIBUTION,
    maxZoom: 19,
    crossOrigin: true,
    className: CHART_TILE_CLASS, // never .osm-dark-tiles
  },
}
```

`attributionText` gains one branch: `paper_chart` → `${NOAA_ATTRIBUTION_TEXT} · ${NOAA_NOTICE}`.
The existing three strings are untouched.

Why layer 0 is excluded: it is the service's own display-information layer (1.4 KB alone over Oak
Harbor), which would repeat chart-legend text in every tile. Layers 1-12 are the chart itself.
`TRANSPARENT` is not sent as a control: measured byte-identical output for `true` and `false`, so
the comment records that the tiles are opaque rather than implying a flag works.

### Mount (`frontend/src/components/MapView.tsx`)

The existing base-layer effect already mounts exactly one layer and removes it on change, which is
the behaviour 2.4 needs; only the construction branches:

```ts
const config = tileLayerConfig(tileLayerType, cartoApiKey);
const layer = config.kind === 'wms'
  ? L.tileLayer.wms(config.url, config.options)
  : L.tileLayer(config.url, config.options);
```

No new pane: chart tiles go to Leaflet's `tilePane` (z 200), so the seamark pane (210), the wind
colour pane (250), the barb markers (600) and the legends (750) keep the order documented in
`requirements.md`.

`chartBase = tileLayerType === 'paper_chart'` is computed once and drives:

- the wrapper class `chart-base`, which switches the halo and ring CSS;
- `WindOverlay halo={windColorOverlayVisible || chartBase}` — the halo class must be present on a
  light base even when the gradient is off;
- `CurrentOverlay halo={chartBase}`;
- `WindColorOverlay opacity={chartBase ? WIND_COLOR_OPACITY_ON_CHART : WIND_COLOR_OPACITY}`;
- the coverage notice chip.

### Coverage notice

`NOAA_COVERAGE_NOTICE` renders in a compact chip at the map's top-right, below the Leaflet zoom
control (`absolute right-3 top-24 z-[750]`, dark card like `CurrentLegend`, `pointer-events-none`,
`role="note"`, `data-testid="chart-coverage-notice"`), only while `chartBase`. Top-left belongs to
the currents key and the bottom strip belongs to the wind colour legend, so top-right is the only
free corner. The same sentence appears under the radio in Map Settings, and the credit plus notice
in the export footer.

There is no per-view detection: the measurement shows a no-coverage tile is a single paper colour
with no marker, so a coverage polygon or a tile-content check would be guesswork. The notice is
static and always true while the mode is on.

### Contrast pass

| Element | Today | On the chart base | Where |
| :--- | :--- | :--- | :--- |
| Grid barbs | `.wind-barb-halo`, dark drop-shadows | light inner glow + dark outer glow | `index.css` |
| Selected barb | white 2 px ring (`buildGridBarbIcon`) | dark 2 px ring | `WindOverlay.tsx` |
| Barb temperature chip | `#161b22` at 0.85 | unchanged (reads on light) | `WindBarb.tsx` |
| Current chevrons | tier stroke only | light under-stroke, tier stroke on top | `WaterCurrentChevron.tsx` |
| Wind gradient | `WIND_COLOR_OPACITY = 0.55` | `WIND_COLOR_OPACITY_ON_CHART = 0.35` | `WindColorOverlay.tsx` |
| Legends, pop-ups, zoom, attribution | dark cards, white boxes | unchanged | — |
| Saved-location markers | dark chip, blue glow | same halo as grid barbs | `MapView.tsx` |

CSS (one block, no component change for the barbs):

```css
/* SCRUM-203: on the light chart sheet the dark halo alone is not enough: a light glow inside it
   separates a light temperature colour from white water, and the dark glow still separates the
   glyph from cream land. */
.chart-base .wind-barb-halo {
  filter: drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.95))
    drop-shadow(0 0 3.5px rgba(0, 0, 0, 0.9));
}
```

Chevrons: `generateCurrentChevronSvg(velocity, direction, size, { halo })` renders, before the tier
group, a copy of the same paths with `stroke="#ffffff"`, `stroke-width` = tier width + 2.5 and
`opacity="0.85"`. `buildCurrentChevronIcon(pt, size, halo)` and `CurrentOverlay halo` thread it
through; the default is `false`, so the dark-base output is byte-for-byte what it is today.

Gradient opacity: the canvas opacity is currently set inside the mount effect (`[map]` deps), so a
prop change would not reach it. Keep an `opacityRef` beside `pointsRef`/`visibleRef` and apply
`canvas.style.opacity` in `paint()`; the existing "new data or visibility" effect then also covers
an opacity change. `WIND_COLOR_OPACITY_ON_CHART = 0.35` is exported next to `WIND_COLOR_OPACITY` so a
test can assert both. The export needs no change: `modern-screenshot` captures the same canvas, so
the exported wash matches the screen — the property SCRUM-165 established for the legend.

0.35 rather than 0.55: at 0.55 the wash covered the chart's magenta and shallow-water blues, which
is the whole point of the mode; at 0.35 the speed field still reads as a field while the chart's
own symbols survive.

### Settings (`frontend/src/components/MapSettingsModal.tsx`)

Fourth `<label>` in the base-map group, after `osm_standard`, with `data-testid="tile-layer-paper-chart"`,
badge `Free • No Key Needed`, description naming NOAA's paper charts and the slower load
(`max-age=0`, about 0.5 s per tile), and a note block carrying `© NOAA Office of Coast Survey`,
`Not for navigation` and `NOAA_COVERAGE_NOTICE`. The CARTO section gains one caption line: the key
applies to CARTO Dark Matter only.

### Persistence (`frontend/src/hooks/useSettings.ts`)

`TILE_LAYER_IDS` gains `paper_chart`, so `parseTileLayer` accepts it and still falls back to
`osm_dark`. One behaviour change is required by 1.3: `applyServerConfig` currently sets the session
layer to `carto_dark` whenever a server key exists and the user has no key, which would override a
stored `paper_chart` on every load in production (where `CARTO_API_KEY` is set). It gains one
condition — `storedTileLayer !== 'paper_chart'` — and `storedTileLayer` joins its dependency list.
The pre-existing override of a deliberate `osm_standard` choice is left as it is: changing it is a
separate behaviour change, out of scope here.

### Export

No new plumbing: `useMapExport` already passes `attributionText(tileLayer)` into
`buildExportFooter`, so the chart credit and notice appear for free. Chart tiles are
`img.leaflet-tile` with no `.osm-dark-tiles` ancestor, so `collectTiles` picks them up, `drawTiles`
skips the filter, and `waitForTiles` covers their load. The export chrome stays dark (6.4): the
frame is drawn outside the map area and a light frame would be a second, unrelated theme.

## Correctness properties

1. For every `MapTileLayer` value, `attributionText` returns a non-empty credit and the three
   legacy strings are unchanged (6.1).
2. For every value, `tileLayerConfig(...).options.className` never contains `osm-dark-tiles`, and
   only `osm_dark` carries it (2.3).
3. `parseTileLayer` round-trips each of the four ids and maps every other string to `osm_dark` (1.2).
4. After any sequence of base-map changes, `MapView` has exactly one live base layer and, while
   `paper_chart`, zero OSM layers (2.4).
5. `tileLayerConfig('paper_chart')` is a `wms` config whose `options.layers` is exactly
   `NOAA_CHART_LAYERS` and whose `options.crs` is `EPSG:3857` (2.1, 2.2).
6. A stored `paper_chart` survives `applyServerConfig` with a server key present (1.3).
7. The gradient canvas opacity is `WIND_COLOR_OPACITY_ON_CHART` while `chartBase` and
   `WIND_COLOR_OPACITY` otherwise (5.4).
8. Chevron SVG output for `halo: false` equals today's output exactly (5.3).

## Risks

- **Slow pans.** NOAA sends `max-age=0`, so every pan and zoom is an origin request at about 0.5 s
  per tile. Accepted: the mode is opt-in and the settings text says so. Leaflet's `keepBuffer`
  keeps a margin of loaded tiles within a session.
- **Blank B.C.** Vancouver is 94 % paper at z12. The notice is the mitigation; the alternative
  (NONNA contours under the chart) is SCRUM-200's decision and would mount on its own pane.
- **Seamark clutter.** OpenSeaMap over a dense paper chart is busy; whether the seamark toggle is
  suppressed while a chart is on is also SCRUM-200's decision. This ticket leaves the toggle
  independent, which is the current behaviour.
- **WMS tile size.** 256 px tiles at z18 over dense water are large (61 KB at z14 San Francisco);
  no cache-busting, no proxy, so no change to the backend.

## Out of scope

The overlay recommended by the evaluation (its own ticket), CHS ENC or any CHS purchase, NONNA
contours, a light theme for the app, self-hosted tiles, a backend proxy or cache, and any change to
the existing three base maps.
