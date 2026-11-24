/*
 * Drafts of an instance's game window and launch commands as typed on its Settings tab,
 * and what they save as. The cards are in components/InstanceLaunchSettings.tsx.
 */

/** Sizes as typed: "" is Minecraft's own. */
export type WindowDraft = { own: boolean; width: string; height: string; fullscreen: boolean };

export const windowDraftOf = (window?: GameWindow | null): WindowDraft => ({
  own: Boolean(window),
  width: window?.width ? String(window.width) : "",
  height: window?.height ? String(window.height) : "",
  fullscreen: Boolean(window?.fullscreen),
});

export function windowFromDraft(draft: WindowDraft): GameWindow | null {
  if (!draft.own) return null;
  // Fullscreen saves with a size typed wrongly: the size is dropped.
  const sized = Boolean(draft.width.trim()) && !windowSizeError(draft.width, draft.height);
  return { width: sized ? Number(draft.width) : null, height: sized ? Number(draft.height) : null, fullscreen: draft.fullscreen };
}

/* What's wrong with a typed size, if anything. */
export function windowSizeError(width: string, height: string): string | null {
  const w = width.trim();
  const h = height.trim();
  if (!w && !h) return null;
  if (!w || !h) return "Fill in both the width and the height, or leave both blank.";
  for (const value of [w, h]) {
    const size = Number(value);
    if (!/^\d+$/.test(value) || size < 320 || size > 7680) return "A window size has to be a whole number between 320 and 7680 pixels.";
  }
  return null;
}

/** Variables as rows, so a half-typed one keeps its place. */
export type HooksDraft = { preLaunch: string; wrapper: string; postExit: string; env: { name: string; value: string }[] };

export const hooksDraftOf = (hooks?: LaunchHooks | null): HooksDraft => ({
  preLaunch: hooks?.preLaunch ?? "",
  wrapper: hooks?.wrapper ?? "",
  postExit: hooks?.postExit ?? "",
  env: Object.entries(hooks?.env ?? {}).map(([name, value]) => ({ name, value })),
});

export const hooksFromDraft = (draft: HooksDraft): LaunchHooks => ({
  preLaunch: draft.preLaunch.trim(),
  wrapper: draft.wrapper.trim(),
  postExit: draft.postExit.trim(),
  env: Object.fromEntries(draft.env.filter((variable) => variable.name.trim()).map((variable) => [variable.name.trim(), variable.value])),
});

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/* What's wrong with the typed variables, if anything. */
export function hooksError(draft: HooksDraft): string | null {
  const names = draft.env.map((variable) => variable.name.trim()).filter(Boolean);
  const bad = names.find((name) => !ENV_NAME.test(name));
  if (bad) return `"${bad}" can't be a variable's name. Use letters, digits and _, not starting with a digit.`;
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice) return `${twice} is listed twice.`;
  return null;
}
