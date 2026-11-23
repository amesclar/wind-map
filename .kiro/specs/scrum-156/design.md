# SCRUM-156 range output design

## Overview

SCRUM-155 captures a range into `{ time, canvas }` frames and currently downloads each frame separately. This ticket turns that sink into two real outputs: one ZIP of per-hour images for PNG/JPEG, or one multi-page PDF for PDF. The capture loop, progress, cancel and restoration are untouched.

## Architecture

- `frontend/src/utils/rangeOutput.ts`
  - `canvasToBlob(canvas, mime, quality?)` and `saveRangeImages(frames, options)`: encode each canvas in the chosen format, name it with `buildExportFileName`, and either download it directly (one hour) or pack all entries with a lazily imported `fflate` `zipSync` into one ZIP.
  - `saveRangePdf(frames, options)`: lazily import `jspdf`, create the document with `pageBox(size, orientation)`, and for each frame call `addPage()` after the first, `fitToPage(...)`, then `addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', x, y, w, h)`; finally `save()`.
  - Both use `downloadBlob`, extracted from `downloadCanvas` in `captureMap.ts`.
- `frontend/src/utils/mapExport.ts`: `buildRangeArchiveName({ modelId, hours, timezone, extension })` returns `<model>_<first hour>_<n>hours.<zip|pdf>`, so archives also lead with the model (SCRUM-163).
- `frontend/src/components/MapExportDialog.tsx`: Range formats become PNG, JPEG and PDF; the page-size/orientation controls show whenever PDF is selected (view or range), and range options carry them.
- `frontend/src/App.tsx`: after a completed loop, route to `saveRangePdf` for PDF and `saveRangeImages` otherwise; keep the frames in state, and make "Save captured frames" build a ZIP (or single image) with the chosen image format (PDF failures fall back to PNG frames).

## Decisions

- **ZIP library**: `fflate` is already installed as jsPDF's dependency (0.8.3); it is imported dynamically inside the ZIP path only, so no new package and no main-bundle growth.
- **Compression**: images are already compressed, so `zipSync(entries, { level: 0 })` stores them (fast, no benefit from deflate).
- **Single-hour ranges**: one image downloads directly; a one-page PDF still comes as a PDF.
- **Archive names**: model-led, with the first hour and the frame count, e.g. `best_match_2026-11-23_1200PST_5hours.zip`, `ecmwf_ifs_2026-11-23_1200PST_5hours.pdf`.
- **Memory**: page images are re-encoded as data URLs one at a time inside the PDF document; the 24-capture cap bounds the total.

## Correctness properties

1. A completed range with more than one frame produces exactly one download (ZIP or PDF), never one per frame. (Requirements 2, 3)
2. Every ZIP entry and every PDF page corresponds to one captured hour, in order, named/shown by that hour. (Requirements 2, 3)
3. Cancel and failure produce no partial ZIP or PDF; failure keeps the frames for the recovery ZIP. (Requirement 4)
4. `fitToPage` and the page size/orientation options decide each PDF page's placement. (Requirement 3)

## Edge cases

- One hour: direct image download; one-page PDF.
- Cross-day ranges: the archive name uses the first hour and the frame count, so it stays unambiguous.
- An empty frame list (defensive) downloads nothing.
- `toBlob` returning null throws and is reported by the range error path.
