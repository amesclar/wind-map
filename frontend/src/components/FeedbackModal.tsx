import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { submitFeedback, ApiError } from '../api/client';
import { APP_VERSION } from '../version';
import type { FeedbackType } from '../types';

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
}

type FieldName = 'type' | 'subject' | 'comments' | 'email';
type Errors = Partial<Record<FieldName, string>>;

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
export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const [type, setType] = useState('');
  const [subject, setSubject] = useState('');
  const [comments, setComments] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
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
    }
    setErrors({});
    setFailure(null);
    setIssueKey(null);
    onClose();
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
      const result = await submitFeedback({
        type: type as FeedbackType,
        subject: subject.trim(),
        comments: comments.trim(),
        ...(email.trim() ? { contact_email: email.trim() } : {}),
        app_version: APP_VERSION,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
        user_agent: navigator.userAgent.slice(0, 200),
      });
      setIssueKey(result.issue_key);
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
