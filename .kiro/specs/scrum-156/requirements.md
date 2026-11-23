# SCRUM-156 range output requirements

## User stories

### 1. Choose a range output format

WHEN the user is in Range mode THEN the system shall offer PNG, JPEG and PDF.
WHEN PDF is chosen THEN the system shall offer Letter or A4 and portrait or landscape, and apply them to every page.
WHEN any range format is chosen THEN the system shall keep the SCRUM-155 summary line and the 24-capture limit.

### 2. PNG or JPEG over a range

WHEN a range longer than one hour finishes as PNG or JPEG THEN the system shall download one ZIP containing exactly one image per hour, each named by its own hour with `buildExportFileName`.
WHEN a range resolves to exactly one hour THEN the system shall download that single image directly, with no ZIP.
WHEN building the ZIP THEN the system shall use `fflate` (jsPDF's own dependency), imported lazily, and store the already-compressed images without adding another package.

### 3. PDF over a range

WHEN a range finishes as PDF THEN the system shall download one file with exactly one page per hour.
WHEN adding a page after the first THEN the system shall call `addPage()` before `addImage()`.
WHEN placing a page image THEN the system shall reuse `fitToPage` so margins and aspect ratio match the single-page PDF, and re-encode the canvas as JPEG at about quality 0.9.
WHEN the range is 24 hours THEN the system shall stay inside the 24-capture limit and keep every page image in memory until `save()`.

### 4. Cancel and failure

WHEN the user cancels a range THEN the system shall download no partial ZIP or PDF.
WHEN a range fails THEN the system shall name the failing hour and offer the frames captured so far as a ZIP (a single image when only one frame exists).

### 5. Quality and docs

WHEN the range output changes THEN the ZIP entry count and names, the single-hour bypass, the PDF page count, `addPage` ordering, page size/orientation, `fitToPage` reuse, the saved names, and the cancel/error behaviour shall be unit tested with `fflate` and jsPDF mocked.
WHEN the feature ships THEN `requirements.md` and `README.md` shall describe the range formats, ZIP contents and PDF pagination, and `npm audit --omit=dev` shall stay clean with both libraries in lazy chunks.
