import { useSyncExternalStore } from "react";
import "./displayMode.css";

/*
 * Full screen, Big screen and the controller switch. Big screen and the controller are kept
 * in localStorage: they belong to this computer's screen, not to an account.
 */

const BIG_KEY = "launcher.bigScreen";
const PAD_KEY = "launcher.controller";
/** Big screen's zoom: everything a quarter larger, for a TV across the room. */
export const BIG_ZOOM = 1.25;

export type DisplayState = {
  fullScreen: boolean;
  bigScreen: boolean;
  /** Whether a controller moves around the launcher (on unless turned off). */
  controller: boolean;
  /** The connected controller's name, if any. */
  pad: string | null;
};

const read = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
};
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Private mode or full: the switch still works until the launcher closes.
  }
};

let state: DisplayState = { fullScreen: false, bigScreen: read(BIG_KEY, false), controller: read(PAD_KEY, true), pad: null };
const listeners = new Set<() => void>();
const update = (patch: Partial<DisplayState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const displayState = () => state;
export const useDisplayMode = () => useSyncExternalStore(subscribe, displayState);

function applyZoom(on: boolean) {
  document.documentElement.classList.toggle("is-big-screen", on);
  // The app zooms the page itself; a browser (the web preview) gets CSS zoom instead.
  if (window.displayAPI) window.displayAPI.setZoom(on ? BIG_ZOOM : 1);
  else document.documentElement.style.zoom = on ? String(BIG_ZOOM) : "";
}

export function setBigScreen(on: boolean) {
  write(BIG_KEY, on);
  applyZoom(on);
  update({ bigScreen: on });
}

export function setControllerOn(on: boolean) {
  write(PAD_KEY, on);
  update({ controller: on });
}

export const setPadName = (pad: string | null) => update({ pad });

/* Into or out of full screen: the window itself in the app, the page in a browser. */
export async function setFullScreen(on: boolean) {
  try {
    if (window.displayAPI) {
      await window.displayAPI.fullScreen(on);
    } else if (on && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } else if (!on && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    // A browser refuses without a click or key press first: nothing changes.
  }
}
export const toggleFullScreen = () => setFullScreen(!state.fullScreen);

let started = false;
/* Once, as the launcher starts: puts Big screen back and follows full screen. */
export function initDisplayMode() {
  if (started) return;
  started = true;
  if (state.bigScreen) applyZoom(true);
  if (window.displayAPI) {
    window.displayAPI.onFullScreen((on) => update({ fullScreen: on }));
    window.displayAPI
      .fullScreen()
      .then((on) => update({ fullScreen: on }))
      .catch(() => {});
  } else {
    document.addEventListener("fullscreenchange", () => update({ fullScreen: Boolean(document.fullscreenElement) }));
  }
  window.addEventListener("keydown", (event) => {
    if (event.key !== "F11" || event.defaultPrevented) return;
    event.preventDefault();
    void toggleFullScreen();
  });
}
