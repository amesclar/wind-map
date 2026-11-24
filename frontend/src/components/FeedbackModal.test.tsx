import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackModal } from './FeedbackModal';
import { ApiError, submitFeedback } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, submitFeedback: vi.fn() };
});

const submit = vi.mocked(submitFeedback);

function renderModal(isOpen = true, onClose = vi.fn()) {
  render(<FeedbackModal isOpen={isOpen} onClose={onClose} />);
  return { onClose };
}

function fill({ type = 'bug', subject = 'Map blank', comments = 'It will not load', email = '' } = {}) {
  if (type) fireEvent.change(screen.getByLabelText('Feedback type'), { target: { value: type } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText('Comments'), { target: { value: comments } });
  fireEvent.change(screen.getByLabelText(/Contact email/), { target: { value: email } });
}

const send = () => fireEvent.click(screen.getByRole('button', { name: /^(Send|Retry)$/ }));

describe('FeedbackModal (SCRUM-179)', () => {
  beforeEach(() => submit.mockReset());

  it('renders nothing when closed', () => {
    render(<FeedbackModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal dialog with nothing selected and focuses the first field', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Send feedback' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const select = screen.getByLabelText('Feedback type') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Select a type...' })).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'bug', 'new feature', 'comment']);
    expect(document.activeElement).toBe(select);
  });

  it('closes on Escape and from Cancel', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('restores focus to the trigger when it closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(<FeedbackModal isOpen onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(trigger);
    rerender(<FeedbackModal isOpen={false} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('blocks a submit without a type and marks the field invalid', () => {
    renderModal();
    fill({ type: '' });
    send();
    expect(submit).not.toHaveBeenCalled();
    const select = screen.getByLabelText('Feedback type');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    const describedBy = select.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('Choose a feedback type.');
  });

  it('requires a subject and comments and checks the email format', () => {
    renderModal();
    fill({ subject: '  ', comments: '', email: 'nope' });
    send();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Subject').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Comments').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Contact email/).getAttribute('aria-invalid')).toBe('true');
  });

  it('shows live counters and caps input at 50 and 1000 characters', () => {
    renderModal();
    const subject = screen.getByLabelText('Subject') as HTMLInputElement;
    const comments = screen.getByLabelText('Comments') as HTMLTextAreaElement;
    expect(subject.maxLength).toBe(50);
    expect(comments.maxLength).toBe(1000);
    fireEvent.change(subject, { target: { value: 'abc' } });
    fireEvent.change(comments, { target: { value: 'hello' } });
    expect(screen.getByTestId('subject-count').textContent).toBe('3/50');
    expect(screen.getByTestId('comments-count').textContent).toBe('5/1000');
  });

  it('sends the payload with version, timezone and user agent, then names the issue key', async () => {
    submit.mockResolvedValue({ issue_key: 'SCRUM-321', issue_url: 'https://x/browse/SCRUM-321' });
    const { onClose } = renderModal();
    fill({ type: 'new feature', email: ' me@example.com ' });
    send();
    await screen.findByText('SCRUM-321');
    expect(submit).toHaveBeenCalledTimes(1);
    const payload = submit.mock.calls[0][0];
    expect(payload).toMatchObject({
      type: 'new feature',
      subject: 'Map blank',
      comments: 'It will not load',
      contact_email: 'me@example.com',
    });
    expect(payload.app_version).toBeTruthy();
    expect(payload.user_agent.length).toBeLessThanOrEqual(200);
    expect(typeof payload.timezone).toBe('string');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('omits the email when blank', async () => {
    submit.mockResolvedValue({ issue_key: 'SCRUM-1', issue_url: '' });
    renderModal();
    fill();
    send();
    await screen.findByText('SCRUM-1');
    expect(submit.mock.calls[0][0]).not.toHaveProperty('contact_email');
  });

  it('clears the form only after a key is shown, so the next open starts empty', async () => {
    submit.mockResolvedValue({ issue_key: 'SCRUM-2', issue_url: '' });
    const { onClose } = renderModal();
    fill();
    send();
    await screen.findByText('SCRUM-2');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Feedback type') as HTMLSelectElement).value).toBe('');
  });

  it('disables submit with aria-busy while the request runs', async () => {
    let resolve!: (v: { issue_key: string; issue_url: string }) => void;
    submit.mockReturnValue(new Promise((r) => (resolve = r)));
    renderModal();
    fill();
    send();
    const button = await screen.findByRole('button', { name: 'Sending…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    resolve({ issue_key: 'SCRUM-3', issue_url: '' });
    await screen.findByText('SCRUM-3');
  });

  it('keeps every field after a failure and retries only when asked', async () => {
    submit.mockRejectedValueOnce(new ApiError('Failed', 502));
    renderModal();
    fill({ email: 'me@example.com' });
    send();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Map blank');
    expect((screen.getByLabelText('Comments') as HTMLTextAreaElement).value).toBe('It will not load');
    expect((screen.getByLabelText('Feedback type') as HTMLSelectElement).value).toBe('bug');
    expect((screen.getByLabelText(/Contact email/) as HTMLInputElement).value).toBe('me@example.com');
    expect(submit).toHaveBeenCalledTimes(1);

    submit.mockResolvedValueOnce({ issue_key: 'SCRUM-4', issue_url: '' });
    send();
    await screen.findByText('SCRUM-4');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, /Too many reports/],
    [503, /not available/],
    [502, /could not be sent/],
  ])('explains a %s failure', async (status, message) => {
    submit.mockRejectedValueOnce(new ApiError('Failed', status));
    renderModal();
    fill();
    send();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(message));
  });

  it('treats a network error as a retryable failure', async () => {
    submit.mockRejectedValueOnce(new TypeError('network'));
    renderModal();
    fill();
    send();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be sent/);
  });
});
