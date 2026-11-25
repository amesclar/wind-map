# SCRUM-203 paper chart mode requirements

An opt-in "paper chart" viewing mode: official NOAA chart tiles become the base map instead of a
transparent overlay, and everything the app draws on top of the map stays legible on a light,
dense sheet.

Provider scope is NOAA Chart Display only. CHS ENC is excluded on licensing cost (2026-11-25), so
British Columbia, inland water and open ocean show blank chart paper; the mode has to degrade
without looking broken. Blocked by SCRUM-200 for the confirmed provider wording and for two
decisions it inherits (NONNA under the chart, seamark independence).

## Measurements this spec relies on (2026-11-25, live from this machine)

| Case | Request | Result |
| :--- | :--- | :--- |
| Oak Harbor z12, z16 | `LAYERS=0..12`, `SRS=EPSG:3857`, 256 px | 200 `image/png`, 17.7 KB / 16.9 KB, opaque |
| San Francisco z14 | same | 200, 61 KB, opaque, magenta `#db4996` at the tile centre |
| Victoria BC z12 | same | 200, 41 KB — NOAA coverage reaches into Canadian water at the border |
| Vancouver BC z12 | same | 200, 2.7 KB, 18 colours, 94 % paper — essentially blank paper |
| Inland Snoqualmie z12 | same | 200, 888 B, **one** colour: paper `#f4e8c1`, no "no chart" mark |
| Offshore 200 nm z8 | same | 200, 13.5 KB, 94 % white water |
| `TRANSPARENT=true` vs `false` | Oak Harbor z12 | **byte-identical** — the service ignores the flag |
| `LAYERS=1..12` / `LAYERS=2` / `LAYERS=0` | Oak Harbor z12 | 15.9 KB / 9.5 KB / 1.4 KB |
| NOAA ENC Online, same points | `LAYERS=0,1,2,3,6` | also **0 %** transparent, `TRANSPARENT` byte-identical |
| CHS NONNA (B.C. candidate) | `nonna:NONNA 10` | 23-81 % transparent — the only service here that can overlay |

Palette: land paper `#f4e8c1`, water `#ffffff`, shallow water `#afcde1`, grey `#616866`,
magenta `#db4996`. Every tile is fully opaque (alpha 255 everywhere), `access-control-allow-origin`
echoes the request origin, `cache-control: public, must-revalidate, max-age=0`, about 0.5-0.6 s per
tile. The WMS `LAYERS` names are numbers; 0 is the service's own display-information layer.

Layer set and contrast evidence added by SCRUM-200 (Spike 5, 2026-11-25): the recommended layer
set is `0,1,2,3,6`, because layer 8 (data-quality polygons, 28.1 KB of a 112 KB tile) is the largest
unwanted contributor and layers 4, 5, 7 and 9-12 were blank at these views. Rendered at 0.7 opacity
over a dark base the chart measures mean luma 0.69 and 1 % light pixels — neither base map nor
chart — while at full strength it is 0.81 / 91 %, and 0.88 / 94 % with the gradient off. So the mode
must be a base map at full strength, and the wind gradient, not the barbs, is the element that
buries it.

## Requirements

### 1. Base-map value and persistence

1.1 WHEN the base map is chosen THEN `MapTileLayer` shall gain `paper_chart` beside `carto_dark`,
`osm_dark` and `osm_standard`.
1.2 WHEN the stored `map_tile_layer` is `paper_chart` THEN the app shall restore it on reload;
WHEN the stored value is anything unrecognised THEN the app shall fall back to `osm_dark`; the
three existing values shall keep their current meaning and rendering.
1.3 WHEN the user has explicitly chosen `paper_chart` and the server supplies a CARTO key THEN the
app shall keep `paper_chart` mounted, because the key's session default would otherwise make the
mode unreachable in production after every reload. The three existing values keep today's
behaviour.

### 2. Tile service and mounting

