# SCRUM-203 tasks

Branch: `feature/SCRUM-203-paper-chart-mode`, from `develop`. SCRUM-200 is Done and its two
inherited decisions are recorded in `design.md`: the chart is a base map (not an overlay), NONNA is
out of this mode, the seamark toggle stays independent.

**Scope note.** Tasks 1-12 are the 8-point chart base map. Tasks 13-17 are the Seamap style that the
SCRUM-200 amendment folded in, which is 5 points on its own: together this ticket is 13, above the
8-point ceiling. Recommended: stop after task 12, merge the chart base as SCRUM-203, and raise
Seamap as its own ticket. Split confirmed by the user before task 13 starts.

- [ ] 1. Tile table: `TileLayerConfig` becomes an `xyz`/`wms` union; the NOAA constants land, with
  `CHART_PANE`, `CHART_COVERAGE_MAX_LAT` and `CHART_MIN_ZOOM` exported; `tileLayerConfig('paper_chart')`
  returns the WMS config (layers `0,1,2,3,6`, `image/png`, version `1.1.1`, `crs: L.CRS.EPSG3857`,
  `crossOrigin`, `maxZoom: 19`, `CHART_TILE_CLASS`).
  _Requirements: 2.1, 2.2, 2.6_
  _Files: `frontend/src/components/mapTiles.ts`_
- [ ] 2. Attribution: `attributionText('paper_chart')` returns `© NOAA Office of Coast Survey · Not
  for navigation`; the three existing strings are untouched.
  _Requirements: 6.1_
  _Files: `frontend/src/components/mapTiles.ts`, `frontend/src/components/mapTiles.test.ts`_
- [ ] 3. Type and parser: `MapTileLayer` gains `paper_chart`; `TILE_LAYER_IDS` accepts it and still
  falls back to `osm_dark`.
  _Requirements: 1.1, 1.2_
  _Files: `frontend/src/types.ts`, `frontend/src/hooks/useSettings.ts`, `frontend/src/hooks/useSettings.test.ts`_
- [ ] 4. Server-key guard: `applyServerConfig` does not override a stored `paper_chart` choice.
  _Requirements: 1.3_
  _Files: `frontend/src/hooks/useSettings.ts`, `frontend/src/hooks/useSettings.test.ts`_
- [ ] 5. Mount: with `paper_chart` selected, add an `osm_dark` substrate and the clipped chart in
  `CHART_PANE` (205, `pointer-events: none`) with `bounds` and `minZoom` from the constants; remove
  both when another value is chosen. `chartBase` drives the wrapper class, the halo props and the
  gradient opacity.
  _Requirements: 2.2, 2.4, 2.5, 2.7, 5.1, 5.3, 5.4_
  _Files: `frontend/src/components/MapView.tsx`_
- [ ] 6. Coverage chip: a `chartInView` state from `moveend`/`zoomend` plus the initial view, showing
  `NOAA_COVERAGE_NOTICE` only while the chart is selected and not painting.
  _Requirements: 4.2, 4.4, 4.5_
  _Files: `frontend/src/components/MapView.tsx`_
- [ ] 7. Test double: `frontend/src/test/leafletMock.ts` gains `tileLayer.wms` (capturing `url` and
  `options` like `tileLayer`) and a way to tell which constructor a layer came from, plus a working
  `createPane`/`getPane` pair so the 205 pane can be asserted.
  _Requirements: 2.2, 2.4, 2.5_
  _Files: `frontend/src/test/leafletMock.ts`_
- [ ] 8. Map Settings: fourth radio "Nautical Paper Chart" with the keyless badge, the NOAA credit,
  `Not for navigation`, the coverage note, the CARTO caption and `data-testid="tile-layer-paper-chart"`.
  _Requirements: 3.1-3.4_
  _Files: `frontend/src/components/MapSettingsModal.tsx`, `frontend/src/components/MapSettingsModal.test.tsx`_
