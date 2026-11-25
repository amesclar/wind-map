# SCRUM-200 nautical chart recommendation

Spike 5, 2026-11-25. Closes the epic's provider evaluation (SCRUM-197) and settles the two
decisions SCRUM-203 inherits.

## Recommendation

1. **The overlay is not achievable with NOAA. Deliver charts as a base map (SCRUM-203), not an
   overlay.** This reverses the epic's "overlay for normal use" decision, and not on taste: both
   cleared NOAA services render **opaque** rasters that ignore `TRANSPARENT`, so an "overlay" at any
   opacity replaces the base map rather than sitting on it. The epic's argument for an overlay —
   "coverage is partial, so let the base show through" — is precisely what an opaque chart cannot do.
2. **B.C.: CHS NONNA depth contours as an opt-in overlay on the normal dark base, plus OpenSeaMap
   seamarks. No chart.** NONNA is genuinely transparent (23-81 % clear pixels) and overlays
   correctly; it is a bathymetric overview, strongest at z8-z12, with no U.S. coverage, and it
   carries the CHS derivative notice.
3. **The seamark toggle stays independent of any chart layer.** It is the only aid-to-navigation
   source in B.C., where no chart exists. In U.S. water with the chart on it duplicates the chart's
   own aids (layer 6), which is a clutter question for the toggle's wording, not a reason to suppress
   it.
4. **CHS NONNA is not mounted under the chart.** The paper-chart mode is opaque and covers U.S. water
   only; under it NONNA would be invisible. NONNA belongs to the B.C. view on a dark base.
5. **Seamap (vector): kept as an option, not as the chart overlay.** The product decision is to keep
   it for its rendering of navigation aids, so SCRUM-201's costs are recorded rather than treated as
   a rejection: +309 kB gzip against 382 kB of current JS, maxzoom 14, and a licence that needs
   settling (CC-BY 4.0 on the tiles, ODbL on the OSM-derived layers inside the style). It is not a
   chart substitute — at 1.0 under the wind gradient its pale style is the least legible of the
   three — so it is offered as an optional base style in SCRUM-203, with the gradient off and a
   light-map contrast pass. **CHS ENC: excluded** on licensing cost.

## Method

WMS 1.1.1 with `SRS=EPSG:3857`, `format=image/png`, `LAYERS=0,1,2,3,6` (SCRUM-202's recommended
set), origin sent on every request. PNGs decoded locally to count alpha, so "transparent" is a
measurement rather than a claim about the header. Legibility was rendered in a throwaway Vite
harness that imports the app's own `generateGridBarbSvg`, the app's `.osm-dark-tiles` filter and a
0.55-opacity gradient canvas drawn from the app's colour stops, over the real chart tiles. Each
screenshot's map area was then measured for mean luminance and the share of pixels above 0.75 luma
("light share"): the brighter the frame, the more the chart owns it.

## The decisive number: transparency

| Service | Clear pixels | `TRANSPARENT=true` vs `false` | Verdict |
| :--- | ---: | :--- | :--- |
| NOAA Chart Display | **0 %** | byte-identical (15,965 B both) | opaque, cannot overlay |
| NOAA ENC Online | **0 %** | byte-identical (18,073 B both) | opaque, cannot overlay |
| CHS NONNA (`NONNA 10` / `100`) | 23-81 % | ignored, tiles already carry alpha | transparent, overlays |
| OpenSeaMap | 96-100 % | n/a (XYZ PNG) | transparent, overlays |

Both NOAA services also return a single uniform tile outside coverage (887-888 B, one colour), so
neither can signal "no chart here" either.

## Legibility

