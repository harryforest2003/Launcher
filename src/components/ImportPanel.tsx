import { useCallback, useEffect, useState } from "react";
import { ClipboardPaste, Cloud, FileArchive, FolderOpen, Radar, Users } from "lucide-react";
import { Button, Notice } from "./ui";
import "../pages/library.css";

/*
 * Backs the "Import" tab of the New Instance page: scanning other launchers, importing a
 * folder or zip, pasting a share code, and restoring from the cloud folder.
 */

type Props = {
  onImported: (name: string) => void;
};

type Mode = "idle" | "launchers" | "code" | "shared" | "cloud";
type SharedPreview = Awaited<ReturnType<typeof window.instanceAPI.readShareCode>>;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

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

  const [code, setCode] = useState("");
  const [shared, setShared] = useState<SharedPreview | null>(null);
  const [made, setMade] = useState<string | null>(null);

  const [source, setSource] = useState("");
  const [following, setFollowing] = useState<Awaited<ReturnType<typeof window.instanceAPI.sharedRead>> | null>(null);

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
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
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
        setNotice("No instances found in any other launcher on this computer.");
      }
    });
  }

  async function importCandidate(entry: ImportCandidate) {
    await run(entry.id, async () => {
      let version = entry.mcVersion ?? undefined;

      // A folder with no readable version needs one from the user.
      if (!version && !entry.floatingVersion) {
        const answer = prompt(`Which Minecraft version is "${entry.name}"? (e.g. 1.21.1)`);

        if (!answer) throw new Error("Import cancelled: no version given.");

        version = answer.trim();
      }

      const created = await window.instanceAPI.importInstance({
        entry,
        version,
      });

      setNotice(`Imported "${created.name}" (${created.version}, ${created.loader}).`);

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
        // Looked up on Modrinth, so a known pack can be updated later. Not found is fine.
        await window.instanceAPI.identifyModpackFile(created.name, picked.file).catch(() => null);

        setNotice(`Installed modpack "${info.name}" as "${created.name}" (Minecraft ${created.version}, ${created.loader}).`);

        onImported(created.name);
        return;
      }

      const created = await window.instanceAPI.cloudImport(picked.file);

      setNotice(`Restored "${created.name}" from the export.`);
      onImported(created.name);
    });
  }

  /* ---------------- share code ---------------- */

  async function readCode(text: string) {
    setCode(text);
    setShared(null);
    setMade(null);
    if (!text.trim()) return;
    await run("read-code", async () => setShared(await window.instanceAPI.readShareCode(text)));
  }

  async function importCode() {
    await run("code", async () => {
      const done = await window.instanceAPI.importShareCode(code);
      const problems = [
        done.blocked.length ? `Not allowed to download outside CurseForge, so get them from their pages: ${done.blocked.map((b) => b.name).join(", ")}.` : "",
        done.failed.length ? `Couldn't download: ${done.failed.map((f) => f.name).join(", ")}.` : "",
        done.notFound ? `${done.notFound} file${done.notFound === 1 ? " is" : "s are"} no longer on Modrinth or CurseForge.` : "",
        done.missing.length ? `Not on either site, so ask whoever shared it for: ${done.missing.join(", ")}.` : "",
      ].filter(Boolean);
      setNotice(`Made "${done.name}" with ${done.installed} file${done.installed === 1 ? "" : "s"}.${problems.length ? ` ${problems.join(" ")}` : ""}`);
      setCode("");
      setShared(null);
      if (problems.length) setMade(done.name);
      else onImported(done.name);
    });
  }

  /* ---------------- shared instance ---------------- */

  async function readShared(where: string) {
    setSource(where);
    setFollowing(null);
    setMade(null);
    if (!where.trim()) return;
    await run("read-shared", async () => setFollowing(await window.instanceAPI.sharedRead(where)));
  }

  async function chooseShared() {
    const picked = await window.instanceAPI.sharedChooseFile();
    if (picked) await readShared(picked);
  }

  async function joinShared() {
    await run("shared", async () => {
      const done = await window.instanceAPI.sharedJoin(source);
      const problems = [
        done.blocked.length ? `Not allowed to download outside CurseForge, so get them from their pages: ${done.blocked.map((b) => b.name).join(", ")}.` : "",
        done.failed.length ? `Couldn't download: ${done.failed.map((f) => f.name).join(", ")}.` : "",
        done.notFound ? `${done.notFound} file${done.notFound === 1 ? " is" : "s are"} no longer on Modrinth or CurseForge.` : "",
        done.missing.length ? `Not on either site, so ask whoever shared it for: ${done.missing.join(", ")}.` : "",
      ].filter(Boolean);
      setNotice(
        `Made "${done.name}" with ${done.installed} file${done.installed === 1 ? "" : "s"}. It follows the shared instance, so changes show up on its Content tab.` +
          (problems.length ? ` ${problems.join(" ")}` : "")
      );
      setSource("");
      setFollowing(null);
      if (problems.length) setMade(done.name);
      else onImported(done.name);
    });
  }

  /* ---------------- cloud ---------------- */

  const loadCloud = useCallback(async () => {
    const [list, detected] = await Promise.all([window.instanceAPI.cloudList(), window.instanceAPI.cloudDetect()]);

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

  const options = [
    {
      id: "scan",
      icon: Radar,
      title: "From another launcher",
      text: "Finds instances in Prism, MultiMC, CurseForge, the Modrinth App and the Minecraft Launcher on this computer.",
      action: scan,
      label: busy === "scan" ? "Scanning..." : "Scan Launchers",
      current: mode === "launchers",
    },
    {
      id: "folder",
      icon: FolderOpen,
      title: "From a folder",
      text: "An instance folder you copied or backed up yourself, with its mods, configs and saves.",
      action: importFolder,
      label: busy === "folder" ? "Importing..." : "Import Folder",
      current: false,
    },
    {
      id: "zip",
      icon: FileArchive,
      title: "From a zip or modpack file",
      text: "A Modrinth .mrpack, a CurseForge modpack zip, or an export made by this launcher.",
      action: importZip,
      label: busy === "zip" ? "Importing..." : "Import ZIP",
      current: false,
    },
    {
      id: "code",
      icon: ClipboardPaste,
      title: "From a share code",
      text: "A code from Share code on someone's instance. It downloads the same mods from Modrinth and CurseForge.",
      action: () => {
        setMode("code");
        setMade(null);
      },
      label: "Paste Code",
      current: mode === "code",
    },
    {
      id: "shared",
      icon: Users,
      title: "Join a shared instance",
      text: "A file from Share live on someone's instance. It stays in step: when they publish changes, you get an Update.",
      action: () => {
        setMode("shared");
        setMade(null);
      },
      label: "Join Shared",
      current: mode === "shared",
    },
    {
      id: "cloud",
      icon: Cloud,
      title: "From your cloud folder",
      text: "Backups this launcher put in OneDrive, iCloud Drive, Dropbox or Google Drive.",
      action: openCloud,
      label: busy === "cloud" ? "Loading..." : "Import Cloud",
      current: mode === "cloud",
    },
  ];

  return (
    <div data-testid="import-panel">
      <div className="im-options">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <div key={option.id} className="im-option" data-current={option.current || undefined}>
              <span className="im-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <h3>{option.title}</h3>
              <p>{option.text}</p>
              <Button size="sm" disabled={!!busy} onClick={option.action}>
                {option.label}
              </Button>
            </div>
          );
        })}
      </div>

      {(error || notice || (busy && progress)) && (
        <div className="im-feedback">
          {error && (
            <Notice tone="danger" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Notice>
          )}
          {notice && <Notice tone="success">{notice}</Notice>}
          {busy && progress && (
            <div className="nc-progress" role="status">
              <strong>
                {progress.detail ?? progress.stage} ({progress.percent}%)
              </strong>
              <div className="nc-track">
                <div style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- launcher results ---------------- */}
      {mode === "launchers" && scanned && candidates.length > 0 && (
        <>
          <h2 className="im-section-title">Found {candidates.length === 1 ? "1 instance" : `${candidates.length} instances`}</h2>
          <p className="im-lead">Importing copies the mods, configs and saves, then downloads Minecraft and the loader fresh. The original stays where it is.</p>
          <div className="im-rows">
            {candidates.map((entry) => (
              <div key={entry.id} className="im-row">
                <div className="im-row-text">
                  <div className="im-row-name">{entry.name}</div>
                  <div className="im-row-meta">
                    {entry.launcherLabel}, Minecraft {entry.mcVersion ?? entry.floatingVersion ?? "version unknown"},{" "}
                    {entry.loader && entry.loader !== "vanilla" ? `${entry.loader} ${entry.loaderVersion}` : "Vanilla"}
                    {entry.modCount ? `, ${entry.modCount} mods` : ""}
                  </div>
                  <div className="im-row-path">{entry.sourcePath}</div>
                </div>
                <Button variant="primary" disabled={!!busy} onClick={() => importCandidate(entry)}>
                  {busy === entry.id ? "Importing..." : "Import"}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------------- share code ---------------- */}
      {mode === "code" && (
        <>
          <h2 className="im-section-title">Share code</h2>
          <p className="im-lead">Paste the code. Nothing is made until you press Make instance.</p>
          <textarea
            data-testid="share-code-input"
            className="ui-input ui-input--mono"
            aria-label="Share code"
            placeholder="unity1:..."
            rows={3}
            value={code}
            disabled={busy === "code"}
            onChange={(e) => void readCode(e.target.value)}
            style={{ width: "100%", padding: "var(--space-2) var(--space-3)", fontSize: 12, resize: "vertical" }}
          />
          {shared && (
            <div className="im-row" data-testid="share-code-preview" style={{ marginTop: "var(--space-3)" }}>
              <div className="im-row-text">
                <div className="im-row-name">{shared.name}</div>
                <div className="im-row-meta">
                  Minecraft {shared.version}, {shared.loader === "vanilla" ? "Vanilla" : `${shared.loader}${shared.loaderVersion ? ` ${shared.loaderVersion}` : ""}`}, {shared.files} file
                  {shared.files === 1 ? "" : "s"} to download
                </div>
                {shared.missing.length > 0 && <div className="im-row-meta">Not included (on neither site): {shared.missing.join(", ")}</div>}
              </div>
              <Button variant="primary" disabled={!!busy} onClick={importCode}>
                {busy === "code" ? "Making..." : "Make instance"}
              </Button>
            </div>
          )}
          {made && (
            <Button size="sm" style={{ marginTop: "var(--space-3)" }} onClick={() => onImported(made)}>
              Open {made}
            </Button>
          )}
        </>
      )}

      {/* ---------------- shared instance ---------------- */}
      {mode === "shared" && (
        <>
          <h2 className="im-section-title">Shared instance</h2>
          <p className="im-lead">
            Paste the link to the shared file, or choose it if it's in a folder you share. It only ever downloads from Modrinth and CurseForge.
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <input
              data-testid="shared-source"
              className="ui-input"
              aria-label="Link or path to the shared file"
              placeholder="https://... or a .unityshare file"
              value={source}
              disabled={busy === "shared"}
              onChange={(e) => {
                setSource(e.target.value);
                setFollowing(null);
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (!text) return;
                e.preventDefault();
                void readShared(text);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void readShared(source);
              }}
              onBlur={() => {
                if (!following && source.trim()) void readShared(source);
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button disabled={!!busy} onClick={() => void chooseShared()}>
              Choose file...
            </Button>
          </div>
          {following && (
            <div className="im-row" data-testid="shared-preview" style={{ marginTop: "var(--space-3)" }}>
              <div className="im-row-text">
                <div className="im-row-name">{following.name}</div>
                <div className="im-row-meta">
                  Minecraft {following.version}, {following.loader === "vanilla" ? "Vanilla" : following.loader}, {following.files} file
                  {following.files === 1 ? "" : "s"} to download. Version {following.revision}, published {when(following.updated)}
                </div>
                {following.missing.length > 0 && <div className="im-row-meta">Not included (on neither site): {following.missing.join(", ")}</div>}
              </div>
              <Button variant="primary" disabled={!!busy} onClick={joinShared}>
                {busy === "shared" ? "Joining..." : "Join"}
              </Button>
            </div>
          )}
          {made && (
            <Button size="sm" style={{ marginTop: "var(--space-3)" }} onClick={() => onImported(made)}>
              Open {made}
            </Button>
          )}
        </>
      )}

      {/* ---------------- cloud ---------------- */}
      {mode === "cloud" && (
        <>
          <h2 className="im-section-title">Cloud folder</h2>
          <p className="im-lead">
            Instances are saved as a single zip into a folder your cloud service already syncs. That works with OneDrive, iCloud Drive,
            Dropbox or Google Drive without signing in to anything.
          </p>
          <div className="im-cloud">
            {cloudFolder ? (
              <div className="im-cloud-path">{cloudFolder}</div>
            ) : (
              <Notice tone="warning">OneDrive isn't set up on this computer. Install it and sign in, or choose another folder.</Notice>
            )}

            <div className="im-cloud-buttons">
              {cloudDetected.map((folder) => (
                <Button key={folder.path} size="sm" disabled={!!busy} onClick={() => chooseCloud(folder.path)}>
                  Use {folder.label}
                </Button>
              ))}

              <Button size="sm" variant="ghost" disabled={!!busy} onClick={browseCloud}>
                Choose folder...
              </Button>
            </div>
          </div>

          {cloudFolder &&
            (cloudInstances.length === 0 ? (
              <p className="im-lead" style={{ marginTop: "var(--space-4)" }}>
                No saved instances in that folder yet. Use <b>Back up to cloud</b> on an instance to put one there.
              </p>
            ) : (
              <>
                <p className="im-lead" style={{ marginTop: "var(--space-4)" }}>
                  Restoring downloads Minecraft and the loader, then puts your mods and saves back. It makes a new instance, so anything
                  already on this computer stays as it is.
                </p>

                <div className="im-rows">
                  {cloudInstances.map((entry) => (
                    <div key={entry.file} data-testid="cloud-backup" className="im-row">
                      <div className="im-row-text">
                        <div className="im-row-name">{entry.name}</div>
                        <div className="im-row-meta">
                          {entry.notDownloaded ? "Still syncing to this computer" : `${formatBytes(entry.size)}${entry.modified ? `, ${when(entry.modified)}` : ""}`}
                        </div>
                        {entry.previous && (
                          <div className="im-row-meta">
                            Older backup: {formatBytes(entry.previous.size)}
                            {entry.previous.modified ? `, ${when(entry.previous.modified)}` : ""}
                          </div>
                        )}
                      </div>

                      {entry.previous && (
                        <Button variant="ghost" disabled={!!busy} onClick={() => restore(entry.previous!.file)}>
                          {busy === entry.previous.file ? "Restoring..." : "Restore older"}
                        </Button>
                      )}

                      <Button variant="primary" disabled={!!busy || entry.notDownloaded} onClick={() => restore(entry.file)}>
                        {busy === entry.file ? "Restoring..." : "Restore"}
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ))}
        </>
      )}
    </div>
  );
}
