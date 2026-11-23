import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatQuotaReset, QuotaWarningDialog } from './QuotaWarningDialog';

const renderDialog = (resetAt: string | null, isOpen = true, onClose = vi.fn()) =>
  render(<QuotaWarningDialog isOpen={isOpen} onClose={onClose} resetAt={resetAt} timezone="America/Los_Angeles" />);

describe('QuotaWarningDialog (SCRUM-170)', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog(null, false);
    expect(container.firstChild).toBeNull();
  });

  it('names the reset time in the user timezone', () => {
    renderDialog('2026-11-24T00:00:29Z');

    expect(screen.getByRole('dialog', { name: 'Wind data temporarily unavailable' })).toBeTruthy();
    expect(screen.getByText(/Open-Meteo's request limit has been reached/)).toBeTruthy();
    const reset = formatQuotaReset('2026-11-24T00:00:29Z', 'America/Los_Angeles');
    expect(reset).toContain('4:00 PM');
    expect(screen.getByText(`Wind data should return at ${reset}.`)).toBeTruthy();
    expect(screen.getByText(/saved locations, units and preferences are unaffected/)).toBeTruthy();
  });

  it('still explains the limit when the upstream sent no reset time', () => {
    renderDialog(null);

    expect(screen.getByText("Wind data will return when Open-Meteo's limit resets.")).toBeTruthy();
  });

  it('closes from Done', () => {
    const onClose = vi.fn();
    renderDialog('2026-11-24T00:00:29Z', true, onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
