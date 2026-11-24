import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fitToPage, pageBox } from './pdfExport';
import type { RangeFrame } from './rangeCapture';

const { zipSync, jsPdfDoc, JsPdfMock } = vi.hoisted(() => {
  const doc = { addPage: vi.fn(), addImage: vi.fn(), save: vi.fn() };
  // A function expression, so that `new jsPDF(...)` works in the tested module.
  const JsPdfMock = vi.fn(function (this: unknown) {
    return doc;
  });
  const zipSync = vi.fn(
    (_entries: Record<string, Uint8Array>, _options?: { level?: number }) => new Uint8Array([7, 8, 9]),
  );
  return { zipSync, jsPdfDoc: doc, JsPdfMock };
});

vi.mock('fflate', () => ({ zipSync }));
vi.mock('jspdf', () => ({ jsPDF: JsPdfMock }));
vi.mock('./download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./download')>()),
  downloadBlob: vi.fn(),
}));

import { downloadBlob } from './download';
import { saveRangeImages, saveRangePdf } from './rangeOutput';

const HOURS = [
  '2026-11-23T22:00:00.000Z',
  '2026-11-23T23:00:00.000Z',
  '2026-11-24T00:00:00.000Z',
];

function canvasFor(width = 800, height = 600) {
  return {
    width,
    height,
    toBlob: vi.fn((cb: (blob: Blob | null) => void, mime: string) => {
      cb({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, type: mime } as unknown as Blob);
    }),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,AAAA'),
  } as unknown as HTMLCanvasElement;
}

function frames(count = HOURS.length): RangeFrame[] {
  return HOURS.slice(0, count).map((time) => ({ time, canvas: canvasFor() }));
}

const IMAGE_OPTIONS = {
  modelId: 'best_match',
  timezone: 'America/Los_Angeles',
  format: 'png' as const,
  jpegQuality: 0.92,
};

beforeEach(() => {
  vi.clearAllMocks();
  zipSync.mockReturnValue(new Uint8Array([7, 8, 9]));
});

describe('saveRangeImages (SCRUM-156)', () => {
  it('packs one entry per hour into a single ZIP named from the first hour and the count', async () => {
    await saveRangeImages(frames(), IMAGE_OPTIONS);

    expect(zipSync).toHaveBeenCalledTimes(1);
    const entries = zipSync.mock.calls[0][0];
    expect(Object.keys(entries)).toEqual([
      'best_match_2026-11-23_1400PST.png',
      'best_match_2026-11-23_1500PST.png',
      'best_match_2026-11-23_1600PST.png',
    ]);
    expect(Object.values(entries).every((bytes) => bytes instanceof Uint8Array)).toBe(true);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(blob.type).toBe('application/zip');
    expect(name).toBe('best_match_2026-11-23_1400PST_3hours.zip');
  });

  it('downloads a single-hour range as that image, with no ZIP', async () => {
    await saveRangeImages(frames(1), IMAGE_OPTIONS);

    expect(zipSync).not.toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('best_match_2026-11-23_1400PST.png');
  });

  it('encodes JPEG at the chosen quality and names the entries .jpeg', async () => {
    const list = frames(2);
    await saveRangeImages(list, { ...IMAGE_OPTIONS, format: 'jpeg', jpegQuality: 0.8 });

    for (const frame of list) {
      expect(vi.mocked(frame.canvas.toBlob).mock.calls[0][1]).toBe('image/jpeg');
      expect(vi.mocked(frame.canvas.toBlob).mock.calls[0][2]).toBe(0.8);
    }
    const entries = zipSync.mock.calls[0][0];
    expect(Object.keys(entries)).toEqual([
      'best_match_2026-11-23_1400PST.jpeg',
      'best_match_2026-11-23_1500PST.jpeg',
    ]);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('best_match_2026-11-23_1400PST_2hours.zip');
  });

  it('leaves PNG quality undefined', async () => {
    const list = frames(1);
    await saveRangeImages(list, IMAGE_OPTIONS);
    expect(vi.mocked(list[0].canvas.toBlob).mock.calls[0][2]).toBeUndefined();
  });

  it('does nothing for an empty range and rejects when the canvas cannot encode', async () => {
    await saveRangeImages([], IMAGE_OPTIONS);
    expect(downloadBlob).not.toHaveBeenCalled();

    const broken = [
      {
        time: HOURS[0],
        canvas: { toBlob: (cb: (blob: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement,
      },
    ];
    await expect(saveRangeImages(broken, IMAGE_OPTIONS)).rejects.toThrow(
      'The map image could not be encoded',
    );
  });
});

describe('saveRangePdf (SCRUM-156)', () => {
  it('writes one page per hour with a page break before every page after the first', async () => {
    await saveRangePdf(frames(), {
      modelId: 'ecmwf_ifs',
      timezone: 'America/Los_Angeles',
      pageSize: 'letter',
      orientation: 'portrait',
    });

    expect(JsPdfMock).toHaveBeenCalledWith({
      orientation: 'portrait',
      unit: 'pt',
      format: [612, 792],
    });
    expect(jsPdfDoc.addImage).toHaveBeenCalledTimes(3);
    expect(jsPdfDoc.addPage).toHaveBeenCalledTimes(2);
    // The first page needs no addPage; both later pages happen after the previous image.
    expect(jsPdfDoc.addPage.mock.invocationCallOrder[0]).toBeLessThan(
      jsPdfDoc.addImage.mock.invocationCallOrder[1],
    );
    expect(jsPdfDoc.save).toHaveBeenCalledWith('ecmwf_ifs_2026-11-23_1400PST_3hours.pdf');
  });

  it('fits every page with the same helper and page box as the single-page PDF', async () => {
    const list = frames(2);
    await saveRangePdf(list, {
      modelId: 'gfs_seamless',
      timezone: 'UTC',
      pageSize: 'a4',
      orientation: 'landscape',
    });

    const page = pageBox('a4', 'landscape');
    list.forEach((frame, index) => {
      const expected = fitToPage(frame.canvas.width, frame.canvas.height, page);
      expect(jsPdfDoc.addImage.mock.calls[index]).toEqual([
        'data:image/jpeg;base64,AAAA',
        'JPEG',
        expected.x,
        expected.y,
        expected.width,
        expected.height,
      ]);
      expect(vi.mocked(frame.canvas.toDataURL)).toHaveBeenCalledWith('image/jpeg', 0.9);
    });
    expect(jsPdfDoc.save).toHaveBeenCalledWith('gfs_seamless_2026-11-23_2200UTC_2hours.pdf');
  });

  it('handles a single-page range and an empty one', async () => {
    await saveRangePdf(frames(1), {
      modelId: 'best_match',
      timezone: 'UTC',
      pageSize: 'letter',
      orientation: 'portrait',
    });
    expect(jsPdfDoc.addPage).not.toHaveBeenCalled();
    expect(jsPdfDoc.save).toHaveBeenCalledWith('best_match_2026-11-23_2200UTC_1hour.pdf');

    vi.clearAllMocks();
    await saveRangePdf([], {
      modelId: 'best_match',
      timezone: 'UTC',
      pageSize: 'letter',
      orientation: 'portrait',
    });
    expect(jsPdfDoc.addImage).not.toHaveBeenCalled();
    expect(jsPdfDoc.save).not.toHaveBeenCalled();
  });
});
