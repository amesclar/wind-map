import { useCallback, useState } from 'react';
import { deleteLocation, fetchLocations } from '../api/client';
import type { SavedLocation } from '../types';

/**
 * Saved locations: load and delete. Nothing is added any more (SCRUM-344): the search box looks a
 * place up for the session instead, so this hook only reads and removes the rows that already exist.
 */
export function useLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);

  const load = useCallback(async () => {
    const saved = await fetchLocations();
    setLocations(saved);
    return saved;
  }, []);

  /** Deletes a location and returns the list without it. */
  const remove = useCallback(
    async (id: number) => {
      await deleteLocation(id);
      const remaining = locations.filter((l) => l.id !== id);
      setLocations((prev) => prev.filter((l) => l.id !== id));
      return remaining;
    },
    [locations],
  );

  return { locations, load, remove };
}
