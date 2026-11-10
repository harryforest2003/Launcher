import { useCallback, useEffect, useState } from "react";

/*
 * Backs the "Import Existing Instance" section: scanning other
 * launchers, importing a folder or zip, and restoring from the cloud
 * folder.
 */

type Props = {
  onImported: (name: string) => void;
};

type Mode = "idle" | "launchers" | "cloud";

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 16,
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function ImportPanel({ onImported }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);

  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [scanned, setScanned] = useState(false);

  const [cloudFolder, setCloudFolder] = useState("");
  const [cloudDetected, setCloudDetected] = useState<CloudFolder[]>([]);
  const [cloudInstances, setCloudInstances] = useState<CloudInstance[]>([]);

  useEffect(() => {
    return window.instanceAPI.onProgress(setProgress);
  }, []);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    setProgress(null);

    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setBusy(null);
  }

  /* ---------------- launcher scan ---------------- */

  async function scan() {
    await run("scan", async () => {
      const found = await window.instanceAPI.scanLaunchers();
      setCandidates(found);
      setScanned(true);
      setMode("launchers");

      if (found.length === 0) {
        setNotice("No instances found in any other launcher on this machine.");
      }
    });
  }

  async function importCandidate(entry: ImportCandidate) {
    await run(entry.id, async () => {
      let version = entry.mcVersion ?? undefined;

      // A folder with no readable version needs one from the user.
      if (!version && !entry.floatingVersion) {
        const answer = prompt(
          `Which Minecraft version is "${entry.name}"? (e.g. 1.21.1)`
        );

        if (!answer) throw new Error("Import cancelled — no version given.");

        version = answer.trim();
      }

      const created = await window.instanceAPI.importInstance({
        entry,
        version,
      });

      setNotice(
        `Imported "${created.name}" (${created.version}, ${created.loader}).`
      );

      onImported(created.name);
    });
  }

  /* ---------------- folder / zip ---------------- */

  async function importFolder() {
    await run("folder", async () => {
      const entry = await window.instanceAPI.pickFolder();

      if (!entry) return;

      await importCandidate(entry);
    });
  }

  async function importZip() {
    await run("zip", async () => {
      const picked = await window.instanceAPI.pickZip();

      if (!picked) return;

      if (picked.kind === "modpack") {
        const info = picked.info;

        const created = await window.instanceAPI.importModpackFile(picked.file);

        setNotice(
          `Installed modpack "${info.name}" as "${created.name}" ` +
          `(Minecraft ${created.version}, ${created.loader}).`
        );

        onImported(created.name);
        return;
      }

      const created = await window.instanceAPI.cloudImport(picked.file);

      setNotice(`Restored "${created.name}" from the export.`);
      onImported(created.name);
    });
  }

  /* ---------------- cloud ---------------- */

  const loadCloud = useCallback(async () => {
    const [list, detected] = await Promise.all([
      window.instanceAPI.cloudList(),
      window.instanceAPI.cloudDetect(),
    ]);

    setCloudFolder(list.folder);
    setCloudInstances(list.instances);
    setCloudDetected(detected);
  }, []);

  async function openCloud() {
    await run("cloud", async () => {
      await loadCloud();
      setMode("cloud");
    });
  }

  async function chooseCloud(folder: string) {
    await run("cloudset", async () => {
      await window.instanceAPI.cloudSetFolder(folder);
      await loadCloud();
      setNotice(`Cloud folder set to ${folder}`);
    });
  }

  async function browseCloud() {
    await run("cloudpick", async () => {
      const folder = await window.instanceAPI.cloudPickFolder();

      if (!folder) return;

      await loadCloud();
      setNotice(`Cloud folder set to ${folder}`);
    });
  }

  async function restore(file: string) {
    await run(file, async () => {
      const created = await window.instanceAPI.cloudImport(file);

      setNotice(`Restored "${created.name}" from the cloud folder.`);
      onImported(created.name);
    });
  }

  /* ---------------- render ---------------- */

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <button
          className="sidebar-button"
          disabled={!!busy}
          onClick={scan}
        >
          {busy === "scan" ? "Scanning..." : "Scan Launchers"}
        </button>

        <button
          className="sidebar-button"
          disabled={!!busy}
          onClick={importFolder}
        >
          {busy === "folder" ? "Importing..." : "Import Folder"}
        </button>

        <button
          className="sidebar-button"
          disabled={!!busy}
          onClick={importZip}
        >
          {busy === "zip" ? "Importing..." : "Import ZIP"}
        </button>

        <button
          className="sidebar-button"
          disabled={!!busy}
          onClick={openCloud}
        >
          {busy === "cloud" ? "Loading..." : "Import Cloud"}
        </button>
      </div>

      {error && (
        <div
          style={{
            ...card,
            borderColor: "#ef4444",
            background: "#2a0d0d",
            color: "#fca5a5",
            marginBottom: 16,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          style={{
            ...card,
            borderColor: "#166534",
            background: "#0d2a12",
            color: "#86efac",
            marginBottom: 16,
          }}
        >
          {notice}
        </div>
      )}

      {busy && progress && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ color: "#d8b4fe", marginBottom: 8 }}>
            {progress.detail ?? progress.stage} ({progress.percent}%)
          </div>
          <div style={{ height: 6, background: "#333", borderRadius: 3 }}>
            <div
              style={{
                width: `${progress.percent}%`,
                height: "100%",
                background: "#7c3aed",
                borderRadius: 3,
                transition: "width .2s",
              }}
            />
          </div>
        </div>
      )}

      {/* ---------------- launcher results ---------------- */}
      {mode === "launchers" && scanned && candidates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ color: "#9ca3af", fontSize: 13 }}>
            Found {candidates.length} instance
            {candidates.length === 1 ? "" : "s"}. Importing copies the mods,
            configs and saves, then downloads Minecraft and the loader fresh.
          </p>

          {candidates.map((entry) => (
            <div
              key={entry.id}
              style={{ ...card, display: "flex", alignItems: "center", gap: 14 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#c084fc", fontWeight: 600 }}>
                  {entry.name}
                </div>

                <div style={{ fontSize: 12, color: "#aaa" }}>
                  {entry.launcherLabel} •{" "}
                  {entry.mcVersion ?? entry.floatingVersion ?? "version unknown"}
                  {entry.loader && entry.loader !== "vanilla"
                    ? ` • ${entry.loader} ${entry.loaderVersion}`
                    : " • Vanilla"}
                  {entry.modCount ? ` • ${entry.modCount} mods` : ""}
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    marginTop: 4,
                    wordBreak: "break-all",
                  }}
                >
                  {entry.sourcePath}
                </div>
              </div>

              <button
                className="sidebar-button"
                style={{ background: "#7c3aed", minWidth: 90 }}
                disabled={!!busy}
                onClick={() => importCandidate(entry)}
              >
                {busy === entry.id ? "..." : "Import"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- cloud ---------------- */}
      {mode === "cloud" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <p style={{ color: "#d8b4fe", marginBottom: 8 }}>Cloud folder</p>

            <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 12 }}>
              Instances are exported as a single zip into a folder your cloud
              provider already syncs. That works with OneDrive, iCloud Drive,
              Dropbox or Google Drive without signing in to anything.
            </p>

            <div
              style={{
                color: cloudFolder ? "#86efac" : "#fcd34d",
                fontSize: 12,
                marginBottom: 12,
                wordBreak: "break-all",
              }}
            >
              {cloudFolder ||
                "OneDrive isn't set up on this computer. Install it and sign in, or choose another folder."}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {cloudDetected.map((folder) => (
                <button
                  key={folder.path}
                  className="sidebar-button"
                  disabled={!!busy}
                  onClick={() => chooseCloud(folder.path)}
                  style={{ fontSize: 12 }}
                >
                  Use {folder.label}
                </button>
              ))}

              <button
                className="sidebar-button"
                disabled={!!busy}
                onClick={browseCloud}
                style={{ fontSize: 12 }}
              >
                Choose folder...
              </button>
            </div>
          </div>

          {cloudFolder && (
            cloudInstances.length === 0 ? (
              <div style={{ ...card, color: "#9ca3af" }}>
                No exported instances in that folder yet. Use{" "}
                <b>Back up to cloud</b> on an instance to put one there.
              </div>
            ) : (
              <>
              <p style={{ color: "#9ca3af", fontSize: 12 }}>
                Restoring downloads Minecraft and the loader, then puts your mods
                and saves back. It makes a new instance, so anything already on
                this device stays as it is.
              </p>

              {cloudInstances.map((entry) => (
                <div
                  key={entry.file}
                  data-testid="cloud-backup"
                  style={{ ...card, display: "flex", alignItems: "center", gap: 14 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#c084fc", fontWeight: 600 }}>
                      {entry.name}
                    </div>

                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {entry.notDownloaded
                        ? "Still syncing to this device"
                        : `${formatBytes(entry.size)}${
                            entry.modified ? ` • ${new Date(entry.modified).toLocaleString()}` : ""
                          }`}
                    </div>

                    {entry.previous && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                        Older backup: {formatBytes(entry.previous.size)}
                        {entry.previous.modified
                          ? ` • ${new Date(entry.previous.modified).toLocaleString()}`
                          : ""}
                      </div>
                    )}
                  </div>

                  {entry.previous && (
                    <button
                      className="sidebar-button"
                      style={{ minWidth: 90, fontSize: 12 }}
                      disabled={!!busy}
                      onClick={() => restore(entry.previous!.file)}
                    >
                      {busy === entry.previous.file ? "..." : "Restore older"}
                    </button>
                  )}

                  <button
                    className="sidebar-button"
                    style={{ background: "#7c3aed", minWidth: 90 }}
                    disabled={!!busy || entry.notDownloaded}
                    onClick={() => restore(entry.file)}
                  >
                    {busy === entry.file ? "..." : "Restore"}
                  </button>
                </div>
              ))}
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
