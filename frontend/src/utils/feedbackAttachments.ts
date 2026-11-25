/**
 * The feedback form's attachment rules (SCRUM-219), mirroring the server so an oversize or
 * disallowed file is refused before it is sent. The server stays authoritative.
 */

export const MAX_FEEDBACK_FILES = 3;
export const MAX_FEEDBACK_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FEEDBACK_FILES_BYTES = 12 * 1024 * 1024;

export const ACCEPTED_ATTACHMENT_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.log',
  '.csv',
  '.json',
] as const;

const ACCEPTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
]);

/** The picker's `accept` attribute: the allowed MIME types and extensions. */
export const ATTACHMENT_ACCEPT = [...ACCEPTED_MIME, ...ACCEPTED_ATTACHMENT_EXTENSIONS].join(',');

/** Lower-case extension of a file name, or "" when it has none. */
export function extensionOf(name: string): string {
  const base = name.toLowerCase().replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export function isAllowedAttachment(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (ACCEPTED_MIME.has(mime)) return true;
  const extension = extensionOf(file.name);
  return (
    (ACCEPTED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension) &&
    (mime === '' || mime === 'application/octet-stream' || mime.startsWith('text/'))
  );
}

export function totalAttachmentBytes(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

/** Why `candidate` cannot join `files`, or null when it can. */
export function attachmentProblem(files: File[], candidate: File): string | null {
  if (!isAllowedAttachment(candidate)) {
    return `${candidate.name}: attach an image, a PDF or a plain-text file.`;
  }
  if (candidate.size === 0) return `${candidate.name}: the file is empty.`;
  if (candidate.size > MAX_FEEDBACK_FILE_BYTES) return `${candidate.name}: each file can be at most 4 MB.`;
  if (files.length >= MAX_FEEDBACK_FILES) return `You can attach up to ${MAX_FEEDBACK_FILES} files.`;
  if (totalAttachmentBytes(files) + candidate.size > MAX_FEEDBACK_FILES_BYTES) {
    return 'Attachments can total at most 12 MB.';
  }
  return null;
}

/** "812 B", "24.6 KB" or "7.8 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
