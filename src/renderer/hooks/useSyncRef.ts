import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

// Mirror a value into a ref so a stable closure (an IPC listener, a setInterval
// callback, etc.) can read the LATEST value without being torn down on every
// render. Equivalent to:
//
//     const ref = useRef(value);
//     useEffect(() => { ref.current = value; }, [value]);
//
// Use this when an effect must subscribe ONCE per scope (e.g. a workspace, a
// dialog open) but its handler needs to react to fresh state. The alternative
// — including the value in the effect's dep array — causes the effect to
// re-run on every change, which can race with timers set inside the handler.
// See `src/renderer/App.jsx`'s fs:changed listener for the canonical example.
export function useSyncRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}
