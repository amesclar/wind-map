import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackModal } from './FeedbackModal';
import { ApiError, submitFeedback } from '../api/client';
import { SHRINK_FAILED_MESSAGE, shrinkScreenshot } from '../utils/screenshotPaste';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, submitFeedback: vi.fn() };
});

// The shrink loop itself is covered by screenshotPaste.test; here only the wiring matters.
vi.mock('../utils/screenshotPaste', async () => {
  const actual =
    await vi.importActual<typeof import('../utils/screenshotPaste')>('../utils/screenshotPaste');
  return { ...actual, shrinkScreenshot: vi.fn() };
});

const submit = vi.mocked(submitFeedback);
const shrink = vi.mocked(shrinkScreenshot);

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

function png(name = 'shot.png', size = 1024): File {
  const file = new File([new Uint8Array(8)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const attach = (...files: File[]) =>
  fireEvent.change(screen.getByTestId('feedback-file-input'), { target: { files } });

describe('FeedbackModal (SCRUM-179)', () => {
  beforeEach(() => {
    submit.mockReset();
    shrink.mockReset();
    shrink.mockImplementation(async (file: File) => file);
  });

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
    // No map is mounted in this render, so no zoom is claimed (SCRUM-320).
    expect(payload.map_zoom).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('files the map zoom when the map reports one (SCRUM-320)', async () => {
    submit.mockResolvedValue({ issue_key: 'SCRUM-322', issue_url: '' });
    render(<FeedbackModal isOpen onClose={vi.fn()} mapZoom={14} />);
    fill();
    send();
    await screen.findByText('SCRUM-322');

    expect(submit.mock.calls[0][0].map_zoom).toBe(14);
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

  describe('attachments (SCRUM-219)', () => {
    it('adds a picked file with its size and the running total', () => {
      renderModal();
      attach(png('shot.png', 24_576));

      expect(screen.getByTestId('attachment-name').textContent).toBe('shot.png');
      expect(screen.getByText('24.0 KB')).toBeTruthy();
      expect(screen.getByTestId('attachment-total').textContent).toContain('of 12 MB');
    });

    it('accepts a dropped file and highlights the zone while dragging', () => {
      renderModal();
      const zone = screen.getByTestId('feedback-drop-zone');

      fireEvent.dragOver(zone);
      expect(zone.className).toContain('border-sky-400');

      fireEvent.drop(zone, { dataTransfer: { files: [png('dropped.png')] } });
      expect(zone.className).not.toContain('border-sky-400');
      expect(screen.getByTestId('attachment-name').textContent).toBe('dropped.png');
    });

    it('removes a file from the list', () => {
      renderModal();
      attach(png());
      fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }));
      expect(screen.queryByTestId('attachment-list')).toBeNull();
    });

    it('refuses a fourth file, an oversize file and a wrong type', () => {
      renderModal();
      attach(png('a.png'), png('b.png'), png('c.png'));
      attach(png('d.png'));
      expect(screen.getByTestId('attachment-error').textContent).toBe('You can attach up to 3 files.');
      expect(screen.getAllByTestId('attachment-name')).toHaveLength(3);

      attach(new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' }));
      expect(screen.getByTestId('attachment-error').textContent).toMatch(/attach an image, a PDF or a plain-text file/);

      attach(png('huge.png', 5 * 1024 * 1024));
      expect(screen.getByTestId('attachment-error').textContent).toBe('huge.png: each file can be at most 4 MB.');
      expect(screen.getAllByTestId('attachment-name')).toHaveLength(3);
    });

    it('sends the files with the payload and clears them only after the key is shown', async () => {
      submit.mockResolvedValue({ issue_key: 'SCRUM-500', issue_url: '' });
      renderModal();
      fill();
      const file = png('shot.png');
      attach(file);
      send();

      await screen.findByText('SCRUM-500');
      expect(submit.mock.calls[0][0].files).toHaveLength(1);
      expect(submit.mock.calls[0][0].files?.[0].name).toBe('shot.png');

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByTestId('attachment-list')).toBeNull();
    });

    it('keeps the files after a failure so a retry carries them too', async () => {
      submit.mockRejectedValueOnce(new ApiError('Failed', 502));
      renderModal();
      fill();
      attach(png());
      send();

      await screen.findByRole('alert');
      expect(screen.getByTestId('attachment-name').textContent).toBe('shot.png');

      submit.mockResolvedValueOnce({ issue_key: 'SCRUM-501', issue_url: '' });
      send();
      await screen.findByText('SCRUM-501');
      expect(submit.mock.calls[1][0].files).toHaveLength(1);
    });

    it('adds a pasted screenshot under a timestamped name', async () => {
      renderModal();
      const dialog = screen.getByRole('dialog');
      const image = new File(['png'], 'image.png', { type: 'image/png' });

      fireEvent.paste(dialog, { clipboardData: { files: [image] } });
      await waitFor(() => expect(screen.getByTestId('attachment-name')).toBeTruthy());

      const name = screen.getByTestId('attachment-name').textContent!;
      expect(name).toMatch(/^screenshot-\d{8}-\d{6}\.png$/);
      expect(shrink).toHaveBeenCalledTimes(1);
    });

    it('leaves a text paste to the focused field', async () => {
      renderModal();
      const dialog = screen.getByRole('dialog');

      fireEvent.paste(dialog, { clipboardData: { files: [], getData: () => 'hello' } });
      await waitFor(() => expect(shrink).not.toHaveBeenCalled());
      expect(screen.queryByTestId('attachment-list')).toBeNull();
    });

    it('does nothing while the dialog is closed', () => {
      render(<FeedbackModal isOpen={false} onClose={vi.fn()} />);
      fireEvent.paste(document.body, {
        clipboardData: { files: [new File(['png'], 'image.png', { type: 'image/png' })] },
      });
      expect(shrink).not.toHaveBeenCalled();
    });

    it('refuses a pasted screenshot past the three-file limit', async () => {
      renderModal();
      attach(png('a.png'), png('b.png'), png('c.png'));

      fireEvent.paste(screen.getByRole('dialog'), {
        clipboardData: { files: [new File(['png'], 'image.png', { type: 'image/png' })] },
      });

      await waitFor(() =>
        expect(screen.getByTestId('attachment-error').textContent).toBe('You can attach up to 3 files.'),
      );
      expect(screen.getAllByTestId('attachment-name')).toHaveLength(3);
    });

    it('attaches an oversize paste as a shrunk JPEG and says so', async () => {
      shrink.mockImplementation(async (file: File) => {
        const jpeg = new File(['jpg'], file.name.replace(/\.png$/, '.jpg'), { type: 'image/jpeg' });
        Object.defineProperty(jpeg, 'size', { value: 2 * 1024 * 1024 });
        return jpeg;
      });
      renderModal();
      const huge = new File(['png'], 'image.png', { type: 'image/png' });
      Object.defineProperty(huge, 'size', { value: 7.8 * 1024 * 1024 });

      fireEvent.paste(screen.getByRole('dialog'), { clipboardData: { files: [huge] } });

      await waitFor(() => expect(screen.getByTestId('attachment-shrunk')).toBeTruthy());
      expect(screen.getByTestId('attachment-name').textContent).toMatch(/^screenshot-.*\.jpg$/);
      expect(screen.getByTestId('attachment-shrunk').textContent).toContain('shrunk from 7.8 MB');
    });

    it('refuses a paste that cannot be shrunk under the cap', async () => {
      shrink.mockResolvedValue(null);
      renderModal();
      const huge = new File(['png'], 'image.png', { type: 'image/png' });
      Object.defineProperty(huge, 'size', { value: 7.8 * 1024 * 1024 });

      fireEvent.paste(screen.getByRole('dialog'), { clipboardData: { files: [huge] } });

      await waitFor(() =>
        expect(screen.getByTestId('attachment-error').textContent).toBe(SHRINK_FAILED_MESSAGE),
      );
      expect(screen.queryByTestId('attachment-list')).toBeNull();
    });

    it('never re-encodes a picked file, even an oversize one', () => {
      renderModal();
      attach(png('big.png', 5 * 1024 * 1024));
      expect(shrink).not.toHaveBeenCalled();
      expect(screen.getByTestId('attachment-error').textContent).toBe('big.png: each file can be at most 4 MB.');
    });

    it('warns in plain language when the issue was filed without its files', async () => {
      submit.mockResolvedValue({ issue_key: 'SCRUM-502', issue_url: '', attachments_failed: true });
      renderModal();
      fill();
      attach(png());
      send();

      await screen.findByText('SCRUM-502');
      expect(screen.getByTestId('attachments-warning').textContent).toBe(
        "Your files could not be attached. You don't need to send the feedback again.",
      );
    });
  });
});
