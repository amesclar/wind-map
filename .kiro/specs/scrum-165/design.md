# SCRUM-165 export legend design

## Shared scale

- `utils/windColorScale.ts` owns `COLOR_STOPS`, `MAX_WIND_KNOTS`, `legendTicks` (moved from the component), `buildWindColorScale(unit)` and `WindColorScale`.
- `buildWindColorScale` returns `{ stops: {offset, color}[], ticks: {offset, label}[], unitLabel }`, with offsets as `knots / MAX_WIND_KNOTS` and `value / maxUnit` respectively. The on-screen strip keeps using `legendTicks` + `windColorCssGradient()`; the export uses the same helper's stops and ticks, so there is no second palette.
- `WindColorLegend.tsx` re-exports `legendTicks` so existing imports and tests are unchanged.

## Capture content

`CaptureContent` gains optional `windColorScale?: WindColorScale`. `App.buildContent` sets it from `mapSettings.windColorOverlayVisible` and the selected speed unit. `captureMap.ts` remains pure and testable.

## Canvas legend

- Gradient on: title/caption line at the same y as before; barb glyph row unchanged but its caption includes `colour = temperature (°F/°C)`; below it a horizontal `createLinearGradient` bar from the passed stops, tick captions at their offsets, and the unit label at the bar's right. No temperature caption, swatches or bands.
- Gradient off: the existing barb row + `Temperature (<unit>)` caption and swatches, unchanged.
- `LEGEND_PX` (78) stays; the gradient bar sits at 54 px and tick labels at 75 px, inside the strip.

## Tests

- `windColorScale.test.ts`: moved `legendTicks` behaviour and the four-unit sync guard against `COLOR_STOPS`.
- `captureMap.test.ts`: gradient-on draws a gradient bar with one stop per colour, tick captions and the barb caption, and no temperature row; gradient-off keeps the temperature row and draws no gradient.
- `WindColorLegend.test.tsx` keeps its rendering assertions through the re-export.