2.1 WHEN `tileLayerConfig('paper_chart')` is called THEN it shall return a WMS 1.1.1 request to the
NOAA Chart Display service with `LAYERS=0,1,2,3,6` (chart information, features, soundings,
obstructions and aids to navigation, without the data-quality polygons of layer 8), `format=image/png`,
`SRS=EPSG:3857`, `crossOrigin: true`, `maxZoom: 19` and the NOAA credit.
2.2 THEN the config shall declare itself a WMS config, so `MapView` mounts it with
`L.tileLayer.wms`, while the three existing values keep using `L.tileLayer`.
2.3 THEN the chart layer shall never carry the `.osm-dark-tiles` class, and that filter shall never
apply to a chart tile on screen or in an export.
2.4 WHEN `paper_chart` is selected THEN the user's normal base layer shall stay mounted beneath a chart
layer on its own pane at z-index 205, because the chart is clipped by coverage and zoom (2.7) and
must reveal that base outside the clip rather than a blank canvas; inside the clip the opaque chart
covers it completely. Selecting any other value shall remove the chart layer with no duplicate.
2.5 THEN the chart's pane at 205 shall sit above the base tiles (200) and below the seamark pane
(210), so the gradient (250), the barbs (600) and the legends (750) keep their order, and clicks
shall still reach the map.
2.6 THEN no `TRANSPARENT` parameter shall be relied on: the service ignores it, so the config shall
state opacity in a comment rather than pretend to control it.
2.7 THEN the chart layer shall carry `bounds` clipped at 49.6 N and a `minZoom` of 12, because
outside its coverage the service answers with one flat cream tile (0 % ink at z10, z12 and z14 over
the Strait of Georgia) which, as a layer, hides the base map instead of leaving a hole. Both values
shall be exported constants so the notice and the tests share them.

### 3. Map Settings

3.1 WHEN Map Settings opens THEN a fourth radio, "Nautical Paper Chart", shall appear beside the
three existing ones, shall not be the default, and shall carry a keyless badge like the OSM
entries.
3.2 THEN that radio shall show the NOAA credit `© NOAA Office of Coast Survey`, the notice
`Not for navigation`, and the coverage note from 4.2.
3.3 THEN the CARTO key section shall say that the key applies to CARTO Dark Matter only.
3.4 WHEN the new radio is selected THEN it shall call `onChangeTileLayer('paper_chart')` and the
dialog shall stay open, like the other three.

### 4. Coverage

4.1 THEN the app shall not attempt to detect missing chart coverage from tile content: a
no-coverage tile is uniform paper `#f4e8c1` with no marker, indistinguishable from covered land.
4.2 WHEN `paper_chart` is selected THEN a compact map notice shall state that the chart covers U.S.
waters up to the border, that north of it and below z12 the normal base map shows, and that the
chart is not for navigation.
4.3 THEN the mode shall stay usable outside coverage and below the zoom floor: the notice, the wind
layers, the currents, the markers and the legends shall all render normally over the ordinary base
map, with no error and no blank canvas.
4.4 THEN north of the clip the notice shall be the only signal, because no tile in the service
reports "no chart here".
4.5 THEN a view that is outside the clip shall show no chart tile at all rather than a cream sheet,
and switching the mode on or off shall never leave an empty map.

### 5. Contrast pass on a light base

5.1 WHEN the chart base is mounted THEN wind barbs shall use a two-tone halo — a light inner glow
inside the existing dark outer glow — so a light temperature colour separates from both white
water and cream land; the dark temperature chip shall be kept.
5.2 THEN the selected barb's highlight ring shall invert to dark, because its current white ring
disappears on white water.
5.3 WHEN the chart base is mounted THEN current chevrons shall draw a light under-stroke behind the
tier stroke; tier colours, opacities and widths shall not change, so the chevron key stays in sync.
5.4 WHEN the chart base or the Seamap style is mounted THEN the wind colour gradient shall draw at a
lower opacity than on the dark bases, so the chart's own symbology stays readable; the export
captures the same canvas and therefore the same value. Measured (SCRUM-200): the gradient is the
element that buries the chart, not the barbs — with it off the chart at full strength is the most
legible state in the review (mean luma 0.88, 94 % light pixels), and at 0.55 it bleaches the paper's
own symbols. Map Settings shall recommend turning the gradient off with either light style, without
overriding the user's toggle.
5.5 THEN the legends, pop-ups, Leaflet zoom control and attribution shall keep their current dark
styling; no light theme shall be introduced.
5.6 THEN saved-location markers and their pop-ups shall stay legible over the chart, using the same
two-tone halo as the grid barbs.

