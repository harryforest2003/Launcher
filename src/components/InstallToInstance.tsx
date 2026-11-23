import { useState } from "react";
import { Check, Download, ExternalLink, X } from "lucide-react";
import { Button } from "./ui";
import { dependencyNote } from "../utils/dependencyNote";
import "../pages/discover.css";

type Props = {
  source: "modrinth" | "curseforge";
  projectId: string;
  name: string;
  icon?: string | null;
  type: string;
  installable: boolean;
  url?: string | null;
  /** Where else this project is published, tried if the first has no file that fits. */
  alternatives?: { source: "modrinth" | "curseforge"; id: string; installable: boolean }[];
  /** solid: the one main action on the page (the project page). tonal: one of many (a result row). */
  emphasis?: "solid" | "tonal";
  /** Told after it is added, so a list can mark it installed. */
  onInstalled?: (instanceName: string) => void;
  /** The instance to offer first (the one whose page this was opened from). */
  preferInstance?: string;
};

const INSTALLABLE_TYPES = ["mod", "resourcepack", "shader", "datapack"];

/*
 * Adds a project to a chosen instance. The main process works out which file fits
 * that instance and which folder it belongs in, so this works the same for any
 * content type from either source. An instance that already has it says so instead
 * of adding a second copy.
 */
export default function InstallToInstance({
  source,
  projectId,
  name,
  icon,
  type,
  installable,
  url,
  alternatives = [],
  emphasis = "tonal",
  onInstalled,
  preferInstance,
}: Props) {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [worlds, setWorlds] = useState<string[]>([]);
  const [world, setWorld] = useState("");
  // What the chosen instance already has from this project.
  const [existing, setExisting] = useState<InstanceMod[]>([]);
  // Instance (and world) pairs added to while this was open.
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!INSTALLABLE_TYPES.includes(type)) return null;

  // Restricted on one site can still mean available on the other.
  if (!installable && !alternatives.some((other) => other.installable)) {
    return (
      <Button
        size="sm"
        icon={<ExternalLink size={14} aria-hidden="true" />}
        title="This author disabled third-party downloads"
        onClick={() => url && window.modAPI.openUrl(url).catch(() => {})}
      >
        Open Site
      </Button>
    );
  }

  const keys = new Set([`${source}:${projectId}`, ...alternatives.map((other) => `${other.source}:${other.id}`)]);

  const chooseInstance = async (instanceName: string) => {
    setChosen(instanceName);
    setDone(null);
    setError(null);
    setWorlds([]);
    setWorld("");
    setExisting([]);

    if (!instanceName) return;

    try {
      const content = await window.instanceAPI.content(instanceName);
      const mine = (content[type as ContentType] ?? []).filter((item) => item.projectId && keys.has(`${item.source}:${item.projectId}`));
      setExisting(mine);
      if (type === "datapack") {
        setWorlds(content.worlds);
        setWorld(content.worlds[0] ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const open = async () => {
    setError(null);
    try {
      const list = await window.instanceAPI.list();
      setInstances(list);
      const first = list.find((instance) => instance.name === preferInstance) ?? list[0];
      if (first) await chooseInstance(first.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // A data pack belongs to one world, so it is only "already there" for that world.
  const already =
    added.includes(`${chosen}\n${world}`) || existing.some((item) => type !== "datapack" || (item.world ?? "") === world);

  const install = async () => {
    setBusy(true);
    setError(null);
    setDone(null);

    const attempts = [
      ...(installable ? [{ source, id: projectId }] : []),
      ...alternatives.filter((other) => other.installable && other.id !== projectId),
    ];

    let firstError: unknown = null;

    for (const attempt of attempts) {
      try {
        const result = await window.instanceAPI.modInstall({
          name: chosen,
          source: attempt.source,
          projectId: attempt.id,
          modName: name,
          iconUrl: icon ?? null,
          type: type as ContentType,
          world: world || undefined,
        });

        const extras = dependencyNote(result);
        setDone(`Added to ${chosen}, in ${result.folder}, from ${attempt.source === "modrinth" ? "Modrinth" : "CurseForge"}.${extras ? ` ${extras}` : ""}`);
        setAdded((list) => [...list, `${chosen}\n${world}`]);
        setBusy(false);
        onInstalled?.(chosen);
        return;
      } catch (err) {
        firstError ??= err;
      }
    }

    setError(firstError instanceof Error ? firstError.message : String(firstError));
    setBusy(false);
  };

  if (!instances) {
    return (
      <div className="iti">
        <Button
          size="sm"
          variant={emphasis === "solid" ? "primary" : "secondary"}
          className={emphasis === "solid" ? undefined : "iti__install"}
          icon={<Download size={14} aria-hidden="true" />}
          aria-label={`Install ${name}`}
          onClick={open}
        >
          Install
        </Button>
        {error && <div className="iti__msg iti__msg--bad">{error}</div>}
      </div>
    );
  }

  if (instances.length === 0) {
    return <div className="iti__msg iti__msg--warn">Create an instance first.</div>;
  }

  return (
    <div className="iti">
      <div className="iti__row">
        <select aria-label="Instance" value={chosen} disabled={busy} onChange={(event) => chooseInstance(event.target.value)}>
          {instances.map((instance) => (
            <option key={instance.name} value={instance.name}>
              {instance.name} ({instance.version}
              {instance.loader && instance.loader !== "vanilla" ? ` ${instance.loader}` : ""})
            </option>
          ))}
        </select>

        {type === "datapack" && (
          <select aria-label="World" value={world} disabled={busy} onChange={(event) => setWorld(event.target.value)}>
            {worlds.map((worldName) => (
              <option key={worldName} value={worldName}>
                World: {worldName}
              </option>
            ))}
            <option value="">Keep for later</option>
          </select>
        )}

        {already ? (
          <Button size="sm" disabled icon={<Check size={14} aria-hidden="true" />}>
            Installed
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={14} aria-hidden="true" />}
            disabled={busy || !chosen}
            onClick={install}
          >
            {busy ? "Adding..." : "Add"}
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          icon={<X size={14} aria-hidden="true" />}
          aria-label="Close the instance picker"
          disabled={busy}
          onClick={() => {
            setInstances(null);
            setDone(null);
            setError(null);
          }}
        />
      </div>

      {done && <div className="iti__msg iti__msg--ok">{done}</div>}
      {already && !done && <div className="iti__msg iti__msg--muted">Already in this instance. Update it from the instance's Content tab.</div>}
      {error && <div className="iti__msg iti__msg--bad">{error}</div>}
    </div>
  );
}
