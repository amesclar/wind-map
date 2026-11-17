import { useCallback, useState } from 'react';

/**
 * useState backed by localStorage. `parse` turns the stored string (or null when unset)
 * into a value and should fall back to a default for anything unexpected; `serialize`
 * returns the string to store, or null to remove the key.
 */
export function useLocalStorageState<T>(
  key: string,
  parse: (stored: string | null) => T,
  serialize: (value: T) => string | null = (value) => String(value),
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => parse(readStorage(key)));

  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeStorage(key, serialize(next));
    },
    [key, serialize],
  );

  return [value, set];
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage disabled (e.g. privacy mode)
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage disabled: keep the in-memory value only
  }
}
