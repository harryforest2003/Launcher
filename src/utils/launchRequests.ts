/*
 * An instance a desktop shortcut asked to play. The app passes it on and opens the
 * Library, which plays it once it's on screen (it waits here until then).
 */

let pending: string | null = null;
const listeners = new Set<(name: string) => void>();

export function requestLaunch(name: string) {
  if (listeners.size) listeners.forEach((listener) => listener(name));
  else pending = name;
}

export function onLaunchRequest(listener: (name: string) => void) {
  listeners.add(listener);
  if (pending) {
    const name = pending;
    pending = null;
    queueMicrotask(() => listener(name));
  }
  return () => {
    listeners.delete(listener);
  };
}
