/*
 * Anything that changes who's signed in (signing in, signing out, removing or switching an
 * account) tells every account switcher to look again. The desktop app also sends
 * account:changed from the main process; this covers pages that call the bridge directly and
 * the web preview, whose stand-in bridge sends nothing.
 */
export const ACCOUNTS_EVENT = "unity:accounts-changed";

const WATCHED: [string, string][] = [
  ["launcherAPI", "loginMicrosoft"],
  ["instanceAPI", "clearAccount"],
  ["instanceAPI", "removeAccount"],
  ["instanceAPI", "switchAccount"],
];

type Fn = ((...args: unknown[]) => unknown) & { __accountsWatched?: boolean };

/** Wraps those bridge calls so they announce a change when they finish. Safe to call twice. */
export function watchAccountChanges() {
  for (const [bridgeName, method] of WATCHED) {
    const bridge = (window as unknown as Record<string, Record<string, unknown> | undefined>)[bridgeName];
    const original = bridge?.[method] as Fn | undefined;
    if (!bridge || typeof original !== "function" || original.__accountsWatched) continue;
    const wrapped: Fn = async (...args: unknown[]) => {
      try {
        return await original.apply(bridge, args);
      } finally {
        window.dispatchEvent(new Event(ACCOUNTS_EVENT));
      }
    };
    wrapped.__accountsWatched = true;
    try {
      bridge[method] = wrapped;
    } catch {
      // A frozen bridge (the desktop app's): its main process announces changes itself.
    }
  }
}
