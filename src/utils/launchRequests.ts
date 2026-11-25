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

/*
 * An instance another page asked the Library to open on its own page (Home's drawer, the
 * search palette). Kept until the Library is on screen, like a launch request.
 */
let pendingOpen: string | null = null;
const openListeners = new Set<(name: string) => void>();

export function requestOpenInstance(name: string) {
  if (openListeners.size) openListeners.forEach((listener) => listener(name));
  else pendingOpen = name;
}

export function onOpenInstanceRequest(listener: (name: string) => void) {
  openListeners.add(listener);
  if (pendingOpen) {
    const name = pendingOpen;
    pendingOpen = null;
    queueMicrotask(() => listener(name));
  }
  return () => {
    openListeners.delete(listener);
  };
}

/*
 * A mod the search palette found: that game's Mods page opens searching for it. Kept per
 * game until its Mods page is on screen.
 */
const pendingModSearch = new Map<string, string>();
const modSearchListeners = new Map<string, Set<(text: string) => void>>();

export function requestModSearch(gameId: string, text: string) {
  const listeners = modSearchListeners.get(gameId);
  if (listeners?.size) listeners.forEach((listener) => listener(text));
  else pendingModSearch.set(gameId, text);
}

export function onModSearchRequest(gameId: string, listener: (text: string) => void) {
  const listeners = modSearchListeners.get(gameId) ?? new Set();
  modSearchListeners.set(gameId, listeners);
  listeners.add(listener);
  const text = pendingModSearch.get(gameId);
  if (text !== undefined) {
    pendingModSearch.delete(gameId);
    queueMicrotask(() => listener(text));
  }
  return () => {
    listeners.delete(listener);
  };
}
