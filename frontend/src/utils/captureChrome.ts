/**
 * The chrome drawn around the captured map: header, legend and footer (SCRUM-178, extracted from
 * `captureMap.ts`). Everything here is pure canvas drawing, so the image text stays crisp and the
 * layout does not depend on the on-screen chrome.
 */
import type { BarbLegendEntry, ExportHeader, TemperatureBand } from './mapExport';
import { barbFeatures } from './windBarb';
import type { WindColorScale } from './windColorScale';

export interface CaptureContent {
  fileName: string;
  header: ExportHeader;
  footer: string;
  barbs: BarbLegendEntry[];
  temperatures: TemperatureBand[];
  speedUnitLabel: string;
  temperatureUnitLabel: string;
  /** Set when the wind colour gradient is on: replaces the temperature bands (SCRUM-165). */
  windColorScale?: WindColorScale;
}

const BACKGROUND = '#0d1117';
const STRIP = '#161b22';
const TEXT = '#f3f4f6';
const MUTED = '#9ca3af';
const RULE = '#30363d';

/** CSS-pixel heights of the chrome drawn around the map, scaled with the capture. */
export const HEADER_PX = 74;
export const LEGEND_PX = 78;
export const FOOTER_PX = 30;
const PADDING = 14;

/** The background the whole composed image sits on. */
export const CAPTURE_BACKGROUND = BACKGROUND;

/** Draw one barb glyph, using the same feathers as the map (see `barbFeatures`). */
export function drawBarb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  speedKnots: number,
  color = TEXT,
): void {
  const { calm, pennants, fullBarbs, halfBarbs } = barbFeatures(speedKnots);
  const half = size / 2;
  const base = y + half;
  const top = y - half;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size / 16);

  if (calm) {
    ctx.beginPath();
    ctx.arc(x, y, size / 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, size / 7, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Staff, with the feathers pointing to the right and stacking down from the top.
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, top);
  ctx.stroke();

  const feather = size / 3;
  let cursor = top;
  const gap = size / 5;
  for (let i = 0; i < pennants; i++) {
    ctx.beginPath();
    ctx.moveTo(x, cursor);
    ctx.lineTo(x + feather, cursor + gap / 2);
    ctx.lineTo(x, cursor + gap);
    ctx.closePath();
    ctx.fill();
    cursor += gap;
  }
  for (let i = 0; i < fullBarbs; i++) {
    ctx.beginPath();
    ctx.moveTo(x, cursor);
    ctx.lineTo(x + feather, cursor - gap / 2);
    ctx.stroke();
    cursor += gap;
  }
  if (halfBarbs) {
    ctx.beginPath();
    ctx.moveTo(x, cursor);
    ctx.lineTo(x + feather / 2, cursor - gap / 4);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, base, Math.max(1.5, size / 12), 0, Math.PI * 2);
  ctx.fill();
}

