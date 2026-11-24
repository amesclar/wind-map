import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWindColorScale, COLOR_STOPS } from './windColorScale';
import { captureMapCanvas, saveMapImage } from './captureMap';
import { collectTiles, DARK_TILE_FILTER, drawTiles, includeInCapture, pendingTiles, waitForTiles } from './captureDom';
import {
  drawBarb,
  drawFittedText,
  FOOTER_PX,
  HEADER_PX,
  LEGEND_PX,
  type CaptureContent,
} from './captureChrome';
import { DEFAULT_JPEG_QUALITY } from './download';

function fakeContext() {
  return {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    globalAlpha: 1,
    filter: 'none',
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}

let ctx: ReturnType<typeof fakeContext>;
let mapCanvas: HTMLCanvasElement;

const content: CaptureContent = {
  fileName: 'wind-map_2026-11-18_1400PST.png',
  header: { title: 'Wind Map · Wed 18 Nov 14:00 PST', lines: ['Forecast hour · Wed 18 Nov 14:00 PST', 'Model: NOAA GFS · Run: Wed 18 Nov 12:00 UTC'] },
  footer: 'Units: kt, °F · © OpenStreetMap contributors · Wind Map v0.7.0',
  barbs: [
    { knots: 0, caption: 'calm' },
    { knots: 5, caption: '5 kt' },
    { knots: 10, caption: '10 kt' },
    { knots: 50, caption: '50 kt' },
  ],
  temperatures: [
    { color: '#60a5fa', caption: '≤ 32°F' },
    { color: '#ef4444', caption: '> 90°F' },
  ],
  speedUnitLabel: 'kt',
  temperatureUnitLabel: '°F',
};

beforeEach(() => {
  ctx = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  mapCanvas = { width: 800, height: 600 } as HTMLCanvasElement;
  (HTMLCanvasElement.prototype as unknown as { toBlob: unknown }).toBlob = vi.fn((callback: BlobCallback) =>
    callback(new Blob(['image'], { type: 'image/png' })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:map');
  URL.revokeObjectURL = vi.fn();
});

describe('includeInCapture (SCRUM-116)', () => {
  it('leaves Leaflet controls and pop-ups out of the image', () => {
    const control = document.createElement('div');
    control.className = 'leaflet-control leaflet-control-container';
    const popup = document.createElement('div');
    popup.className = 'leaflet-popup';
    const pane = document.createElement('div');
    pane.className = 'leaflet-pane';
    expect(includeInCapture(control)).toBe(false);
    expect(includeInCapture(popup)).toBe(false);
    expect(includeInCapture(pane)).toBe(true);
    expect(includeInCapture(document.createElement('svg'))).toBe(true);
  });

  it('leaves base-map tiles out too, so the library never waits on them', () => {
    const tile = document.createElement('img');
    tile.className = 'leaflet-tile leaflet-tile-loaded';
    expect(includeInCapture(tile)).toBe(false);
  });
});

describe('tiles (SCRUM-116)', () => {
  it('collects the on-screen tiles with their position in the container', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const tile = document.createElement('img');
    tile.className = 'leaflet-tile';
    Object.defineProperty(tile, 'complete', { value: true });
    Object.defineProperty(tile, 'naturalWidth', { value: 256 });
    tile.getBoundingClientRect = () => ({ left: 12, top: 8, width: 256, height: 256 }) as DOMRect;
    container.appendChild(tile);

    expect(collectTiles(container)).toEqual([
      expect.objectContaining({ image: tile, x: 12, y: 8, width: 256, height: 256, dark: false }),
    ]);
  });

  it('reports the tiles still loading so a capture can wait for them', () => {
    const container = document.createElement('div');
    const loading = document.createElement('img');
    loading.className = 'leaflet-tile';
    const loaded = document.createElement('img');
    loaded.className = 'leaflet-tile leaflet-tile-loaded';
    container.append(loading, loaded);
    expect(pendingTiles(container)).toBe(1);
    loading.classList.add('leaflet-tile-loaded');
    expect(pendingTiles(container)).toBe(0);
  });

  it('resolves the tile wait at its deadline instead of hanging', async () => {
    const container = document.createElement('div');
    const started = Date.now();
    await waitForTiles(container, 150);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('draws tiles at the capture scale and applies the dark filter where the layer has it', () => {
    const image = document.createElement('img');
    drawTiles(ctx as unknown as CanvasRenderingContext2D, [
      { image, x: 10, y: 20, width: 256, height: 256, dark: true },
    ], 2);
    expect(ctx.filter).toBe(DARK_TILE_FILTER);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 20, 40, 512, 512);
    expect(ctx.restore).toHaveBeenCalled();
  });
});

describe('captureMapCanvas (SCRUM-116)', () => {
  it('captures at 2x and composes the header, legend and footer around the map', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue(mapCanvas);

    const canvas = await captureMapCanvas(element, content, { domToCanvas, tileTimeoutMs: 0 });

    expect(domToCanvas).toHaveBeenCalledTimes(1);
    const options = domToCanvas.mock.calls[0][1];
    expect(options.scale).toBe(2);
    expect((options.filter as (node: Node) => boolean)(element)).toBe(true);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600 + (HEADER_PX + LEGEND_PX + FOOTER_PX) * 2);
    expect(options.backgroundColor).toBeNull();
    // The overlay lands on the map canvas, which then lands under the header.
    expect(ctx.drawImage).toHaveBeenCalledWith(mapCanvas, 0, 0);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
      0,
      HEADER_PX * 2,
    );

    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts).toContain(content.header.title);
    expect(texts).toContain(content.header.lines[1]);
    expect(texts).toContain('Wind barbs (kt)');
    expect(texts).toContain('5 kt');
    expect(texts).toContain(content.footer);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('draws the shared wind speed scale and barb caption when the gradient is on (SCRUM-165)', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue(mapCanvas);
    const scale = buildWindColorScale('mph');

    await captureMapCanvas(
      element,
      { ...content, windColorScale: scale, speedUnitLabel: 'mph', temperatureUnitLabel: '°C' },
      { domToCanvas, tileTimeoutMs: 0 },
    );

    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts).toContain('Wind barbs (mph) · colour = temperature (°C)');
    expect(texts).not.toContain('Temperature (°C)');
    for (const tick of scale.ticks) expect(texts).toContain(tick.label);

    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(1);
    const gradient = ctx.createLinearGradient.mock.results[0].value as { addColorStop: ReturnType<typeof vi.fn> };
    expect(gradient.addColorStop).toHaveBeenCalledTimes(COLOR_STOPS.length);
    for (const stop of scale.stops) {
      expect(gradient.addColorStop).toHaveBeenCalledWith(stop.offset, stop.color);
    }
  });

  it('keeps the barb and temperature rows when the gradient is off (SCRUM-165)', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue(mapCanvas);

    await captureMapCanvas(element, content, { domToCanvas, tileTimeoutMs: 0 });

    const texts = ctx.fillText.mock.calls.map((call) => call[0] as string);
    expect(texts).toContain('Wind barbs (kt)');
    expect(texts).toContain('Temperature (°F)');
    expect(texts.some((text) => text.includes('colour = temperature'))).toBe(false);
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
  });

  it('draws calm circles and feathered barbs', () => {
    drawBarb(ctx as unknown as CanvasRenderingContext2D, 10, 10, 24, 0);
    expect(ctx.arc).toHaveBeenCalledTimes(2);

    drawBarb(ctx as unknown as CanvasRenderingContext2D, 10, 10, 24, 50);
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('shrinks long text until it fits', () => {
    drawFittedText(ctx as unknown as CanvasRenderingContext2D, 'x'.repeat(200), 0, 10, 100, 12);
    const lastFont = ctx.font;
    const size = Number(lastFont.match(/(\d+(?:\.\d+)?)px/)?.[1]);
    expect(size).toBeLessThan(12);
    expect(size).toBeGreaterThanOrEqual(7);
  });
});

