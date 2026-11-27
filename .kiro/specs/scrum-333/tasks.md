# SCRUM-333 — Tasks

- [x] `types.ts`: two ids back in `MapTileLayer`.
- [x] `mapTiles.ts`: names, `OSM_TILE_URL`, attribution, the dark filter, the note and reason,
      `isOsmLayer` / `osmRangeExportBlockedReason`, light-sheet membership for `osm_standard`.
- [x] `useSettings.ts`: parser accepts both ids; the retired-id set is gone.
- [x] `MapSettingsModal.tsx`: two rows after CARTO with the credit and the note.
- [x] `ExportModeField` / `MapExportDialog` / `App`: `rangeDisabledReason`, Range disabled with its
      reason, fallback to view.
- [x] Tests: new `mapTilesOsm.test.ts` (URL, filter, names, credit, light sheet, blocked reason);
      settings parser; the two settings rows; the dialog's disabled Range, note and fallback.
- [x] `requirements.md`: the restored bases, the permitted-use argument, the copy and the restriction.