/** Fill `text` at `px`, shrinking the font until it fits `maxWidth`. */
export function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  px: number,
  weight = 'normal',
): void {
  let size = px;
  for (;;) {
    ctx.font = `${weight} ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth || size <= 7) break;
    size -= 0.5;
  }
  ctx.fillText(text, x, y);
}

export function drawHeader(
  ctx: CanvasRenderingContext2D,
  header: ExportHeader,
  width: number,
  unit: number,
): void {
  const pad = PADDING * unit;
  ctx.fillStyle = TEXT;
  drawFittedText(ctx, header.title, pad, 26 * unit, width - pad * 2, 15 * unit, 'bold');
  ctx.fillStyle = MUTED;
  header.lines.forEach((line, index) => {
    drawFittedText(ctx, line, pad, (44 + index * 15) * unit, width - pad * 2, 10 * unit);
  });
}

export function drawLegend(
  ctx: CanvasRenderingContext2D,
  content: CaptureContent,
  top: number,
  width: number,
  unit: number,
): void {
  const pad = PADDING * unit;
  ctx.fillStyle = STRIP;
  ctx.fillRect(0, top, width, LEGEND_PX * unit);
  ctx.fillStyle = RULE;
  ctx.fillRect(0, top, width, Math.max(1, unit));

  ctx.fillStyle = MUTED;
  ctx.font = `normal ${8.5 * unit}px sans-serif`;
  const scale = content.windColorScale;
  const barbTitle = scale
    ? `Wind barbs (${content.speedUnitLabel}) · colour = temperature (${content.temperatureUnitLabel})`
    : `Wind barbs (${content.speedUnitLabel})`;
  ctx.fillText(barbTitle, pad, top + 12 * unit);
  // Six examples (SCRUM-240) leave far less room per entry than four did. Measure the captions
  // first and take any narrow-width squeeze from the glyph and its gap, never from the caption.
  const glyphRoom = 26 * unit;
  const gap = 6 * unit;
  const captionWidths = content.barbs.map((entry) => ctx.measureText(entry.caption).width);
  const captionsWidth = captionWidths.reduce((sum, w) => sum + w, 0);
  const perEntry = (width - pad * 2 - captionsWidth) / content.barbs.length;
  const glyphSize = Math.max(12 * unit, Math.min(glyphRoom, perEntry - gap));
  let x = pad;
  content.barbs.forEach((entry, index) => {
    drawBarb(ctx, x + glyphSize / 2, top + 30 * unit, glyphSize, entry.knots);
    ctx.fillStyle = TEXT;
    ctx.font = `normal ${8.5 * unit}px sans-serif`;
    ctx.fillText(entry.caption, x + glyphSize + gap / 2, top + 34 * unit);
    x += glyphSize + gap + captionWidths[index];
  });

  if (scale) {
    // Same stops and tick labels as the on-screen strip, drawn as a canvas gradient. The export
    // always labels every tick; only the narrow screen strip drops some (SCRUM-165).
    const unitGap = 26 * unit;
    const barWidth = Math.max(1, width - pad * 2 - unitGap);
    const barY = top + 54 * unit;
    const barHeight = 10 * unit;
    const gradient = ctx.createLinearGradient(pad, barY, pad + barWidth, barY);
    for (const stop of scale.stops) gradient.addColorStop(stop.offset, stop.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(pad, barY, barWidth, barHeight);

    ctx.fillStyle = TEXT;
    ctx.font = `normal ${7.5 * unit}px sans-serif`;
    scale.ticks.forEach((tick, index) => {
      const x = pad + tick.offset * barWidth;
      const labelWidth = ctx.measureText(tick.label).width;
      const drawX =
        index === 0 ? x : index === scale.ticks.length - 1 ? x - labelWidth : x - labelWidth / 2;
      ctx.fillText(tick.label, drawX, top + 75 * unit);
    });
    ctx.fillStyle = MUTED;
    ctx.fillText(scale.unitLabel, pad + barWidth + 6 * unit, barY + 9 * unit);
    return;
  }

  ctx.fillStyle = MUTED;
  ctx.font = `normal ${8.5 * unit}px sans-serif`;
  ctx.fillText(`Temperature (${content.temperatureUnitLabel})`, pad, top + 56 * unit);
  const swatchWidth = Math.min(30 * unit, (width - pad * 2) / content.temperatures.length - 6 * unit);
  const captionWidth = (width - pad * 2) / content.temperatures.length;
  content.temperatures.forEach((band, index) => {
    const x = pad + captionWidth * index;
    ctx.fillStyle = band.color;
    ctx.fillRect(x, top + 62 * unit, swatchWidth, 8 * unit);
    ctx.fillStyle = TEXT;
    ctx.font = `normal ${7.5 * unit}px sans-serif`;
    ctx.fillText(band.caption, x, top + 76 * unit);
  });
}

export function drawFooter(
  ctx: CanvasRenderingContext2D,
  footer: string,
  top: number,
  width: number,
  unit: number,
): void {
  const pad = PADDING * unit;
  ctx.fillStyle = RULE;
  ctx.fillRect(0, top, width, Math.max(1, unit));
  ctx.fillStyle = MUTED;
  drawFittedText(ctx, footer, pad, top + 19 * unit, width - pad * 2, 9 * unit);
}

/** The hairline above the header band, keeping the bands visually separate on paper. */
export function drawRules(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  headerHeight: number,
  unit: number,
): void {
  ctx.fillStyle = RULE;
  ctx.fillRect(0, headerHeight - Math.max(1, unit), canvasWidth, Math.max(1, unit));
}