- [ ] 9. Contrast pass: the `.chart-base .wind-barb-halo` rule, the dark selected-barb ring on a
  light base, the chevron under-stroke behind a `halo` option (default off, output unchanged), and
  the gradient opacity prop with `WIND_COLOR_OPACITY_ON_LIGHT_BASE`, plus the "recommended off"
  caption in Map Settings.
  _Requirements: 5.1-5.4, 5.6_
  _Files: `frontend/src/index.css`, `frontend/src/components/WindOverlay.tsx`,
  `frontend/src/components/WindColorOverlay.tsx`, `frontend/src/components/WaterCurrentChevron.tsx`,
  `frontend/src/components/CurrentOverlay.tsx`, `frontend/src/components/MapView.tsx`,
  `frontend/src/components/MapSettingsModal.tsx`_
- [ ] 10. Unit tests: config and attribution for every value; the parser round trip and the
  unknown-value fallback; the four radios and `onChangeTileLayer('paper_chart')`; substrate plus
  clipped chart and the constants reaching `bounds`/`minZoom`; the single-chart rule on re-selection;
  the chip appearing north of 49.6 N and below z12 and not otherwise; `chart-base` class; the footer
  credit; chevron halo on/off; gradient opacity per base.
  _Requirements: 1.1-1.3, 2.1-2.7, 3.1-3.4, 4.2-4.5, 5.3, 5.4, 6.1, 6.2_
  _Files: `frontend/src/components/mapTiles.test.ts`, `frontend/src/hooks/useSettings.test.ts`,
  `frontend/src/components/MapSettingsModal.test.tsx`, `frontend/src/components/MapView.test.tsx`,
  `frontend/src/utils/mapExport.test.ts`, `frontend/src/components/WindColorOverlay.test.tsx`,
  `frontend/src/components/WaterCurrentChevron.test.ts`_
- [ ] 11. Project docs: base-map list with both light styles, the setting, the clip and zoom floor,
  the coverage rule, the export attribution and the contrast decisions.
  _Requirements: 7.1_
  _Files: `requirements.md`_
- [ ] 12. Manual verification with barbs, chevrons and the gradient on: Oak Harbor z10-z18, San
  Francisco z14 and Victoria z12 (inside the clip); Vancouver z12, inland Snoqualmie and an offshore
  view (clip reveals the dark base with the chip); one PNG and one PDF export; screenshots kept.
  _Requirements: acceptance criteria_
- [ ] 13. **Seamap (5-point slice):** `MapTileLayer` gains `seamap`, the parser accepts it, and
  `tileLayerConfig` returns the style URL with `maxZoom: 19` and the Seamap + OSM attribution;
  `attributionText('seamap')` covers both credits.
  _Requirements: 8.1, 8.4_
  _Files: `frontend/src/types.ts`, `frontend/src/hooks/useSettings.ts`,
  `frontend/src/components/mapTiles.ts`_
- [ ] 14. **Seamap mount:** lazy `maplibre-gl` + `@maplibre/maplibre-gl-leaflet` import behind the
  first selection, `L.maplibreGL` in `CHART_PANE` with `interactive: false` and
  `canvasContextAttributes: { preserveDrawingBuffer: true }`, removed cleanly on switch.
  _Requirements: 8.2, 8.3_
  _Files: `frontend/src/components/MapView.tsx`_
- [ ] 15. **Seamap zoom check:** verify upscaling at z15-z19 against maxzoom 14; if it degrades, keep
  `osm_dark` beneath and cut Seamap in at z14 and below, and record which was chosen.
  _Requirements: 8.3_
- [ ] 16. **Seamap capture:** `captureDom.includeInCapture` keeps the GL container, `waitForTiles` does
  not stall on it, and a PNG export contains the vector layer.
  _Requirements: 8.5_
  _Files: `frontend/src/utils/captureDom.ts`, `frontend/src/utils/captureDom.test.ts`_
- [ ] 17. **Seamap UI:** fifth radio with the licence split (CC-BY 4.0 tiles, ODbL OSM-derived layers),
  the navigation-aid wording, the gradient-off recommendation, and tests for all of it.
  _Requirements: 8.6, 8.7_
  _Files: `frontend/src/components/MapSettingsModal.tsx`, `frontend/src/components/MapSettingsModal.test.tsx`_
- [ ] 18. Run the `ci-checks` skill (frontend lint, typecheck, coverage, build), open the PR into
  `develop`, merge when green, comment the merge hash on SCRUM-203, delete the branch and rebuild
  the container.
  _Requirements: acceptance criteria_
