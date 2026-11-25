import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jpegNameFor, screenshotFileName, shrinkScreenshot } from './screenshotPaste';

const CAP = 4 * 1024 * 1024;

function blobOfSize(size: number): Blob {
  const blob = new Blob(['x']);
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

function screenshot(size: number, name = 'screenshot-20261125-153045.png'): File {
  const file = new File(['png'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

let encodedSizes: number[];

beforeEach(() => {
  encodedSizes = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 2000, height: 1200, close: vi.fn() }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback, _type, quality) => {
    encodedSizes.push(quality ?? 0);
    callback(blobOfSize(encodedSizes.length < 3 ? CAP + 1 : CAP - 1024));
  }) as unknown as HTMLCanvasElement['toBlob'];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('screenshot naming (SCRUM-220)', () => {
  it('stamps the paste time and numbers several images', () => {
    const at = new Date(2026, 10, 25, 15, 30, 45);
    expect(screenshotFileName(at)).toBe('screenshot-20261125-153045.png');
    expect(screenshotFileName(at, 1)).toBe('screenshot-20261125-153045-2.png');
    expect(screenshotFileName(at, 0, 'jpg')).toBe('screenshot-20261125-153045.jpg');
  });

  it('turns an image name into a JPEG name', () => {
    expect(jpegNameFor('screenshot-20261125-153045.png')).toBe('screenshot-20261125-153045.jpg');
    expect(jpegNameFor('shot.jpeg')).toBe('shot.jpg');
    expect(jpegNameFor('shot')).toBe('shot.jpg');
  });
});

describe('shrinkScreenshot (SCRUM-220)', () => {
  it('leaves an image under the cap untouched', async () => {
    const file = screenshot(1024);
    expect(await shrinkScreenshot(file)).toBe(file);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('re-encodes an oversize image as a JPEG under the cap', async () => {
    const shrunk = await shrinkScreenshot(screenshot(7 * 1024 * 1024));
    expect(shrunk).not.toBeNull();
    expect(shrunk!.type).toBe('image/jpeg');
    expect(shrunk!.name).toMatch(/^screenshot-.*\.jpg$/);
    expect(shrunk!.size).toBeLessThanOrEqual(CAP);
  });

  it('tries every quality at full size before downscaling', async () => {
    encodedSizes = [];
    await shrinkScreenshot(screenshot(7 * 1024 * 1024));
    // 0.9, 0.8, 0.7, 0.6 at full size; the third answer fits, so no downscale was needed.
    expect(encodedSizes.slice(0, 4)).toEqual([0.9, 0.8, 0.7]);
  });

  it('downscales and tries the qualities again when full size cannot fit', async () => {
    const qualities: number[] = [];
    let call = 0;
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback, _type, quality) => {
      qualities.push(quality ?? 0);
      call += 1;
      callback(blobOfSize(call <= 4 ? CAP + 1 : CAP - 1024));
    }) as unknown as HTMLCanvasElement['toBlob'];

    const shrunk = await shrinkScreenshot(screenshot(7 * 1024 * 1024));
    expect(shrunk).not.toBeNull();
    expect(qualities.slice(0, 5)).toEqual([0.9, 0.8, 0.7, 0.6, 0.9]);
  });

  it('gives up when even the smallest attempt is too large', async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) =>
      callback(blobOfSize(CAP + 1)),
    ) as unknown as HTMLCanvasElement['toBlob'];
    expect(await shrinkScreenshot(screenshot(7 * 1024 * 1024))).toBeNull();
  });

  it('gives up when the image cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image')));
    expect(await shrinkScreenshot(screenshot(7 * 1024 * 1024))).toBeNull();
  });
});
