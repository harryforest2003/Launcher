import { useCallback, useEffect, useMemo, useState } from "react";

const LOADERS: Record<string, string> = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "Vanilla" };

/** "fabric" -> "Fabric", "neoforge" -> "NeoForge"; none -> "Vanilla". */
export const loaderName = (loader: string | undefined) => (loader ? LOADERS[loader.toLowerCase()] ?? loader : "Vanilla");

/* Most recently played first; never-played ones after, by name. */
export function byLastPlayed(a: { name: string; lastPlayed?: string }, b: { name: string; lastPlayed?: string }) {
  if (a.lastPlayed && b.lastPlayed) return b.lastPlayed.localeCompare(a.lastPlayed);
  if (a.lastPlayed) return -1;
  if (b.lastPlayed) return 1;
  return a.name.localeCompare(b.name);
}

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Minecraft's instances, most recently played first, and starting one: shared by Home and the
 * Minecraft home so both launch the same way. Several can be open at once, each as its own
 * account. The list refreshes when a game starts or closes, so "Running" and "played just now"
 * stay true.
 */
export function useInstances() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      Promise.resolve(window.launcherAPI?.getInstances?.())
        .then((list) => setInstances(Array.isArray(list) ? list : []))
        .catch((err) => {
          console.error("Failed to load instances:", err);
          setInstances([]);
        })
        .finally(() => setLoaded(true)),
    []
  );

  useEffect(() => {
    reload();
    const offs = [window.instanceAPI?.onExit?.(() => reload()), window.instanceAPI?.onStarted?.(() => reload())];
    return () => offs.forEach((off) => off?.());
  }, [reload]);

  /** accountId: a signed-in account to play as; left out, the active one. */
  const launch = useCallback(
    async (instance: Instance, accountId?: string) => {
      setStarting(instance.name);
      setLaunchError(null);
      try {
        await window.launcherAPI.launchInstance(instance.name, accountId);
      } catch (err) {
        console.error("Launch failed:", err);
        const message = err instanceof Error ? err.message : "Failed to launch instance.";
        setLaunchError(`${instance.name} didn't start: ${cleanError(message)}`);
      }
      setStarting(null);
      reload();
    },
    [reload]
  );

  const sorted = useMemo(() => [...instances].sort(byLastPlayed), [instances]);

  return { instances: sorted, loaded, starting, launchError, clearError: () => setLaunchError(null), launch, reload };
}
