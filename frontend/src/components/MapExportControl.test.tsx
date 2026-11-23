import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapExportControl } from './MapExportControl';

describe('MapExportControl (SCRUM-116)', () => {
  it('offers PNG and JPEG and reports the chosen format', () => {
    const onSave = vi.fn();
    render(<MapExportControl onSave={onSave} busy={false} />);

    fireEvent.click(screen.getByTitle('Save the map as an image'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PNG' }));
    expect(onSave).toHaveBeenCalledWith('png');

    fireEvent.click(screen.getByTitle('Save the map as an image'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'JPEG' }));
    expect(onSave).toHaveBeenLastCalledWith('jpeg');
  });

  it('closes the menu with Escape', () => {
    render(<MapExportControl onSave={vi.fn()} busy={false} />);
    fireEvent.click(screen.getByTitle('Save the map as an image'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows progress and blocks a second capture while saving', () => {
    render(<MapExportControl onSave={vi.fn()} busy />);
    const button = screen.getByTitle('Save the map as an image') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Saving');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
