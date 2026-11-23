import { useSyncExternalStore } from "react";

/*
 * The launcher's own updates (electron/updater.cjs), shared by the sidebar's "Update ready"
 * and Settings. The main process downloads a newer build by itself; restarting puts it in.
 */

const NONE: AppUpdateState = { status: "unsupported", current: null };

let state: AppUpdateState = NONE;
let started = false;
const listeners = new Set<() => void>();

const publish = (next: AppUpdateState) => {
  state = next;
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started && window.updaterAPI) {
    started = true;
    window.updaterAPI.onState(publish);
    window.updaterAPI.state().then(publish, () => {});
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useAppUpdate() {
  return useSyncExternalStore(subscribe, () => state);
}

export const restartToUpdate = () => window.updaterAPI?.restart();

export const checkForUpdate = () => window.updaterAPI?.check().then(publish, () => {});