| Configuration | Mean luma | Light share | What it looks like |
| :--- | ---: | ---: | :--- |
| NOAA CD at 0.7 over `osm_dark`, Oak Harbor z13 | 0.69 | 1 % | muddy wash: base map gone, chart detail washed out, barbs barely visible |
| NOAA CD at 1.0, Oak Harbor z13 | 0.81 | 91 % | paper chart reads, but the 0.55 gradient still buries its symbols |
| NOAA CD at 1.0, gradient off, Oak Harbor z13 | **0.88** | **94 %** | clean, fully legible chart: soundings, dredged areas, shallow-water blues |
| NOAA CD at 0.7 over `carto_dark`, z13 | 0.69 | 2 % | indistinguishable from `osm_dark`: the base choice is invisible under an opaque chart |
| NOAA CD at 0.7, Oak Harbor z10 | 0.69 | 21 % | worst case: dozens of soundings and contours under a heavy wash |
| NOAA CD at 0.7, Oak Harbor z18 | 0.67 | 0 % | nothing left but a pale sheet; no soundings at this zoom over land |
| NOAA CD at 1.0, Vancouver BC z12 | 0.80 | 89 % | blank paper with two shoreline traces |
| NOAA CD at 1.0, Strait of Georgia z11 | 0.76 | 78 % | coastline only, no soundings |
| CHS NONNA at 0.7 over `osm_dark`, Victoria z12 | **0.44** | **0 %** | base map, street labels and contours all legible: a true overlay |

