import { useEffect, useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import PackVersionPicker from "./PackVersionPicker";
import { CheckIcon, DownloadIcon } from "./Icons";
import { Badge } from "./ui";
import { channelOf, newestFirst, versionLabel, type PackVersion } from "./packVersions";
import { modpackUpdateText } from "./modpackUpdateText";

type Props = {
  instance: Instance;
  busy: boolean;
  /** The page's own runner: shows busy, errors, and reloads the instance after. */
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  onNotice: (text: string) => void;
};

const GREEN = "var(--color-success-solid)";
const GREEN_TEXT = "var(--color-success-text)";
const time = (version?: PackVersion) => Date.parse(version?.date_published ?? "") || 0;

/*
 * Beside the instance's Minecraft version, for one made from a modpack: the pack and the
 * version of it installed, a green button when a newer version is out, and Undo after an
 * update. Either button opens the pack's versions, to update or go back to an older one.
 */
export default function ModpackUpdate({ instance, busy, run, onNotice }: Props) {
  const pack = instance.modpack;
  const key = pack ? `${pack.source}:${pack.projectId}` : "";
  const [loaded, setLoaded] = useState<{ for: string; versions: PackVersion[] } | null>(null);
  const [last, setLast] = useState<{ for: string; found: { from: string } | null } | null>(null);
  const [open, setOpen] = useState(false);
  const lastKey = `${instance.name}#${pack?.versionId ?? ""}`;

  useEffect(() => {
    if (!pack) return;
    let current = true;
    window.launcherAPI
      .getProject(pack.source, pack.projectId)
      .then((project) => current && setLoaded({ for: key, versions: (project?.versions ?? []) as PackVersion[] }))
      .catch(() => {
        // Offline, or the site is down: no button, nothing to report.
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .lastModpackUpdate(instance.name)
      .then((found) => current && setLast({ for: lastKey, found }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [instance.name, lastKey]);

  // The pack's versions for this instance's Minecraft version.
  const fits = useMemo(
    () => (loaded?.for === key ? loaded.versions : []).filter((v) => !v.game_versions?.length || v.game_versions.includes(instance.version)),
    [loaded, key, instance.version]
  );

  if (!pack) return null;
  const installed = fits.find((v) => String(v.id) === pack.versionId);
  // On a full release, only a newer full release is offered; on a beta or alpha, any newer one.
  const offered = newestFirst(fits).filter((v) => (installed && channelOf(installed) !== "release" ? true : channelOf(v) === "release"))[0];
  const newer = offered && String(offered.id) !== pack.versionId && (!installed || time(offered) > time(installed)) ? offered : null;
  const undo = last?.for === lastKey ? last.found : null;
  const packName = pack.name || "Modpack";

  return (
    <>
      <Badge data-testid="modpack-badge" data-tip={`Made from the modpack ${packName}${pack.versionName ? `, version ${pack.versionName}` : ""}`}>
        {packName}
        {pack.versionName ? ` ${pack.versionName}` : ""}
      </Badge>
      {busy ? (
        <span style={{ marginLeft: 6, fontSize: 12, color: "var(--color-text-muted)" }}>Updating the pack...</span>
      ) : newer ? (
        <button
          data-testid="modpack-update"
          title={`${packName} ${versionLabel(newer)} is out. Click to choose a version to move to.`}
          onClick={() => setOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: 6,
            padding: "1px 8px 1px 6px",
            fontSize: 12,
            lineHeight: "18px",
            verticalAlign: "middle",
            background: GREEN,
            color: "var(--color-on-success)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          <DownloadIcon size={13} />
          {newer.version_number || versionLabel(newer)}
        </button>
      ) : fits.length ? (
        <button
          data-testid="modpack-current"
          className="tick-button"
          title={`${packName} is up to date. Click to choose another version of it.`}
          aria-label={`Choose a version of ${packName}`}
          onClick={() => setOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", marginLeft: 4, padding: "1px 3px", verticalAlign: "middle", color: GREEN_TEXT }}
        >
          <CheckIcon size={14} />
        </button>
      ) : null}
      {undo && !busy && (
        <button
          data-testid="modpack-undo"
          className="ui-button ui-button--ghost ui-button--sm"
          data-tip={`Undo the pack update: back to ${undo.from || "the version before"}`}
          aria-label="Undo the modpack update"
          onClick={() =>
            run("modpack", async () => {
              const back = await window.instanceAPI.undoModpackUpdate(instance.name);
              onNotice(`Put ${packName} back to ${back.version || "the version before"}.`);
            })
          }
        >
          <Undo2 size={14} aria-hidden="true" />
        </button>
      )}
      {open && (
        <PackVersionPicker
          source={pack.source}
          projectId={pack.projectId}
          name={packName}
          versions={fits}
          actionLabel="Switch to this version"
          onPick={(version) => {
            setOpen(false);
            if (String(version.id) === pack.versionId) return;
            void run("modpack", async () => {
              const result = await window.instanceAPI.updateModpack(instance.name, String(version.id));
              onNotice(modpackUpdateText(packName, result));
            });
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
