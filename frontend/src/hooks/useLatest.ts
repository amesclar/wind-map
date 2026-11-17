import { useEffect, useRef } from 'react';

/** A ref that always holds the latest value. Lets long-lived listeners (Leaflet events,
 * async callbacks) call the current handler without re-registering. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
