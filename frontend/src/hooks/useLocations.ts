import { useCallback, useState } from 'react';
import { addLocation, deleteLocation, fetchLocations } from '../api/client';
import type { NewLocation, SavedLocation } from '../types';

/** Saved locations: load, add (the backend may return an existing nearby one) and delete. */
export function useLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);

  const load = useCallback(async () => {
    const saved = await fetchLocations();
    setLocations(saved);
    return saved;
  }, []);

  /** Adds a location. `position` controls where a newly created one is listed. */
  const add = useCallback(async (data: NewLocation, position: 'first' | 'last' = 'last') => {
    const created = await addLocation(data);
    setLocations((prev) => {
      const others = prev.filter((l) => l.id !== created.id);
      if (others.length !== prev.length && position === 'first') return prev; // already listed
      return position === 'first' ? [created, ...others] : [...others, created];
    });
    return created;
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

  return { locations, load, add, remove };
}
