# SCRUM-155 Export range requirements

## User stories

### 1. Choose a range

WHEN the user opens the export dialog THEN the system shall offer a mode switch between "Current view" (the single-view export from SCRUM-117) and "Range".
WHEN the user picks Range THEN the system shall offer a start hour, an end hour and an interval of 1, 2, 3, 6 or 12 hours.
WHEN the range controls are shown THEN the system shall list only hours inside the selected model's forecast window (the current hour through `now + horizon_hours`), hour-aligned, using the selected timezone for their labels.

### 2. Validate before capturing

WHEN the range is valid THEN the system shall show a summary such as "5 captures from Thu 14:00 to Thu 18:00 PST".
WHEN the start is not before the end, an hour is not aligned, an hour falls outside the forecast window, or the range needs more than 24 captures THEN the system shall show a clear message, keep Export disabled, and start no capture.
WHEN the end hour falls on an interval step THEN the system shall include it; when it does not THEN the last captured hour shall be the last step at or before the end.

### 3. Capture one frame per hour

WHEN a valid range is exported THEN the system shall set the map to each hour in turn, wait for that hour's grid data and for the base-map tiles, and capture exactly one frame per hour.
WHEN an hour's data does not arrive within the deadline THEN the system shall stop and report an error that names that hour.
WHEN the capture finishes, is cancelled or fails THEN the system shall restore the forecast hour, map view and overlay settings that were showing before the export.

### 4. Progress, cancel and failures

WHILE a range export runs THEN the system shall show "n of N" progress with the hour being captured and a Cancel button.
WHEN the user cancels THEN the system shall stop after the frame in progress, download nothing, and leave the dialog open.
WHEN the export fails THEN the system shall name the failing hour and offer to save the frames captured so far; no file shall download automatically.

### 5. Interim output

WHEN a range export completes with the built-in sink (before SCRUM-156) THEN the system shall download each frame separately, named after its own hour, and document that browsers may ask to allow multiple downloads.
WHEN the range mode is used THEN the format choices shall be PNG and JPEG only; ZIP and multi-page PDF belong to SCRUM-156.

### 6. Quality

WHEN the range code changes THEN `timeRangeHours` shall be unit tested for hour alignment, end inclusion, intervals that do not divide the range, daylight-saving changes and window limits, and the dialog and loop shall be tested for one capture per hour, progress, cancel and error, and state restoration.
