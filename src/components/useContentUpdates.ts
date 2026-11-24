import { useCallback, useEffect, useRef, useState } from "react";
import { dependencyNote } from "../utils/dependencyNote";

type Check = Awaited<ReturnType<typeof window.instanceAPI.checkUpdates>>;

const CHECKED_TYPES: ContentType[] = ["mod", "resourcepack", "shader"];

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/* The key the update check uses for an item: "mod/sodium.jar". */
export const updateKey = (item: { type: ContentType; fileName: string }) => `${item.type}/${item.fileName}`;

/*
 * Updates for an instance's mods, resource packs and shaders, like the Modrinth app: checked
 * as soon as the page opens and again whenever its files change, with each file's state
 * and a way to install one or all of them.
 */
export function useContentUpdates(instanceName: string, content: InstanceContent, onUpdated: () => Promise<void> | void) {
  // Which files there are; turning one on or off doesn't change it, adding or removing does.
  const files = CHECKED_TYPES.flatMap((type) => content[type].filter((item) => item.kind === "file").map(updateKey))
    .sort()
    .join("|");
  const [rechecks, setRechecks] = useState(0);
  const wanted = `${instanceName}#${files}#${rechecks}`;

  const [check, setCheck] = useState<(Check & { for: string }) | null>(null);
  const [checkError, setCheckError] = useState<{ for: string; message: string } | null>(null);
  const [installing, setInstalling] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Update All found betas or alphas: nothing installs until one of the dialog's choices.
  const [unstable, setUnstable] = useState<ModUpdate[] | null>(null);
  // The files kept at their version, as saved last (the check can lag behind a change).
  const kept = useRef<string[]>([]);

  useEffect(() => {
    if (!files) return;
    let current = true;
    window.instanceAPI
      .checkUpdates(instanceName)
      .then((found) => {
        if (!current) return;
        kept.current = found.kept ?? [];
        setCheck({ ...found, for: wanted });
      })
      .catch((err) => current && setCheckError({ for: wanted, message: message(err) }));
    return () => {
      current = false;
    };
  }, [instanceName, files, wanted]);

  useEffect(
    () =>
      window.instanceAPI.onProgress((p) => {
        if (p.name === instanceName && p.stage === "updates") setProgress(p.detail ?? null);
      }),
    [instanceName]
  );

  const checking = Boolean(files) && check?.for !== wanted && checkError?.for !== wanted;
  const updates = check?.updates ?? [];

  // The latest change that can be undone, looked up again whenever the files change.
  const [lastBatch, setLastBatch] = useState<{ for: string; batch: Awaited<ReturnType<typeof window.instanceAPI.lastUpdate>> } | null>(null);
  useEffect(() => {
    let current = true;
    window.instanceAPI
      .lastUpdate(instanceName)
      .then((batch) => current && setLastBatch({ for: wanted, batch }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [instanceName, wanted]);

  /* After any change: what happened, then the list and the check refreshed. */
  const finish = useCallback(
    async (done: UpdateResult & DependencyCheck & { loader?: { name: string; from: string; to: string } }) => {
      const parts: string[] = [];
      if (done.loader) parts.push(`${done.loader.name} is now ${done.loader.to}.`);
      if (done.updated.length === 1) parts.push(`${done.updated[0].name} is now ${done.updated[0].to}.`);
      else if (done.updated.length) parts.push(`Updated ${done.updated.length} items.`);
      for (const skip of done.skipped) parts.push(`Kept ${skip.name} at ${skip.from}: ${skip.to} ${skip.reasons.join("; ")}.`);
      for (const held of done.noRelease ?? []) parts.push(`${held.name} stays at ${held.from}: no full release is newer than it yet.`);
      if (done.failed.length) parts.push(`Couldn't update ${done.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}.`);
      if (dependencyNote(done)) parts.push(dependencyNote(done));
      setResult(parts.join(" ") || "Nothing needed changing.");
      await onUpdated();
      setRechecks((count) => count + 1);
    },
    [onUpdated]
  );

  const install = useCallback(
    async (keys: string[], options?: { releasesOnly?: boolean }) => {
      if (!keys.length) return;
      setInstalling(keys);
      setResult(null);
      setError(null);
      try {
        await finish(await window.instanceAPI.applyUpdates(instanceName, keys, options));
      } catch (err) {
        setError(message(err));
        setRechecks((count) => count + 1);
      }
      setInstalling([]);
      setProgress(null);
    },
    [instanceName, finish]
  );

  /* Keeps a file at its version (Update All leaves it alone), or lets it update again. */
  const keep = useCallback(
    async (key: string, on: boolean) => {
      const next = new Set(kept.current);
      if (on) next.add(key);
      else next.delete(key);
      kept.current = [...next];
      try {
        await window.instanceAPI.update(instanceName, { keptVersions: kept.current });
      } catch (err) {
        setError(message(err));
      }
      setRechecks((count) => count + 1);
    },
    [instanceName]
  );

  /* A version picked by hand: a kept file stays kept at the version it's now on. */
  const finishPicked = useCallback(
    async (oldKey: string, done: UpdateResult & DependencyCheck) => {
      const now = done.updated[0];
      const newKey = now?.type && now.fileName ? updateKey({ type: now.type, fileName: now.fileName }) : null;
      if (newKey && newKey !== oldKey && kept.current.includes(oldKey)) {
        kept.current = kept.current.map((key) => (key === oldKey ? newKey : key));
        await window.instanceAPI.update(instanceName, { keptVersions: kept.current }).catch((err) => setError(message(err)));
      }
      await finish(done);
    },
    [instanceName, finish]
  );

  /* Update All: straight away, unless some updates are betas or alphas. */
  const updateAll = () => {
    const risky = updates.filter((update) => update.channel && update.channel !== "release");
    if (risky.length) setUnstable(risky);
    else install(updates.map((update) => update.key));
  };

  /* The beta and alpha dialog's choice: back out, update anyway, or full releases only. */
  const resolveUnstable = (choice: "cancel" | "anyway" | "releases") => {
    setUnstable(null);
    if (choice === "cancel") return;
    install(
      updates.map((update) => update.key),
      choice === "releases" ? { releasesOnly: true } : undefined
    );
  };

  const undo = useCallback(async () => {
    setResult(null);
    setError(null);
    try {
      const done = await window.instanceAPI.undoUpdate(instanceName);
      setResult(`Put back ${done.restored.map((r) => `${r.name} ${r.version}`).join(", ")}.`);
      await onUpdated();
    } catch (err) {
      setError(message(err));
    }
    setRechecks((count) => count + 1);
  }, [instanceName, onUpdated]);

  return {
    checking,
    /** This file's state from the latest check, if it has been checked. */
    statusOf: (item: { type: ContentType; fileName: string }) => check?.status[updateKey(item)] ?? null,
    updates,
    installing,
    progress,
    result,
    error: error ?? (checkError?.for === wanted ? checkError.message : null),
    install,
    updateAll,
    /** The betas and alphas Update All would install, while it asks what to do about them. */
    unstable,
    resolveUnstable,
    /** How many files are kept at their version while a newer build is out. */
    keptWaiting: Object.values(check?.status ?? {}).filter((status) => status.state === "kept").length,
    keep,
    /** Reports a change made elsewhere (a version picked by hand) and refreshes. */
    finish,
    finishPicked,
    /** The latest change that can be undone, if any. */
    lastBatch: lastBatch?.batch ?? null,
    undo,
    recheck: () => {
      setResult(null);
      setError(null);
      setRechecks((count) => count + 1);
    },
  };
}

export type ContentUpdates = ReturnType<typeof useContentUpdates>;
