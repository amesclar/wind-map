import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapExportDialog } from './MapExportDialog';

const FILE_BASE = 'wind-map_2026-11-18_1400PST';
const TZ = 'America/Los_Angeles';
/** Mon 23 Nov 2026, 14:00 to 18:00 PST, hour by hour. */
const RANGE_HOURS = [
  '2026-11-23T22:00:00.000Z',
  '2026-11-23T23:00:00.000Z',
  '2026-11-24T00:00:00.000Z',
  '2026-11-24T01:00:00.000Z',
  '2026-11-24T02:00:00.000Z',
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof MapExportDialog>> = {}) {
  const props: React.ComponentProps<typeof MapExportDialog> = {
    isOpen: true,
    onClose: vi.fn(),
    onExport: vi.fn(),
    fileBaseName: FILE_BASE,
    busy: false,
    timezone: TZ,
    rangeHours: RANGE_HOURS,
    ...overrides,
  };
  const merged = { ...props, ...overrides };
  const view = render(<MapExportDialog {...merged} />);
  return {
    ...merged,
    container: view.container,
    rerender: (next: Partial<React.ComponentProps<typeof MapExportDialog>>) =>
      view.rerender(<MapExportDialog {...merged} {...next} />),
  };
}

const fileName = () => (screen.getByTestId('export-file-name') as HTMLInputElement).value;
const openRange = () => fireEvent.click(screen.getByRole('radio', { name: /^Range/ }));

