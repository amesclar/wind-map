/** Vitest setup (SCRUM-92 phase 2): runs before every test file. */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests. RTL only does this automatically with `globals: true`.
afterEach(() => {
  cleanup();
});
