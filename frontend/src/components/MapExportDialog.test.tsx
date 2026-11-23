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
  render(<MapExportDialog {...props} />);
  return props;
}

const fileName = () => screen.getByTestId('export-file-name').textContent;

describe('MapExportDialog (SCRUM-117)', () => {
  it('starts on PNG and previews the name the export will use', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Export map image' })).toBeTruthy();
    expect(fileName()).toBe(`${FILE_BASE}.png`);
    expect(screen.queryByLabelText('JPEG quality')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Page size' })).toBeNull();
  });

  it('reports the chosen format and JPEG quality', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: /JPEG/ }));
    expect(fileName()).toBe(`${FILE_BASE}.jpeg`);

    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(props.onExport).toHaveBeenCalledWith({
      format: 'jpeg',
      jpegQuality: 0.8,
      pageSize: 'letter',
      orientation: 'portrait',
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
    });
  });

  it('blocks a second export while one runs', () => {
    const props = renderDialog({ busy: true });

    const button = screen.getByRole('button', { name: 'Exporting…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(props.onExport).not.toHaveBeenCalled();
  });

  it('closes with Escape', () => {
    const props = renderDialog();

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