describe('MapExportDialog (SCRUM-117, SCRUM-162)', () => {
  it('is titled "Download map image" with the download artwork in its header', () => {
    const { container } = renderDialog();

    expect(screen.getByRole('dialog', { name: 'Download map image' })).toBeTruthy();
    const image = container.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toMatch(/download-icon|^data:image\/png/);
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('aria-hidden')).toBe('true');
  });

  it('starts on PNG with the generated name and reports the format and quality', () => {
    const props = renderDialog();

    expect(fileName()).toBe(`${FILE_BASE}.png`);
    expect(screen.queryByLabelText('JPEG quality')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Page size' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /JPEG/ }));
    expect(fileName()).toBe(`${FILE_BASE}.jpeg`);

    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      mode: 'view',
      format: 'jpeg',
      jpegQuality: 0.8,
      pageSize: 'letter',
      orientation: 'portrait',
      fileName: `${FILE_BASE}.jpeg`,
    });
  });

  it('offers Letter/A4 and portrait/landscape for a PDF and keeps them in the options', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    expect(fileName()).toBe(`${FILE_BASE}.pdf`);
    expect(screen.getByText(/One page: the view currently on screen/)).toBeTruthy();
    expect(screen.queryByLabelText('JPEG quality')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /A4/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      mode: 'view',
      format: 'pdf',
      jpegQuality: 0.92,
      pageSize: 'a4',
      orientation: 'landscape',
      fileName: `${FILE_BASE}.pdf`,
    });
  });

  it('lets the user edit the name, keeps one extension and cleans it on export (SCRUM-162)', () => {
    const props = renderDialog();

    const input = screen.getByLabelText('File name');
    fireEvent.change(input, { target: { value: 'my/map: 2026.png' } });
    expect(fileName()).toBe('my/map: 2026.png');

    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    expect(fileName()).toBe('my/map: 2026.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(props.onExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'view', format: 'pdf', fileName: 'mymap 2026.pdf' }),
    );
  });

  it('falls back to the generated name when the field is left empty', () => {
    const props = renderDialog();

    fireEvent.change(screen.getByLabelText('File name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: `${FILE_BASE}.png` }),
    );
  });

  it('blocks a second export while one runs and closes with Escape', () => {
    const props = renderDialog({ busy: true });

    const button = screen.getByRole('button', { name: 'Exporting…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(props.onExport).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <MapExportDialog
        isOpen={false}
        onClose={vi.fn()}
        onExport={vi.fn()}
        fileBaseName={FILE_BASE}
        busy={false}
        timezone={TZ}
        rangeHours={RANGE_HOURS}
      />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('MapExportDialog range mode (SCRUM-155)', () => {
  it('summarises the default three-hour range and exports those hours', () => {
    const props = renderDialog();

    openRange();
    expect(screen.getByTestId('range-summary').textContent).toBe(
      '3 captures from Mon 14:00 to Mon 16:00 PST',
    );
    expect(screen.queryByLabelText('File name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      mode: 'range',
      format: 'png',
      jpegQuality: 0.92,
      pageSize: 'letter',
      orientation: 'portrait',
      hours: RANGE_HOURS.slice(0, 3),
    });
  });

  it('follows the interval and the end hour the user picks', () => {
    const props = renderDialog();

    openRange();
    fireEvent.change(screen.getByLabelText('End'), { target: { value: RANGE_HOURS[4] } });
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '2' } });

    expect(screen.getByTestId('range-summary').textContent).toBe(
      '3 captures from Mon 14:00 to Mon 18:00 PST',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'range', hours: [RANGE_HOURS[0], RANGE_HOURS[2], RANGE_HOURS[4]] }),
    );
  });

  it('uses a singular summary for one capture', () => {
    renderDialog();
    openRange();
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });

    expect(screen.getByTestId('range-summary').textContent).toBe(
      '1 capture at Mon 14:00 PST',
    );
  });

  it('rejects an end before the start and keeps Export disabled', () => {
    renderDialog();
    openRange();

    fireEvent.change(screen.getByLabelText('End'), { target: { value: RANGE_HOURS[0] } });

    expect(screen.getByRole('alert').textContent).toBe('The end hour must be after the start hour.');
    const button = screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  });

  it('explains the 24-capture cap instead of capturing', () => {
    const hours = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2026, 10, 23, 22 + i)).toISOString(),
    );
    renderDialog({ rangeHours: hours });
    openRange();
    fireEvent.change(screen.getByLabelText('End'), { target: { value: hours[29] } });

    expect(screen.getByRole('alert').textContent).toContain('Too many captures (30)');
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows progress with the hour being captured and stops through Cancel', () => {
    const onCancelRange = vi.fn();
    const dialog = renderDialog();
    openRange();
    dialog.rerender({
      busy: true,
      progress: { done: 2, total: 5, time: RANGE_HOURS[1] },
      onCancelRange,
    });

    expect(screen.getByTestId('range-progress').textContent).toContain('2 of 5');
    expect(screen.getByTestId('range-progress').textContent).toContain('15:00');
    fireEvent.click(screen.getByRole('button', { name: 'Stop capturing' }));
    expect(onCancelRange).toHaveBeenCalledTimes(1);
  });

  it('names the failing hour and offers the frames captured so far', () => {
    const onSaveCaptured = vi.fn();
    renderDialog({
      error: { message: 'Could not capture Mon 16:00 PST: its grid data did not arrive in time', frames: 2 },
      onSaveCaptured,
    });
    openRange();

    expect(screen.getByTestId('range-error').textContent).toContain('Mon 16:00 PST');
    fireEvent.click(screen.getByRole('button', { name: 'Save captured frames (2)' }));
    expect(onSaveCaptured).toHaveBeenCalledTimes(1);
  });

  it('sends JPEG with its quality for a ZIP range', () => {
    const props = renderDialog();
    openRange();

    fireEvent.click(screen.getByRole('radio', { name: /JPEG/ }));
    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'range', format: 'jpeg', jpegQuality: 0.8 }),
    );
  });

  it('offers a multi-page PDF with page size and orientation for a range (SCRUM-156)', () => {
    const props = renderDialog();
    openRange();

    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    expect(screen.getByText(/One page per hour/)).toBeTruthy();
    expect(screen.queryByLabelText('File name')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /A4/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      mode: 'range',
      format: 'pdf',
      jpegQuality: 0.92,
      pageSize: 'a4',
      orientation: 'landscape',
      hours: RANGE_HOURS.slice(0, 3),
    });
  });
});
