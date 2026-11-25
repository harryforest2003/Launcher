/* The shortcut key's name in tips and hints: ⌘ on a Mac, Ctrl+ elsewhere. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl+";
