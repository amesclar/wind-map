import React, { useEffect, useId, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { submitFeedback, ApiError } from '../api/client';
import { clientInfo } from '../utils/clientInfo';
import type { FeedbackType } from '../types';
import {
  ATTACHMENT_ACCEPT,
  MAX_FEEDBACK_FILES,
  MAX_FEEDBACK_FILES_BYTES,
  MAX_FEEDBACK_FILE_BYTES,
  attachmentProblem,
  formatFileSize,
  totalAttachmentBytes,
} from '../utils/feedbackAttachments';
import { SHRINK_FAILED_MESSAGE, screenshotFileName, shrinkScreenshot } from '../utils/screenshotPaste';

export const MAX_SUBJECT = 50;
export const MAX_COMMENTS = 1000;
export const MAX_EMAIL = 254;

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'new feature', label: 'New feature' },
  { value: 'comment', label: 'Comment' },
];

const EMAIL_PATTERN = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The live map zoom, filed with the ticket (SCRUM-320). */
  mapZoom?: number | null;
}

type FieldName = 'type' | 'subject' | 'comments' | 'email';
type Errors = Partial<Record<FieldName, string>>;

interface AttachmentItem {
  file: File;
  /** The pasted screenshot's original size when it had to be re-encoded (SCRUM-220). */
  shrunkFrom?: number;
}

function validate(type: string, subject: string, comments: string, email: string): Errors {
  const errors: Errors = {};
  if (!type) errors.type = 'Choose a feedback type.';
  if (!subject.trim()) errors.subject = 'Enter a subject.';
  if (!comments.trim()) errors.comments = 'Enter your comments.';
  if (email.trim() && !EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
  return errors;
}

function failureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Too many reports from this device. Please try again later.';
    if (err.status === 503) return 'Feedback is not available right now.';
  }
  return 'Your feedback could not be sent. Your text is still here, so you can try again.';
}

/**
 * Feedback form (SCRUM-179). Submitting files a Jira issue through POST /api/feedback. A failure
 * keeps every field as typed and waits for the user to retry: a silent retry could duplicate a ticket.
 */
