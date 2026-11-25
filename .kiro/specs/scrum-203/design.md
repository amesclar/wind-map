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
export const NOAA_CHART_LAYERS = '0,1,2,3,6';
export const NOAA_ATTRIBUTION = '&copy; <a href="https://nauticalcharts.noaa.gov/">NOAA Office of Coast Survey</a>';
export const NOAA_ATTRIBUTION_TEXT = '© NOAA Office of Coast Survey';
export const NOAA_NOTICE = 'Not for navigation';
export const NOAA_COVERAGE_NOTICE =
  'NOAA chart coverage is U.S. waters only — Canada, inland and open ocean show blank chart paper.';
export const CHART_TILE_CLASS = 'noaa-chart-tiles';
/** The chart is clipped at this latitude and this zoom, so it never paints cream paper over the base. */
export const CHART_COVERAGE_MAX_LAT = 49.6;
export const CHART_MIN_ZOOM = 12;
/** Above the base tiles (200), below the seamarks (210). */
export const CHART_PANE = 'chartPane';
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

Why this set: SCRUM-202 measured each layer alone at Oak Harbor z12. Layer 8 (data quality) is
28.1 KB of a 112 KB tile and is not wanted, layers 4, 5, 7 and 9-12 were blank at the control views,
and 0/1/2/3/6 carry the chart information, features, soundings, obstructions and aids to navigation.
`TRANSPARENT` is not sent as a control: measured byte-identical output for `true` and `false` — and
0 % transparent pixels — so the comment records that the tiles are opaque rather than implying a
flag works.

### Mount (`frontend/src/components/MapView.tsx`)

The base-layer effect keeps mounting the user's chosen layer. When `paper_chart` is selected it
mounts **that layer as the substrate** and the chart above it in its own pane:

```ts
// substrate: always the keyless dark base, so the clip edge reveals a working map with no key
const substrate = tileLayerConfig('osm_dark');
baseLayer = L.tileLayer(substrate.url, substrate.options).addTo(map);

// chart: clipped to coverage and to z12+
chartLayer = L.tileLayer.wms(CHART_URL, {
  ...chartTileOptions,
  pane: CHART_PANE,
  bounds: L.latLngBounds([-85, -180], [CHART_COVERAGE_MAX_LAT, -60]),
  minZoom: CHART_MIN_ZOOM,
}).addTo(map);
```

The substrate is deliberately `osm_dark` rather than the previously chosen base: it is keyless, it is
the default, and a clip edge must never depend on a CARTO key being present. The trade-off is that a
user on `osm_standard` or `carto_dark` sees the dark base north of the border instead of their own
choice; the coverage notice explains it, and the alternative (remembering a previous raster base in
ephemeral state) is not worth the extra state for this opt-in mode.

`CHART_PANE` is created once at z-index 205 with `pointer-events: none`, so the seamark pane (210),
wind colour (250), barbs (600) and legends (750) keep the order documented in `requirements.md`.

Why a substrate at all: the chart is clipped, and outside the clip a layer that draws nothing leaves
the dark map background. Keeping the user's base underneath means panning north of the border or
zooming out simply reveals the ordinary map. The cost is OSM tiles fetched under the chart where it
covers them; that is the price of never showing an empty canvas, and it is bounded by Leaflet's
`keepBuffer`.

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
`role="note"`, `data-testid="chart-coverage-notice"`), only while the chart is selected **and not
actually painting** — that is, when `map.getBounds().getSouth() > CHART_COVERAGE_MAX_LAT` or
`map.getZoom() < CHART_MIN_ZOOM`. A small `chartInView` state updated on `moveend`/`zoomend` (and
once on mount) drives it, because the chip has to follow a pan north or a zoom out. Top-left belongs
to the currents key and the bottom strip belongs to the wind colour legend, so top-right is the only
free corner. The same sentence appears under the radio in Map Settings, and the credit plus notice
in the export footer.

There is still no per-tile detection: a no-coverage tile is a single paper colour with no marker, so
the clip is the only guard and the chip is what explains it. The chip is conditional rather than
always-on precisely because the clip makes the condition computable from the map state.

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
own symbols survive. SCRUM-200's rendered comparison backs this: with the gradient off the chart at
full strength is the cleanest state in the review, and every gradient-on state bleaches the paper.
0.35 is the compromise that keeps the user's toggle working instead of overriding it.

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

### Deferred: the Seamap base style

`seamap` (MapLibre vector tiles, lazy import, the z14 ceiling, the GL capture path) is
**SCRUM-206**. Its design notes from SCRUM-200 live there and this spec deliberately does not
depend on it. The one shared item is the light-base gradient constant in 5.4, which SCRUM-206
reuses rather than duplicating.

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
9. With `paper_chart` selected the mount is a pair: one `osm_dark` substrate plus one chart layer, and
   the chart carries `bounds`/`minZoom` from the exported constants (2.4, 2.7).
10. The coverage chip is present exactly when the chart is selected and not painting, and absent
    otherwise (4.2, 4.4).
11. `attributionText` covers all four values, and the three legacy strings are unchanged (6.1).

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

## Inherited decisions (SCRUM-200, 2026-11-25)

| Decision | Outcome | Basis |
| :--- | :--- | :--- |
| Overlay or base map | Base map | Both NOAA services are 0 % transparent and ignore `TRANSPARENT`; at 0.7 the frame is neither (0.69 luma, 1 % light) |
| CHS NONNA under the chart | No | NONNA is transparent but is a B.C. z8-z12 overview; the chart is opaque and has no B.C. coverage, so there is nothing to put it under. It gets its own B.C. overlay ticket |
| Seamark toggle while a chart is on | Stays independent | It is the only aid source in B.C.; the chart's own layer 6 duplicates it in U.S. water, which is a wording note, not a suppression |
| Vector (Seamap) | Kept as an option, now SCRUM-206 | Product decision; measured +309 kB gzip, maxzoom 14, licence split CC-BY 4.0 / ODbL |

## Out of scope

The overlay recommended by the evaluation (its own ticket), CHS ENC or any CHS purchase, NONNA
contours (its own B.C. ticket), the Seamap vector style (**SCRUM-206**), a light theme for the app,
self-hosted tiles, a backend proxy or cache, and any change to the three dark/standard base maps and
their rendering.
