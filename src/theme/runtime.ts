/*
 * Puts the user's palette on the page and keeps it.
 *
 * - startTheme() runs first thing in main.tsx, before React renders anything, from a copy kept
 *   in localStorage, so the launcher opens in its own colours with no flash of the default.
 * - The same settings are also saved with the launcher's settings (launcher-settings.json via
 *   instanceAPI.setSettings), which survives a cleared cache; on start the two are reconciled.
 * - Colours are set as custom properties through the CSSOM (style.setProperty), which a strict
 *   Content-Security-Policy allows; no <style> element is injected.
 */

import { useSyncExternalStore } from "react";
import { ACCESS_KEYS, buildPalette, DEFAULT_THEME, normaliseTheme, paletteToCssVars, type Palette, type ThemeSettings } from "./engine.ts";

const STORAGE_KEY = "unity-launcher-theme";
const RECENT_KEY = "unity-launcher-theme-recent";
const SAVE_DELAY = 400;

type State = { settings: ThemeSettings; palette: Palette; saved: boolean };

const listeners = new Set<() => void>();
let state: State | null = null;
let saveTimer = 0;

const darkQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

function readLocal(): ThemeSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normaliseTheme(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(settings: ThemeSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Without storage the colour still applies now; the launcher settings file keeps it.
  }
}

/* The launcher settings file stores anything it is given; `theme` is this file's key in it. */
type WithTheme = { theme?: unknown };

async function readSaved(): Promise<ThemeSettings | null> {
  try {
    const settings = (await window.instanceAPI?.getSettings?.()) as (LauncherSettings & WithTheme) | undefined;
    return settings?.theme ? normaliseTheme(settings.theme) : null;
  } catch {
    return null;
  }
}

async function writeSaved(settings: ThemeSettings) {
  await window.instanceAPI?.setSettings?.({ theme: settings } as Partial<LauncherSettings> & WithTheme);
}

function paint(palette: Palette, settings: ThemeSettings) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(paletteToCssVars(palette))) root.style.setProperty(name, value);
  root.style.setProperty("color-scheme", palette.scheme);
  root.dataset.theme = palette.scheme;
  // Reading settings are plain attributes the stylesheets key off (see reading.css).
  root.dataset.font = settings.font;
  root.dataset.spacing = settings.spacing;
  root.dataset.vision = settings.vision;
}

function emit() {
  for (const listener of listeners) listener();
}

function set(settings: ThemeSettings, saved: boolean) {
  const palette = buildPalette(settings, darkQuery()?.matches ?? true);
  state = { settings, palette, saved };
  // Setting the properties is cheap and the browser restyles once per frame anyway, so this
  // paints straight away (also in a window that is hidden, where frames don't run).
  paint(palette, settings);
  emit();
}

function same(a: ThemeSettings, b: ThemeSettings) {
  return (Object.keys(DEFAULT_THEME) as (keyof ThemeSettings)[]).every((key) => a[key] === b[key]);
}

/** Applies the saved theme straight away. Call once, before the first render. */
export function startTheme() {
  if (state) return;
  const local = readLocal() ?? DEFAULT_THEME;
  state = { settings: local, palette: buildPalette(local, darkQuery()?.matches ?? true), saved: true };
  paint(state.palette, local);

  // "Same as system" follows the OS while the launcher is open.
  darkQuery()?.addEventListener?.("change", () => {
    if (state?.settings.mode === "system") set(state.settings, state.saved);
  });

  // The settings file is the lasting copy: adopt it if it differs, or seed it from this one.
  void readSaved().then((fromFile) => {
    if (!state) return;
    if (fromFile && !same(fromFile, state.settings)) {
      writeLocal(fromFile);
      set(fromFile, true);
    } else if (!fromFile && readLocal()) {
      void writeSaved(state.settings).catch(() => {});
    }
  });
}

/** Changes the theme now; it is saved shortly after the last change (so dragging saves once). */
export function updateTheme(patch: Partial<ThemeSettings>) {
  if (!state) startTheme();
  const next = normaliseTheme({ ...state!.settings, ...patch });
  if (same(next, state!.settings)) return;
  set(next, false);
  writeLocal(next);

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const settings = state!.settings;
    writeSaved(settings)
      .then(() => {
        if (state && same(state.settings, settings)) {
          state = { ...state, saved: true };
          emit();
        }
      })
      .catch(() => {
        // Kept in local storage still; the next change tries the settings file again.
      });
  }, SAVE_DELAY);
}

/** Back to the launcher's own look. How someone sees and reads (colour vision, font, spacing) stays. */
export function resetTheme() {
  const keep = Object.fromEntries(ACCESS_KEYS.map((key) => [key, state?.settings[key] ?? DEFAULT_THEME[key]]));
  updateTheme({ ...DEFAULT_THEME, ...keep });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): State {
  if (!state) startTheme();
  return state!;
}

/** The current theme settings, palette and whether the last change has been saved. */
export function useTheme() {
  return useSyncExternalStore(subscribe, snapshot);
}

/* ---------------- recent colours (a convenience, so local storage only) ---------------- */

export function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && /^#[0-9a-f]{6}$/.test(x)).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(hex: string): string[] {
  const list = [hex, ...readRecent().filter((x) => x !== hex)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Not remembered this time.
  }
  return list;
}
