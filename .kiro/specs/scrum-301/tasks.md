# SCRUM-301 — Tasks

- [x] 1. Retire the two OpenStreetMap bases from the type and the table
  - Remove `osm_dark` and `osm_standard` from `MapTileLayer`, `TILE_LAYER_NAMES`,
    `tileLayerConfig` (both `case`s and the overload) and `LIGHT_TILE_LAYERS`; drop `OSM_URL`.
  - `attributionText` credits CARTO by default.
  - _Requirements: 1.1, 2.1, 3.1_
  - _Files: `frontend/src/types.ts`, `frontend/src/components/mapTiles.ts`_

- [x] 2. Move the default and migrate stored values
  - `parseTileLayer` returns `carto_dark` for an unknown value and translates the two retired ids.
  - `TILE_LAYER_IDS` loses both ids.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Files: `frontend/src/hooks/useSettings.ts`_

- [x] 3. Move the three substrates to CARTO
  - The paper-chart, Seamap and Google Satellite branches call
    `tileLayerConfig('carto_dark', cartoApiKey)`.
  - _Requirements: 2.3, 4.1_
  - _Files: `frontend/src/hooks/useBaseLayers.ts`_

- [x] 4. Remove the two radios from Map Settings
  - Delete the OpenStreetMap rows and their info panels; CARTO stays first and selected by default.
  - _Requirements: 2.2, 4.2_
  - _Files: `frontend/src/components/MapSettingsModal.tsx`_

- [x] 5. Tests
  - `mapTiles.test.ts`: table, attribution, and a sweep asserting no config URL names
    `tile.openstreetmap.org`.
  - `useSettings.test.ts`: default and retired-id migration.
  - `MapSettingsModal.test.tsx`: the remaining radios, their order and the theme per base.
  - `MapView.test.tsx`: the substrate assertions and the base-switch cases.
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.2, 4.2_

- [x] 6. Record the provider in `requirements.md`
  - The map-data section names CARTO, its terms URL, the free-tier limits, the attribution line and
    the removal of the OpenStreetMap bases with its settings migration.
  - Correct the older bullets that still describe an `osm_dark` fallback or a keyless `osm_dark`
    substrate.
  - _Requirements: 3.3_

- [x] 7. Verification
  - `ruff check .`, `ruff format --check .`, `pytest --cov`, `npm run lint`, `npm run typecheck`,
    `npm run test:coverage` (see the `ci-checks` skill), and the container rebuild.
