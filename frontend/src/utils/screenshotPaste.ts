/**
 * Pasted screenshots (SCRUM-220): naming a clipboard image and shrinking one that is over the
 * 4 MiB attachment cap. Only pasted images are re-encoded; picked and dropped files keep their
 * original bytes.
 */
import { MAX_FEEDBACK_FILE_BYTES } from './feedbackAttachments';

const JPEG_QUALITIES = [0.9, 0.8, 0.7, 0.6] as const;
const MAX_SCALE_STEPS = 3;
const SCALE_STEP = 0.75;

export const SHRINK_FAILED_MESSAGE =
  'This screenshot is too large to attach, even after shrinking. Try capturing a smaller area.';

const pad = (value: number) => String(value).padStart(2, '0');

/** `screenshot-20261125-153045.png`; `index` adds `-2`, `-3` for several images in one paste. */
export function screenshotFileName(date: Date, index = 0, extension = 'png'): string {
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `screenshot-${stamp}${index > 0 ? `-${index + 1}` : ''}.${extension}`;
}

/** `shot.png` → `shot.jpg`, for a screenshot that had to be re-encoded. */
export function jpegNameFor(name: string): string {
  return `${name.replace(/\.(png|jpe?g|webp|gif)$/i, '')}.jpg`;
}

async function encode(bitmap: ImageBitmap, scale: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  // JPEG has no transparency: fill first, or transparent areas come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * The file unchanged when it already fits, a JPEG under `maxBytes` when it can be shrunk, or null
 * when even the smallest attempt is too large. Qualities 0.9, 0.8, 0.7 and 0.6 are tried at full
 * size, then the image is scaled by 0.75 and the qualities are tried again, at most three times.
 */
export async function shrinkScreenshot(
  file: File,
  maxBytes = MAX_FEEDBACK_FILE_BYTES,
): Promise<File | null> {
  if (file.size <= maxBytes) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    let scale = 1;
    for (let step = 0; step <= MAX_SCALE_STEPS; step += 1) {
      for (const quality of JPEG_QUALITIES) {
        const blob = await encode(bitmap, scale, quality);
        if (blob && blob.size <= maxBytes) {
          return new File([blob], jpegNameFor(file.name), { type: 'image/jpeg' });
        }
      }
      scale *= SCALE_STEP;
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}
