import { useState } from "react";

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
};

const INSTALLABLE_TYPES = ["mod", "resourcepack", "shader", "datapack"];

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "#1b1b1b",
  color: "white",
  border: "1px solid #6d28d9",
  fontSize: 12,
  maxWidth: 190,
};

/*
 * Adds a project to a chosen instance. The main process works out which file fits
 * that instance and which folder it belongs in, so this works the same for any
 * content type from either source.
 */
export default function InstallToInstance({ source, projectId, name, icon, type, installable, url, alternatives = [] }: Props) {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [worlds, setWorlds] = useState<string[]>([]);
  const [world, setWorld] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!INSTALLABLE_TYPES.includes(type)) return null;

  // Restricted on one site can still mean available on the other.
  if (!installable && !alternatives.some((other) => other.installable)) {
    return (
      <button
        className="sidebar-button"
        style={{ padding: "8px 12px" }}
        title="This author disabled third-party downloads"
        onClick={() => url && window.modAPI.openUrl(url).catch(() => {})}
      >
        Open Site
      </button>
    );
  }

  const chooseInstance = async (instanceName: string) => {
    setChosen(instanceName);
    setDone(null);
    setError(null);
    setWorlds([]);
    setWorld("");

    if (type !== "datapack" || !instanceName) return;

    try {
      const content = await window.instanceAPI.content(instanceName);
      setWorlds(content.worlds);
      setWorld(content.worlds[0] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const open = async () => {
    setError(null);
    try {
      const list = await window.instanceAPI.list();
      setInstances(list);
      if (list.length > 0) await chooseInstance(list[0].name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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

        const extras = result.dependencies.length ? ` Also added: ${result.dependencies.join(", ")}.` : "";
        setDone(`Added to ${chosen}, in ${result.folder}, from ${attempt.source === "modrinth" ? "Modrinth" : "CurseForge"}.${extras}`);
        setBusy(false);
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <button className="sidebar-button" style={{ padding: "8px 12px", background: "#7c3aed" }} onClick={open}>
          Install
        </button>
        {error && <div style={{ color: "#fca5a5", fontSize: 11, maxWidth: 240 }}>{error}</div>}
      </div>
    );
  }

  if (instances.length === 0) {
    return <div style={{ color: "#fcd34d", fontSize: 12, maxWidth: 200 }}>Create an instance first.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: 380 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <select
          aria-label="Instance"
          style={selectStyle}
          value={chosen}
          disabled={busy}
          onChange={(event) => chooseInstance(event.target.value)}
        >
          {instances.map((instance) => (
            <option key={instance.name} value={instance.name}>
              {instance.name} ({instance.version}
              {instance.loader && instance.loader !== "vanilla" ? ` ${instance.loader}` : ""})
            </option>
          ))}
        </select>

        {type === "datapack" && (
          <select
            aria-label="World"
            style={selectStyle}
            value={world}
            disabled={busy}
            onChange={(event) => setWorld(event.target.value)}
          >
            {worlds.map((worldName) => (
              <option key={worldName} value={worldName}>
                World: {worldName}
              </option>
            ))}
            <option value="">Keep for later</option>
          </select>
        )}

        <button
          className="sidebar-button"
          style={{ padding: "8px 12px", background: "#7c3aed" }}
          disabled={busy || !chosen}
          onClick={install}
        >
          {busy ? "Adding..." : "Add"}
        </button>
      </div>

      {done && <div style={{ color: "#86efac", fontSize: 11, textAlign: "right" }}>{done}</div>}
      {error && <div style={{ color: "#fca5a5", fontSize: 11, textAlign: "right" }}>{error}</div>}
    </div>
  );
}
