import { describe, expect, it } from 'vitest';
import {
  MAX_FEEDBACK_FILE_BYTES,
  MAX_FEEDBACK_FILES_BYTES,
  attachmentProblem,
  formatFileSize,
  isAllowedAttachment,
  totalAttachmentBytes,
} from './feedbackAttachments';

function file(name: string, type: string, size = 1024): File {
  const content = new Uint8Array(Math.min(size, 16));
  return new File([content], name, { type });
}

function sized(size: number, name = 'big.png'): File {
  const created = file(name, 'image/png');
  Object.defineProperty(created, 'size', { value: size });
  return created;
}

describe('feedback attachments (SCRUM-219)', () => {
  it('accepts the allowed images, PDF and plain text', () => {
    for (const [name, type] of [
      ['shot.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['anim.gif', 'image/gif'],
      ['img.webp', 'image/webp'],
      ['doc.pdf', 'application/pdf'],
      ['notes.txt', 'text/plain'],
      ['run.log', ''],
      ['data.csv', 'text/csv'],
      ['data.json', 'application/json'],
    ]) {
      expect(isAllowedAttachment(file(name, type))).toBe(true);
    }
  });

  it('refuses SVG, HTML and executables', () => {
    expect(isAllowedAttachment(file('drawing.svg', 'image/svg+xml'))).toBe(false);
    expect(isAllowedAttachment(file('page.html', 'text/html'))).toBe(false);
    expect(isAllowedAttachment(file('tool.exe', 'application/x-msdownload'))).toBe(false);
    expect(isAllowedAttachment(file('archive.zip', 'application/zip'))).toBe(false);
  });

  it('refuses a fourth file, an oversize file, an empty file and too much in total', () => {
    const three = [file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.png', 'image/png')];
    expect(attachmentProblem(three, file('d.png', 'image/png'))).toBe('You can attach up to 3 files.');
    expect(attachmentProblem([], sized(MAX_FEEDBACK_FILE_BYTES + 1))).toBe(
      'big.png: each file can be at most 4 MB.',
    );
    expect(attachmentProblem([], sized(0))).toBe('big.png: the file is empty.');
    const nearlyFull = [sized(MAX_FEEDBACK_FILES_BYTES - 10, 'a.png')];
    expect(attachmentProblem(nearlyFull, file('b.png', 'image/png'))).toBe('Attachments can total at most 12 MB.');
  });

  it('explains a refused type and reports the running total', () => {
    expect(attachmentProblem([], file('drawing.svg', 'image/svg+xml'))).toBe(
      'drawing.svg: attach an image, a PDF or a plain-text file.',
    );
    expect(totalAttachmentBytes([sized(1024), sized(2048)])).toBe(3072);
  });

  it('formats sizes the way the list shows them', () => {
    expect(formatFileSize(812)).toBe('812 B');
    expect(formatFileSize(25_190)).toBe('24.6 KB');
    expect(formatFileSize(7.8 * 1024 * 1024)).toBe('7.8 MB');
  });
});
