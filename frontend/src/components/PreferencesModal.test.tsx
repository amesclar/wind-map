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
