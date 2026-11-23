import { useEffect, useState } from "react";
import { versionLabel, type PackVersion } from "./packVersions";

type Pack = { source: "modrinth" | "curseforge"; projectId: string; name: string };

const plain = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Installing a modpack as a new instance, from a chosen version of it: which pack is
 * installing, how far along it is, and how it went. Discover and the pack's own page
 * both install this way.
 */
export function useModpackInstall() {
  // The project id of the pack installing, if any.
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.instanceAPI.onProgress(setProgress), []);

  async function install(pack: Pack, version: PackVersion) {
    setInstalling(pack.projectId);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const created = await window.instanceAPI.installModpack({
        source: pack.source,
        projectId: pack.projectId,
        fileId: String(version.id),
        name: pack.name,
      });
      const blocked = created.pack?.blocked?.length ?? 0;
      setResult(
        `Created instance "${created.name}" from ${versionLabel(version)}: Minecraft ${created.version}, ` +
          `${created.loader} ${created.loaderVersion}, ${created.ram} GB RAM.` +
          (blocked ? ` ${blocked} file${blocked === 1 ? "" : "s"} couldn't be downloaded automatically, as their authors don't allow it.` : "")
      );
    } catch (err) {
      setError(plain(err));
    }

    setInstalling(null);
    setProgress(null);
  }

  return { installing, progress, result, error, install };
}