export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, mapZoom = null }) => {
  const [type, setType] = useState('');
  const [subject, setSubject] = useState('');
  const [comments, setComments] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [attachmentsFailed, setAttachmentsFailed] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  // Focus the first field on open and give focus back to the trigger on close.
  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    return () => trigger?.focus?.();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (issueKey) doneRef.current?.focus();
  }, [issueKey]);

  if (!isOpen) return null;

  const close = () => {
    if (issueKey) {
      setType('');
      setSubject('');
      setComments('');
      setEmail('');
      setAttachments([]);
      setAttachmentError(null);
      setAttachmentsFailed(false);
    }
    setErrors({});
    setFailure(null);
    setIssueKey(null);
    setDragging(false);
    onClose();
  };

  /** Add what passes the caps and the type list; a refusal is reported and the rest still joins. */
  const addFiles = (incoming: FileList | File[]) => {
    const next = [...attachments];
    let problem: string | null = null;
    for (const file of Array.from(incoming)) {
      const found = attachmentProblem(next.map((item) => item.file), file);
      if (found) {
        problem = found;
        continue;
      }
      next.push({ file });
    }
    setAttachments(next);
    setAttachmentError(problem);
  };

  /** A pasted screenshot joins the list, shrunk to a JPEG when it is over the 4 MiB cap (SCRUM-220). */
  const handlePaste = async (event: React.ClipboardEvent) => {
    const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );
    // Pasted text still goes into the focused field as usual: only an image takes over the paste.
    if (images.length === 0) return;
    event.preventDefault();
    const now = new Date();
    const next = [...attachments];
    let problem: string | null = null;
    for (const [index, image] of images.entries()) {
      const named = new File([image], screenshotFileName(now, index), {
        type: image.type || 'image/png',
      });
      const shrunk = await shrinkScreenshot(named);
      if (!shrunk) {
        problem = SHRINK_FAILED_MESSAGE;
        continue;
      }
      const found = attachmentProblem(
        next.map((item) => item.file),
        shrunk,
      );
      if (found) {
        problem = found;
        continue;
      }
      next.push({ file: shrunk, shrunkFrom: shrunk === named ? undefined : image.size });
    }
    setAttachments(next);
    setAttachmentError(problem);
  };

  const removeFile = (index: number) => {
    setAttachments((files) => files.filter((_, position) => position !== index));
    setAttachmentError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validate(type, subject, comments, email);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const client = clientInfo();
      const result = await submitFeedback({
        type: type as FeedbackType,
        subject: subject.trim(),
        comments: comments.trim(),
        ...(email.trim() ? { contact_email: email.trim() } : {}),
        app_version: client.app_version,
        timezone: client.timezone,
        user_agent: client.user_agent,
        ...(mapZoom != null ? { map_zoom: mapZoom } : {}),
        ...(attachments.length > 0 ? { files: attachments.map((item) => item.file) } : {}),
      });
      setIssueKey(result.issue_key);
      setAttachmentsFailed(result.attachments_failed === true);
    } catch (err) {
      setFailure(failureMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldProps = (name: FieldName) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? id(`${name}-error`) : undefined,
  });
  const fieldError = (name: FieldName) =>
    errors[name] ? (
      <p id={id(`${name}-error`)} className="mt-1 text-xs text-red-400">
        {errors[name]}
      </p>
    ) : null;
  const inputClass =
    'w-full bg-dark-900 text-gray-100 text-sm border border-dark-600 rounded-lg px-3 py-2 focus:outline-hidden focus:border-sky-500';
  const labelClass = 'block text-xs font-medium text-gray-300 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id('title')}
        data-testid="feedback-modal"
        onPaste={handlePaste}
        className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <h2 id={id('title')} className="text-base font-semibold text-gray-100">
            Send feedback
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-dark-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {issueKey ? (
          <>
            <div className="px-5 py-4 text-sm text-gray-300" role="status">
              Thanks! Your feedback was filed as <span className="font-semibold text-sky-400">{issueKey}</span>.
              {attachmentsFailed && (
                <p className="mt-2 text-amber-300" data-testid="attachments-warning">
                  Your files could not be attached. You don't need to send the feedback again.
                </p>
              )}
            </div>
            <div className="flex justify-end px-5 py-4 border-t border-dark-600">
              <button
                ref={doneRef}
                type="button"
                onClick={close}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label htmlFor={id('type')} className={labelClass}>
                  Feedback type
                </label>
                <select
                  id={id('type')}
                  ref={firstFieldRef}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  required
                  className={inputClass}
                  {...fieldProps('type')}
                >
                  <option value="" disabled>
                    Select a type...
                  </option>
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {fieldError('type')}
              </div>

              <div>
                <label htmlFor={id('subject')} className={labelClass}>
                  Subject
                </label>
                <input
                  id={id('subject')}
                  type="text"
                  value={subject}
                  maxLength={MAX_SUBJECT}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  className={inputClass}
                  {...fieldProps('subject')}
                />
                <div className="flex justify-between">
                  <div>{fieldError('subject')}</div>
                  <span className="mt-1 text-xs text-gray-500" data-testid="subject-count">
                    {subject.length}/{MAX_SUBJECT}
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor={id('comments')} className={labelClass}>
                  Comments
                </label>
                <textarea
                  id={id('comments')}
                  rows={5}
                  value={comments}
                  maxLength={MAX_COMMENTS}
                  onChange={(e) => setComments(e.target.value)}
                  required
                  className={`${inputClass} resize-y`}
                  {...fieldProps('comments')}
                />
                <div className="flex justify-between">
                  <div>{fieldError('comments')}</div>
                  <span className="mt-1 text-xs text-gray-500" data-testid="comments-count">
                    {comments.length}/{MAX_COMMENTS}
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor={id('email')} className={labelClass}>
                  Contact email (optional)
                </label>
                <input
                  id={id('email')}
                  type="email"
                  value={email}
                  maxLength={MAX_EMAIL}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  {...fieldProps('email')}
                />
                {fieldError('email')}
              </div>

              <div>
                <span className={labelClass}>Attachments (optional)</span>
                <div
                  data-testid="feedback-drop-zone"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    addFiles(event.dataTransfer.files);
                  }}
                  className={`rounded-lg border border-dashed px-3 py-3 text-center transition ${
                    dragging ? 'border-sky-400 bg-sky-500/10' : 'border-dark-600'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dark-600 bg-dark-700 px-2.5 py-1.5 text-xs font-medium text-gray-200 hover:bg-dark-600"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Attach files
                  </button>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Drag and drop, or up to {MAX_FEEDBACK_FILES} files of{' '}
                    {MAX_FEEDBACK_FILE_BYTES / (1024 * 1024)} MB each
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    data-testid="feedback-file-input"
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files) addFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-gray-500">You can also paste a screenshot.</p>
                {attachments.length > 0 && (
                  <ul data-testid="attachment-list" className="mt-2 space-y-1">
                    {attachments.map((item, index) => (
                      <li
                        key={`${item.file.name}-${index}`}
                        className="flex items-center gap-2 text-xs text-gray-300"
                      >
                        <span className="min-w-0 flex-1 truncate" data-testid="attachment-name">
                          {item.file.name}
                        </span>
                        {item.shrunkFrom !== undefined && (
                          <span
                            className="shrink-0 text-[11px] text-amber-300/80"
                            data-testid="attachment-shrunk"
                          >
                            shrunk from {formatFileSize(item.shrunkFrom)}
                          </span>
                        )}
                        <span className="shrink-0 text-gray-500">{formatFileSize(item.file.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.file.name}`}
                          onClick={() => removeFile(index)}
                          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-dark-700 hover:text-gray-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {attachments.length > 0 && (
                  <p className="mt-1 text-[11px] text-gray-500" data-testid="attachment-total">
                    {formatFileSize(totalAttachmentBytes(attachments.map((item) => item.file)))} of{' '}
                    {MAX_FEEDBACK_FILES_BYTES / (1024 * 1024)} MB
                  </p>
                )}
                {attachmentError && (
                  <p role="alert" className="mt-1 text-xs text-red-400" data-testid="attachment-error">
                    {attachmentError}
                  </p>
                )}
              </div>

              {failure && (
                <p role="alert" className="text-sm text-red-400">
                  {failure}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-dark-600">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-gray-200 text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition disabled:opacity-60 disabled:cursor-wait"
              >
                {submitting ? 'Sending…' : failure ? 'Retry' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
