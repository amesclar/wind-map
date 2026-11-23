import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapExportControl } from './MapExportControl';

describe('MapExportControl (SCRUM-116, SCRUM-117, SCRUM-157)', () => {
  it('opens the export dialog from the icon-only trigger', () => {
    const onOpen = vi.fn();
    render(<MapExportControl onOpen={onOpen} busy={false} />);

    const button = screen.getByRole('button', { name: 'Export map image' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('title')).toBe('Export map image');
    expect(button.textContent).toBe('');

    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the supplied download artwork as a 16px decorative image', () => {
    const { container } = render(<MapExportControl onOpen={vi.fn()} busy={false} />);

    const image = container.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toMatch(/download-icon|^data:image\/png/);
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('aria-hidden')).toBe('true');
    expect(image.className).toContain('w-4');
    expect(image.className).toContain('h-4');
    expect(image.className).toContain('object-contain');
  });

  it('blocks a second export while one runs and cannot open the dialog', () => {
    const onOpen = vi.fn();
    render(<MapExportControl onOpen={onOpen} busy />);

    const button = screen.getByRole('button', { name: 'Exporting…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
