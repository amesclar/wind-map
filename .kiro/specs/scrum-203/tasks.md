# SCRUM-203 tasks

Branch: `feature/SCRUM-203-paper-chart-mode`, from `develop`. Confirm SCRUM-200's two inherited
decisions (NONNA under the chart, seamark independence) before task 1; the NOAA-only scope below
does not depend on them.

- [ ] 1. Tile table: `TileLayerConfig` becomes an `xyz`/`wms` union, the NOAA constants land, and
  `tileLayerConfig('paper_chart')` returns the WMS config (layers 1-12, `image/png`, version
  `1.1.1`, `crs: L.CRS.EPSG3857`, `crossOrigin`, `maxZoom: 19`, `CHART_TILE_CLASS`).
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
- [ ] 5. Mount: `MapView` builds a WMS layer with `L.tileLayer.wms` and an XYZ layer otherwise, in
  the existing single-base-layer effect; `chartBase` drives the wrapper class, the halo props, the
  gradient opacity and the coverage notice chip.
  _Requirements: 2.2, 2.4, 2.5, 4.2, 5.1, 5.3, 5.4_
  _Files: `frontend/src/components/MapView.tsx`_
- [ ] 6. Test double: `frontend/src/test/leafletMock.ts` gains `tileLayer.wms` (same captured
  `url`/`options` shape as `tileLayer`) and a way to see which constructor was used.
  _Requirements: 2.2, 2.4_
  _Files: `frontend/src/test/leafletMock.ts`_
- [ ] 7. Map Settings: fourth radio "Nautical Paper Chart" with the keyless badge, the NOAA credit,
  `Not for navigation`, the coverage note, the CARTO caption and `data-testid="tile-layer-paper-chart"`.
  _Requirements: 3.1-3.4_
  _Files: `frontend/src/components/MapSettingsModal.tsx`, `frontend/src/components/MapSettingsModal.test.tsx`_
- [ ] 8. Contrast pass: the `.chart-base .wind-barb-halo` rule, the dark selected-barb ring on a
  light base, the chevron under-stroke behind a `halo` option (default off, output unchanged), and
  the gradient opacity prop with `WIND_COLOR_OPACITY_ON_CHART`.
  _Requirements: 5.1-5.4, 5.6_
  _Files: `frontend/src/index.css`, `frontend/src/components/WindOverlay.tsx`,
  `frontend/src/components/WindColorOverlay.tsx`, `frontend/src/components/WaterCurrentChevron.tsx`,
  `frontend/src/components/CurrentOverlay.tsx`, `frontend/src/components/MapView.tsx`_
- [ ] 9. Unit tests: config and attribution for all four values; the parser round trip and the
  unknown-value fallback; the four radios and the new `onChangeTileLayer('paper_chart')`; the WMS
  mount, the single-base-layer rule and the no-OSM-under-the-chart rule; `chart-base` class and
  notice presence; the footer credit; chevron halo on/off; gradient opacity per base.
  _Requirements: 1.1-1.3, 2.1-2.4, 3.1-3.4, 4.2, 5.3, 5.4, 6.1, 6.2_
  _Files: `frontend/src/components/mapTiles.test.ts`, `frontend/src/hooks/useSettings.test.ts`,
  `frontend/src/components/MapSettingsModal.test.tsx`, `frontend/src/components/MapView.test.tsx`,
  `frontend/src/utils/mapExport.test.ts`, `frontend/src/components/WindColorOverlay.test.tsx`,
  `frontend/src/components/WaterCurrentChevron.test.ts`_
- [ ] 10. Project docs: base-map list, the new setting, the coverage rule, the export attribution and
  the contrast decisions.
  _Requirements: 7.1_
  _Files: `requirements.md`_
- [ ] 11. Manual verification with barbs, chevrons and the gradient on: Oak Harbor z10-z18, San
  Francisco z14 and Victoria z12 (covered); Vancouver z12, inland Snoqualmie and one offshore view
  (blank paper plus the notice); one PNG and one PDF export; screenshots kept as evidence.
  _Requirements: acceptance criteria_
- [ ] 12. Run the `ci-checks` skill (frontend lint, typecheck, coverage, build), open the PR into
  `develop`, merge when green, comment the merge hash on SCRUM-203, delete the branch and rebuild
  the container.
  _Requirements: acceptance criteria_