Two conclusions follow. First, **the service cannot produce a true overlay**: it ignores `TRANSPARENT`
and ships one opaque raster, so any opacity is a flat blend of paper and base. At 0.7 the blend is
usable but compromised. A second render at Oak Harbor z14 (SCRUM-200's own review) keeps the OSM
street labels legible through the paper — Northwest Crosby Avenue and West Crescent Harbor Road read
at 0.7 — so the base is not lost the way it is at 1.0; but the chart's buff, yellow and pink depth
fills are pulled toward one another, and colour-coded depth is exactly what a chart is for. Full
strength reads as a chart; 0.7 reads as a washed chart over a faint base. That is why the primary
delivery is a base map rather than an overlay, and why 0.7 is not offered as a default. Second, **the
conflict is the gradient, not the barbs**: with the gradient off, the chart at 1.0 is the cleanest
image in the review, and the barbs and chevrons read against paper without any special treatment
beyond a halo.

## B.C. record (as the acceptance criteria require)

- **Oak Harbor's latitude, U.S. side:** full chart at z10-z18.
- **At the border (Victoria z12):** NOAA renders 35-43 KB of real chart; its ENC coverage reaches
  into Canadian water, ending near 49.7-49.8 N in the Strait of Georgia and about 50.1 N along the
  Vancouver Island side (SCRUM-202's north-limit sweep).
- **Strait of Georgia z11:** coastline and a little shallow-water tint, no soundings.
- **Vancouver z12:** 94 % blank paper. This is the case the coverage notice has to explain, and the
  case that makes NONNA the B.C. answer rather than a chart.
- **Coverage guard:** the service answers outside coverage with one uniform tile (887-888 B), so it
  can never signal "no chart here" by staying silent. Ink share on the tile at the Strait of Georgia
  (49.93 N) is 0 % at z10, z12 and z14, pixel standard deviation 0.000: a flat cream sheet at every
  zoom, which as an overlay hides the base map and the barbs rather than leaving a hole. The chart
  mode therefore needs a client-side clip south of about 49.6 N and a zoom floor of 12, and north of
  that clip the coverage notice is the only signal on offer.

## `requirements.md` delta

- The nautical section gains a **chart base map** subsection: NOAA Chart Display, opaque WMS as a
  fourth base-map value, its credit, its notice and the fact that outside U.S. waters it is blank
  paper with no coverage signal.
- It gains a **B.C. depth context** subsection (NONNA contours as a transparent overlay, its notice,
  z8-z12 limits) once that ticket exists; until then the section records that B.C. has seamarks and
  no chart.
- The seamark subsection records that the toggle is independent of the chart layer, and that the
  chart's own aid layer duplicates it in U.S. water.
- The export section records that a chart base adds `© NOAA Office of Coast Survey · Not for
  navigation` to the footer, and that chart tiles are never darkened.

## Epic comparison table: completed verdicts

| Candidate | Format | Licence / attribution | CORS | Zoom | Oak Harbor | Victoria BC | San Francisco | Latency | Export | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| NOAA Chart Display | WMS 1.1.1 PNG, **opaque** | public domain, CC0; credit + "Not for navigation" | echoes Origin | 8-18 tested, maxZoom 19 | full | full (border zone) | full | ~0.6 s, `max-age=0` | yes, no filter | **adopted, as a base map only** (SCRUM-203) |
| NOAA ENC Online | WMS 1.1.1 PNG, **opaque** | as above | echoes Origin | 8-18 | full | full | full | ~0.6 s, `max-age=0` | yes | **rejected for the overlay**; equivalent coverage and opacity to Chart Display, so it adds nothing here |
| CHS NONNA | WMS 1.3.0 PNG, **transparent** | OGL-Canada + CHS derivative notice | `*` with Origin | 8-12 useful | none | overview | none | ~0.4-0.5 s | yes | **adopted for B.C. as an overlay** (new ticket) |
| Open Waters Seamap | vector, MapLibre | CC-BY 4.0 tiles, ODbL for the OSM-derived layers | `*` | max 14 | thin | thin | sparse | n/a | WebGL capture solved (SCRUM-204) | **kept as an option** (product decision), offered as a base style in SCRUM-203 with the gradient off; costs: +309 kB gzip, maxzoom 14 |
| OpenSeaMap | XYZ PNG, transparent | ODbL data, CC-BY-SA tiles; credit required | `*` | to 19 | empty z14+ | sparse | some at z12 | 0.3-1 s | yes | **kept as shipped** (SCRUM-175), the only B.C. aid source |
| CHS ENC | WMS PNG | Crown copyright, licence required | echoes Origin | 8-18 | none | full | none | ~0.5 s | yes | **excluded** on licensing cost (2026-11-25) |

## Follow-up tickets, drafted (created only on request)

| Draft | Points | Scope |
| :--- | ---: | :--- |
| B.C. depth context: CHS NONNA overlay | 3 | `nonna_bc_visible` setting (off by default, strict parse), `L.tileLayer.wms` on its own pane at 210 like the seamarks, `nonna:NONNA 10` at z8-z12 with a `maxNativeZoom` of 12 so higher zooms upscale instead of returning blank, CHS credit plus the derivative notice in the toggle and the export footer, tests, visual check over Victoria and the Strait of Georgia |

No other implementation tickets are needed: SCRUM-203 already covers the chart base map, and
SCRUM-201/SCRUM-199 closed the vector and export questions.

## What this changes in SCRUM-203

| Change | Why |
| :--- | :--- |
| `LAYERS=0,1,2,3,6` instead of `1-12` | SCRUM-202's per-layer measurement: layer 8 (data-quality polygons, 28 KB) is the largest unwanted contributor, layer 0 is wanted, 4/5/7/9-12 were blank |
| The gradient is the headline contrast risk, not the barbs | at 0.55 the wash buries the chart; 0.35 (or off by default) is required, and the chart-only screenshot is the reference for what "legible" means |
| Coverage notice wording confirmed | blank paper is a real uniform colour with no marker, so the notice is the only signal available |
| NONNA explicitly out of the chart mode | opaque chart + no B.C. coverage = nothing to layer; NONNA is its own B.C. ticket |
| Seamark independence confirmed | B.C. depends on it; duplication in U.S. water is a wording issue |
| Seamap stays one of the base styles | kept as an option rather than dropped, so the style switch has to accept a MapLibre canvas layer beside the raster chart |
| Coverage clip and zoom floor | opaque blank paper outside coverage, so the chart mode clips south of about 49.6 N and starts at z12 instead of painting a cream sheet |

## Limitations

`carto_dark` was compared without a key, so its tiles carry a watermark; because the chart is opaque
at 0.7 the base is invisible either way, so the comparison holds for the conclusion but not as a
pixel-level review of CARTO. Latency was measured from this workstation, not Cloud Run. The harness
reproduces the app's barb SVG, dark-tile filter and gradient colour stops but not the real
`WindColorOverlay` canvas, so luminance is indicative rather than exact. Screenshots live beside this
file in `shots/`.
