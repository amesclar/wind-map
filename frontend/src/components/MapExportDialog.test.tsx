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
/** The checkbox for one of the window's times (SCRUM-332). */
const tickTime = (time: string) =>
  fireEvent.click(screen.getByTestId(`export-time-${time}`).querySelector('input')!);

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
      orientation: 'landscape',
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

  it('opens a PDF on landscape and still lets the user pick portrait (SCRUM-243)', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    expect(screen.getByRole('radio', { name: 'Landscape' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Portrait' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(props.onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'pdf', orientation: 'landscape' }),
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Portrait' }));
    expect(screen.getByRole('radio', { name: 'Portrait' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(props.onExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'pdf', orientation: 'portrait' }),
    );
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
      '3 captures: Mon 14:00, Mon 15:00, Mon 16:00 PST',
    );
    expect(screen.getByTestId('export-times-count').textContent).toContain('3 of 5 chosen');
    expect(screen.queryByLabelText('File name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      mode: 'range',
      format: 'png',
      jpegQuality: 0.92,
      pageSize: 'letter',
      orientation: 'landscape',
      hours: RANGE_HOURS.slice(0, 3),
    });
  });

  it('captures exactly the times the user ticks, allowing a gap', () => {
    const props = renderDialog();

    openRange();
    tickTime(RANGE_HOURS[1]); // untick the middle
    tickTime(RANGE_HOURS[4]); // tick a later one

    expect(screen.getByTestId('range-summary').textContent).toBe(
      '3 captures: Mon 14:00, Mon 16:00, Mon 18:00 PST',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'range', hours: [RANGE_HOURS[0], RANGE_HOURS[2], RANGE_HOURS[4]] }),
    );
  });

  it('selects every time and clears them again', () => {
    const props = renderDialog();
    openRange();

    fireEvent.click(screen.getByTestId('export-times-all'));
    expect(screen.getByTestId('export-times-count').textContent).toContain('5 of 5 chosen');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(props.onExport).toHaveBeenCalledWith(
      expect.objectContaining({ hours: RANGE_HOURS }),
    );

    fireEvent.click(screen.getByTestId('export-times-none'));
    expect(screen.getByRole('alert').textContent).toBe('Choose at least one time to capture.');
  });

  it('uses a singular summary for one time', () => {
    renderDialog();
    openRange();
    fireEvent.click(screen.getByTestId('export-times-none'));
    tickTime(RANGE_HOURS[0]);

    expect(screen.getByTestId('range-summary').textContent).toBe(
      '1 capture at Mon 14:00 PST',
    );
  });

  it('refuses an empty selection and keeps Export disabled', () => {
    renderDialog();
    openRange();

    fireEvent.click(screen.getByTestId('export-times-none'));

    expect(screen.getByRole('alert').textContent).toBe('Choose at least one time to capture.');
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
    fireEvent.click(screen.getByTestId('export-times-all'));

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
    // Portrait stays selectable in range mode too, even though landscape is the default.
    fireEvent.click(screen.getByRole('radio', { name: 'Portrait' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      mode: 'range',
      format: 'pdf',
      jpegQuality: 0.92,
      pageSize: 'a4',
      orientation: 'portrait',
      hours: RANGE_HOURS.slice(0, 3),
    });
  });

  it('disables the Export button and shows a banner when export is disabled (SCRUM-311)', () => {
    renderDialog({
      disabled: true,
      disabledReason: 'Map image/PDF export is disabled on Google Maps due to licensing restrictions.',
    });

    const banner = screen.getByTestId('export-disabled-banner');
    expect(banner.textContent).toContain('export is disabled on Google Maps');

    const button = screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toContain('export is disabled on Google Maps');
  });
});

describe('MapExportDialog tile budget (SCRUM-299)', () => {
  /** A full day of hourly captures: the largest range the capture cap allows. */
  const HOURS_24 = Array.from({ length: 24 }, (_, index) =>
    new Date(Date.parse('2026-11-23T22:00:00.000Z') + index * 3_600_000).toISOString(),
  );
  const exportButton = () => screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;
  const chooseFullDay = () => {
    openRange();
    fireEvent.click(screen.getByTestId('export-times-all'));
  };

  it('refuses a full-day range on a 4K window and says why', () => {
    renderDialog({ rangeHours: HOURS_24, viewportTiles: 135 });
    chooseFullDay();

    expect(screen.getByTestId('range-summary').textContent).toContain('Too many tiles (3,240)');
    expect(exportButton().disabled).toBe(true);
  });

  it('allows the same full-day range on a 1080p window', () => {
    renderDialog({ rangeHours: HOURS_24, viewportTiles: 40 });
    chooseFullDay();

    expect(screen.getByTestId('range-summary').textContent).toContain('24 captures');
    expect(exportButton().disabled).toBe(false);
  });
});

// SCRUM-333: the OpenStreetMap terms permit current-view viewing only, so the range mode is refused.
describe('MapExportDialog range export on OpenStreetMap bases (SCRUM-333)', () => {
  const REASON =
    'Time-lapsed exports not supported on the OpenStreetMap base maps: their terms permit current-view viewing only. Switch to CARTO, NOAA or Seamap to export a range.';
  const rangeRadio = () => screen.getByRole('radio', { name: /^Range/ }) as HTMLButtonElement;
  const viewRadio = () => screen.getByRole('radio', { name: /^Current view/ }) as HTMLButtonElement;

  it('disables the range mode and says why, leaving the view export alone', () => {
    renderDialog({ rangeDisabledReason: REASON });

    expect(rangeRadio().disabled).toBe(true);
    expect(rangeRadio().getAttribute('title')).toContain('Time-lapsed exports');
    expect(screen.getByTestId('export-range-disabled-note').textContent).toContain(
      'Time-lapsed',
    );

    expect(viewRadio().disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('falls back to the view mode if the restriction arrives while range is chosen', () => {
    const { rerender } = renderDialog();
    openRange();
    expect(rangeRadio().getAttribute('aria-checked')).toBe('true');

    rerender({ rangeDisabledReason: REASON });

    expect(viewRadio().getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('range-summary')).toBeNull();
  });
});