describe('saveMapImage (SCRUM-116)', () => {
  it('downloads the composed image with the file name', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue(mapCanvas);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await saveMapImage(element, content, { format: 'png' }, { domToCanvas, tileTimeoutMs: 0 });

    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click.mock.instances[0]).toBeInstanceOf(HTMLAnchorElement);
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(content.fileName);
    click.mockRestore();
  });

  it('fails cleanly when the canvas cannot be encoded', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue(mapCanvas);
    (HTMLCanvasElement.prototype as unknown as { toBlob: unknown }).toBlob = vi.fn((callback: BlobCallback) =>
      callback(null),
    );
    await expect(
      saveMapImage(element, content, { format: 'jpeg' }, { domToCanvas, tileTimeoutMs: 0 }),
    ).rejects.toThrow('could not be encoded');
  });

  it('encodes JPEG at the chosen quality, or at the default when none is given (SCRUM-117)', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue(mapCanvas);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const toBlob = HTMLCanvasElement.prototype.toBlob as unknown as ReturnType<typeof vi.fn>;

    await saveMapImage(element, content, { format: 'jpeg', quality: 0.8 }, { domToCanvas, tileTimeoutMs: 0 });
    expect(toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/jpeg', 0.8);

    await saveMapImage(element, content, { format: 'jpeg' }, { domToCanvas, tileTimeoutMs: 0 });
    expect(toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/jpeg', DEFAULT_JPEG_QUALITY);

    await saveMapImage(element, content, { format: 'png' }, { domToCanvas, tileTimeoutMs: 0 });
    expect(toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/png', undefined);
  });
});
