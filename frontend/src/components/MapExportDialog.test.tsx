import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapExportDialog } from './MapExportDialog';

const FILE_BASE = 'wind-map_2026-11-18_1400PST';

function renderDialog(overrides: Partial<React.ComponentProps<typeof MapExportDialog>> = {}) {
  const props: React.ComponentProps<typeof MapExportDialog> = {
    isOpen: true,
    onClose: vi.fn(),
    onExport: vi.fn(),
    fileBaseName: FILE_BASE,
    busy: false,
    ...overrides,
  };
  const view = render(<MapExportDialog {...props} />);
  return { ...props, container: view.container };
}

const fileName = () => (screen.getByTestId('export-file-name') as HTMLInputElement).value;

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
      expect.objectContaining({ format: 'pdf', fileName: 'mymap 2026.pdf' }),
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
      />,
    );

    expect(container.innerHTML).toBe('');
  });
});
