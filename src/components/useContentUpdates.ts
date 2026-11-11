import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    if (!files) return;
    let current = true;
    window.instanceAPI
      .checkUpdates(instanceName)
      .then((found) => current && setCheck({ ...found, for: wanted }))
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

  const install = useCallback(
    async (keys: string[]) => {
      if (!keys.length) return;
      setInstalling(keys);
      setResult(null);
      setError(null);
      try {
        const done = await window.instanceAPI.applyUpdates(instanceName, keys);
        setResult(
          (done.updated.length === 1
            ? `Updated ${done.updated[0].name} to ${done.updated[0].to}.`
            : `Updated ${done.updated.length} ${done.updated.length === 1 ? "item" : "items"}.`) +
            (done.failed.length ? ` Couldn't update ${done.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}.` : "") +
            (dependencyNote(done) ? ` ${dependencyNote(done)}` : "")
        );
        await onUpdated();
      } catch (err) {
        setError(message(err));
      }
      setInstalling([]);
      setProgress(null);
      setRechecks((count) => count + 1);
    },
    [instanceName, onUpdated]
  );

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
    updateAll: () => install(updates.map((update) => update.key)),
    recheck: () => {
      setResult(null);
      setError(null);
      setRechecks((count) => count + 1);
    },
  };
}

export type ContentUpdates = ReturnType<typeof useContentUpdates>;