### 6. Attribution and export

6.1 WHEN `attributionText('paper_chart')` is called THEN it shall return
`© NOAA Office of Coast Survey · Not for navigation`; the three existing values shall keep their
current strings.
6.2 THEN the export footer shall carry that string through the existing `attribution` field, and
the seamark credit shall keep appearing only while the seamark overlay is on.
6.3 THEN chart tiles shall be captured like base tiles (`img.leaflet-tile`, no dark-filter
ancestor), so an export shows the chart and its credit.
6.4 THEN the drawn export header, legend and footer shall stay dark as a consistent frame around
the light map.

### 7. Documentation

7.1 THEN `requirements.md` at the repository root shall record the fourth base map, the setting, the
coverage rule, the export attribution and the contrast decisions, in the same pull request.

### 8. Seamap as a fifth base style (SCRUM-200 amendment, 2026-11-25)

8.1 WHEN the base map is chosen THEN `MapTileLayer` shall also accept `seamap`, rendered as vector
tiles through MapLibre, because the product keeps Seamap for its rendering of navigation aids.
8.2 THEN `maplibre-gl` and `@maplibre/maplibre-gl-leaflet` shall be loaded lazily, only when the
style is first selected, so the initial bundle does not grow by the measured 309 kB gzip.
8.3 THEN the layer shall use `maxNativeZoom: 14`, upscaling beyond it rather than blanking, and
shall draw in a pane below the seamarks with `interactive: false`.
8.4 THEN the credit `(c) Open Waters: Seamap, (c) OpenStreetMap contributors` shall appear in the
radio and in the export footer.
8.5 THEN the export shall capture the GL canvas, which needs `preserveDrawingBuffer: true` and a
capture filter that keeps the GL container instead of treating it as a tile.
8.6 THEN the style shall draw with the wind gradient attenuated as in 5.4, and Map Settings shall
say the style is a navigation-aid rendering rather than a chart, with no depth soundings.
8.7 THEN the licence position shall be recorded in the radio: CC-BY 4.0 tiles, ODbL for the
OSM-derived layers, attribution required either way.

## Acceptance criteria

- A fourth and fifth radio exist, neither is the default, both survive a reload, and each of the
  five values renders its own base layer with no duplicate layer left behind.
- Barbs, chevrons, markers, pop-ups, legends and controls are legible over the chart at z10-z18 in
  U.S. waters, with screenshots as evidence.
- Outside chart coverage (Vancouver, inland, offshore) or below z12 the mode shows the ordinary
  base map with the notice and no error, evidenced in B.C. and inland, with no chart tile requested
  outside the clip.
- An export with the chart base contains the chart tiles and `© NOAA Office of Coast Survey · Not
  for navigation` in its footer, in PNG and in PDF.
- Users who never select either light style see no change, including their stored base map; the app
  loads no MapLibre code until Seamap is selected.
- `requirements.md` is updated in the same pull request, and the frontend lint, typecheck, coverage
  and build checks pass with the backend untouched.

## Estimate

**13 points as now scoped, which is above the 8-point ceiling and should be split.**

- Chart base map, its clip, contrast pass and export credit: **8 points** (a base-map value through
  settings, the tile table, the WMS mount and its bounds, the radio, attribution and export, plus the
  contrast pass over barbs, chevrons, markers, both legends, controls and the export chrome, with
  visual verification inside and outside the clip).
- Seamap base style (section 8): **5 points** (a second base-map value, a lazily loaded MapLibre
  layer, `maxNativeZoom` upscaling, the GL capture path, attribution, tests and a visual pass).

Recommended split: keep SCRUM-203 for the chart base at 8 and raise the Seamap style as its own
5-point ticket, since the two share only the radio group and the gradient attenuation.
