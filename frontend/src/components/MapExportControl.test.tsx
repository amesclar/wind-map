import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapExportControl } from './MapExportControl';

describe('MapExportControl (SCRUM-116, SCRUM-117)', () => {
  it('opens the export dialog from the button', () => {
    const onOpen = vi.fn();
    render(<MapExportControl onOpen={onOpen} busy={false} />);

    fireEvent.click(screen.getByTitle('Save the map as an image'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('blocks a second export while one runs and cannot open the dialog', () => {
    const onOpen = vi.fn();
    render(<MapExportControl onOpen={onOpen} busy />);

    const button = screen.getByTitle('Save the map as an image') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Saving');

    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
