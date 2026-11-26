import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesModal } from './PreferencesModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof PreferencesModal>> = {}) {
  const props: React.ComponentProps<typeof PreferencesModal> = {
    isOpen: true,
    onClose: vi.fn(),
    timezone: 'America/Denver',
    onSelectTimezone: vi.fn(),
    unitSystem: 'metric',
    onSelectUnitSystem: vi.fn(),
    speedUnit: 'mph',
    onSelectSpeedUnit: vi.fn(),
    dirDisplay: 'deg',
    onSelectDirDisplay: vi.fn(),
    ...overrides,
  };
  const result = render(<PreferencesModal {...props} />);
  return { props, ...result };
}

describe('PreferencesModal (SCRUM-107)', () => {
  it('renders nothing when closed', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows each control with the current value', () => {
    renderModal();
    expect((screen.getByLabelText('Timezone') as HTMLSelectElement).value).toBe('America/Denver');
    expect((screen.getByLabelText('Wind speed') as HTMLSelectElement).value).toBe('mph');
    expect((screen.getByLabelText('Wind direction display') as HTMLSelectElement).value).toBe('deg');
    expect(screen.getByRole('radio', { name: '°C' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '°F' }).getAttribute('aria-checked')).toBe('false');
  });

  it('calls each setter', () => {
    const { props } = renderModal();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'UTC' } });
    fireEvent.click(screen.getByRole('radio', { name: '°F' }));
    fireEvent.change(screen.getByLabelText('Wind speed'), { target: { value: 'ms' } });
    fireEvent.change(screen.getByLabelText('Wind direction display'), { target: { value: 'cardinal' } });

    expect(props.onSelectTimezone).toHaveBeenCalledWith('UTC');
    expect(props.onSelectUnitSystem).toHaveBeenCalledWith('imperial');
    expect(props.onSelectSpeedUnit).toHaveBeenCalledWith('ms');
    expect(props.onSelectDirDisplay).toHaveBeenCalledWith('cardinal');
  });

  it('closes with the X button', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByLabelText('Close preferences'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with the Done button', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Done'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PreferencesModal direction hint (SCRUM-239)', () => {
  it('says the direction display only affects the barb details pop-up', () => {
    renderModal();
    const select = screen.getByLabelText('Wind direction display');
    const hint = screen.getByText("Only shown in a barb's details pop-up.");

    expect(hint.id).toBe('pref-direction-hint');
    expect(select.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('keeps the hint in the scrolling body, away from the Done button', () => {
    renderModal();
    const hint = screen.getByText("Only shown in a barb's details pop-up.");
    const body = hint.closest('.overflow-y-auto');

    expect(body).toBeTruthy();
    expect(body!.contains(screen.getByText('Done'))).toBe(false);
  });

  it('leaves the label and the three option labels as they were', () => {
    const { props } = renderModal();
    const select = screen.getByLabelText('Wind direction display') as HTMLSelectElement;

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Barbs (feathers)',
      'Cardinal (N, SW)',
      'Degrees (0°-360°)',
    ]);
    fireEvent.change(select, { target: { value: 'barb' } });
    expect(props.onSelectDirDisplay).toHaveBeenCalledWith('barb');
  });
});
