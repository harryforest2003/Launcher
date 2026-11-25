/* When the first-run welcome (Welcome.tsx) shows. */

export const WELCOMED_KEY = "unity.welcomed";
export const WELCOME_EVENT = "unity:welcome";

/* Kept only once the launcher has been used (the theme is left out: it's saved at start). */
const USED_BEFORE = ["unity-launcher-sidebar", "unity-mods-dense", "library-view", "library-group-by", "launcher.controller", "launcher.bigScreen"];

/* A first run: never welcomed, and nothing else the launcher keeps in this browser yet. */
export function isFirstRun() {
  try {
    if (localStorage.getItem(WELCOMED_KEY)) return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (key.startsWith("unity.") || USED_BEFORE.includes(key)) {
        // Someone who used the launcher before this existed: don't greet them as new.
        localStorage.setItem(WELCOMED_KEY, "1");
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function showWelcomeAgain() {
  window.dispatchEvent(new Event(WELCOME_EVENT));
}
