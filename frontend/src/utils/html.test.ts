import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml (SCRUM-92)', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Oak Harbor, WA — 48.29°')).toBe('Oak Harbor, WA — 48.29°');
  });

  it('renders null and undefined as empty strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
