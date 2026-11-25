import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdf = vi.hoisted(() => ({ ctor: vi.fn(), addImage: vi.fn(), save: vi.fn() }));

vi.mock('jspdf', () => ({
  jsPDF: function MockJsPdf(options: unknown) {
    pdf.ctor(options);
    return { addImage: pdf.addImage, save: pdf.save };
  },
}));

import {
  fitToPage,
  loadJsPdf,
  pageBox,
  PDF_IMAGE_QUALITY,
  PDF_MARGIN_PT,
  PDF_PAGE_BOX,
  saveMapPdf,
} from './pdfExport';
import type { CaptureContent } from './captureChrome';

function fakeContext() {
  return {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    filter: 'none',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  };
}

const content: CaptureContent = {
  fileName: 'wind-map_2026-11-18_1400PST.pdf',
  header: { title: 'Wind Map · Wed 18 Nov 14:00 PST', lines: ['Forecast hour · Wed 18 Nov 14:00 PST'] },
  footer: 'Units: kt, °F · © OpenStreetMap contributors · Wind Map v0.7.0',
  barbs: [{ knots: 5, caption: '5 kt' }],
  temperatures: [{ color: '#60a5fa', caption: '≤ 32°F' }],
  speedUnitLabel: 'kt',
  temperatureUnitLabel: '°F',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext() as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
});

describe('pageBox (SCRUM-117)', () => {
  it('returns Letter and A4 in points, swapped for landscape', () => {
    expect(pageBox('letter', 'portrait')).toEqual({ width: 612, height: 792 });
    expect(pageBox('letter', 'landscape')).toEqual({ width: 792, height: 612 });
    expect(pageBox('a4', 'landscape')).toEqual({ width: PDF_PAGE_BOX.a4.height, height: PDF_PAGE_BOX.a4.width });
    expect(PDF_PAGE_BOX.a4.width).toBeCloseTo(595.28);
  });
});

describe('fitToPage (SCRUM-117)', () => {
  it('fits a wide image to the page width and centres it', () => {
    const placement = fitToPage(1200, 600, PDF_PAGE_BOX.letter);

    expect(placement.width).toBeCloseTo(612 - PDF_MARGIN_PT * 2);
    expect(placement.height).toBeCloseTo((612 - PDF_MARGIN_PT * 2) / 2);
    expect(placement.x).toBeCloseTo(PDF_MARGIN_PT);
    expect(placement.y).toBeCloseTo((792 - placement.height) / 2);
  });

  it('fits a tall image to the page height instead, keeping the ratio', () => {
    const placement = fitToPage(600, 1200, PDF_PAGE_BOX.letter);

    expect(placement.height).toBeCloseTo(792 - PDF_MARGIN_PT * 2);
    expect(placement.width).toBeCloseTo(placement.height / 2);
    expect(placement.x).toBeCloseTo((612 - placement.width) / 2);
  });

  it('rejects a canvas without pixels', () => {
    expect(() => fitToPage(0, 600, PDF_PAGE_BOX.letter)).toThrow('no size');
    expect(() => fitToPage(600, -1, PDF_PAGE_BOX.letter)).toThrow('no size');
  });
});

describe('saveMapPdf (SCRUM-117)', () => {
  it('captures the view, fits it on the chosen page and saves it', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue({ width: 1000, height: 600 } as HTMLCanvasElement);

    await saveMapPdf(
      element,
      content,
      { fileName: 'wind-map_2026-11-18_1400PST.pdf', pageSize: 'a4', orientation: 'landscape' },
      { domToCanvas, tileTimeoutMs: 0 },
    );

    expect(pdf.ctor).toHaveBeenCalledWith({
      orientation: 'landscape',
      unit: 'pt',
      format: [PDF_PAGE_BOX.a4.height, PDF_PAGE_BOX.a4.width],
    });

    const [dataUrl, format, x, y, width, height] = pdf.addImage.mock.calls[0];
    expect(dataUrl).toBe('data:image/jpeg;base64,AAAA');
    expect(format).toBe('JPEG');
    // The canvas is 1000 x (600 + the 2x chrome), so the page height is the limiting side.
    expect(width / height).toBeCloseTo(1000 / (600 + (74 + 78 + 30) * 2), 5);
    expect(x).toBeGreaterThanOrEqual(PDF_MARGIN_PT);
    expect(y).toBeGreaterThanOrEqual(PDF_MARGIN_PT);
    expect(x + width).toBeLessThanOrEqual(PDF_PAGE_BOX.a4.height);
    expect(y + height).toBeLessThanOrEqual(PDF_PAGE_BOX.a4.width);
    expect(pdf.save).toHaveBeenCalledWith('wind-map_2026-11-18_1400PST.pdf');
  });

  it('re-encodes the page as high-quality JPEG', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue({ width: 800, height: 600 } as HTMLCanvasElement);

    await saveMapPdf(
      element,
      content,
      { fileName: 'wind-map.pdf', pageSize: 'letter', orientation: 'portrait' },
      { domToCanvas, tileTimeoutMs: 0 },
    );

    const toDataURL = HTMLCanvasElement.prototype.toDataURL as unknown as ReturnType<typeof vi.fn>;
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', PDF_IMAGE_QUALITY);
    expect(PDF_IMAGE_QUALITY).toBe(0.92);
  });

  it('refuses an empty data URL instead of adding it to the page (SCRUM-241)', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue({ width: 800, height: 600 } as HTMLCanvasElement);
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue('data:,');

    await expect(
      saveMapPdf(
        element,
        content,
        { fileName: 'wind-map.pdf', pageSize: 'letter', orientation: 'portrait' },
        { domToCanvas, tileTimeoutMs: 0 },
      ),
    ).rejects.toThrow('could not be encoded');
    expect(pdf.addImage).not.toHaveBeenCalled();
    expect(pdf.save).not.toHaveBeenCalled();
  });

  it('names a jsPDF chunk that will not load (SCRUM-241)', async () => {
    const element = document.createElement('div');
    const domToCanvas = vi.fn().mockResolvedValue({ width: 800, height: 600 } as HTMLCanvasElement);
    const failingChunk = () =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/jspdf.js'));

    await expect(
      saveMapPdf(
        element,
        content,
        { fileName: 'wind-map.pdf', pageSize: 'letter', orientation: 'portrait' },
        { domToCanvas, tileTimeoutMs: 0, loadJsPdf: () => loadJsPdf(failingChunk) },
      ),
    ).rejects.toThrow('Reload the page and try again');
    expect(pdf.ctor).not.toHaveBeenCalled();
  });

  it('surfaces a capture failure without building a document', async () => {
    const element = document.createElement('div');

    await expect(
      saveMapPdf(
        element,
        content,
        { fileName: 'wind-map.pdf', pageSize: 'letter', orientation: 'portrait' },
        { domToCanvas: vi.fn().mockRejectedValue(new Error('capture failed')), tileTimeoutMs: 0 },
      ),
    ).rejects.toThrow('capture failed');
    expect(pdf.ctor).not.toHaveBeenCalled();
  });
});
