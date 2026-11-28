import { useCallback, useState } from 'react';
import { fetchLocations } from '../api/client';
import type { SavedLocation } from '../types';

/**
 * The saved rows behind the map markers: load only. Nothing adds a location (SCRUM-344) and nothing
 * deletes one (SCRUM-345), so this is a read: the rows already in the database stay readable.
 */
export function useLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);

  const load = useCallback(async () => {
    const saved = await fetchLocations();
    setLocations(saved);
    return saved;
  }, []);

  return { locations, load };
}
