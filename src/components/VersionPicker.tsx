import { useEffect, useState } from "react";

type Props = {
  instanceName: string;
  /** The item's key for the update check: "mod/sodium.jar". */
  itemKey: string;
  name: string;
  icon: string | null;
  /** The version to start on (the update found), if any. */
  suggested?: string;
  onDone: (result: UpdateResult & DependencyCheck) => void;
  onClose: () => void;
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const CHANNEL: Record<ContentVersion["channel"], { label: string; colour: string }> = {
  release: { label: "Release", colour: "#22c55e" },
  beta: { label: "Beta", colour: "#f59e0b" },
  alpha: { label: "Alpha", colour: "#ef4444" },
};

function formatBytes(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/*
 * Every version of one mod (or pack) that works on this instance, like the Modrinth app's
 * version list: pick any, newer or older, and see each one's changelog when you open it.
 */
export default function VersionPicker({ instanceName, itemKey, name, icon, suggested, onDone, onClose }: Props) {
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .versions(instanceName, itemKey)
      .then((found) => {
        if (!current) return;
        setVersions(found.versions);
        // The update that was found, or else the newest if it isn't the one installed.
        const newest = found.versions[0] && !found.versions[0].installed ? found.versions[0] : null;
        setChosen((found.versions.find((v) => v.number === suggested) ?? newest)?.id ?? null);
      })
      .catch((err) => current && setLoadError(message(err)));
    return () => {
      current = false;
    };
  }, [instanceName, itemKey, suggested]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Changelogs load one at a time, when opened.
  const toggleChangelog = (id: string) => {
    if (id in open) {
      setOpen((current) => {
        const rest = { ...current };
        delete rest[id];
        return rest;
      });
      return;
    }
    setOpen((current) => ({ ...current, [id]: null }));
    window.instanceAPI
      .versionChangelog(instanceName, itemKey, id)
      .then((text) => setOpen((current) => (id in current ? { ...current, [id]: text || "No changelog for this version." } : current)))
      .catch((err) => setOpen((current) => (id in current ? { ...current, [id]: `Couldn't load the changelog: ${message(err)}` } : current)));
  };

  const choose = (id: string) => {
    setChosen(id);
    setProblems(null);
    setError(null);
  };

  const installed = versions?.find((v) => v.installed) ?? null;
  const picked = versions?.find((v) => v.id === chosen) ?? null;
  const goingBack = Boolean(picked && installed && Date.parse(picked.published) < Date.parse(installed.published));

  async function install(force: boolean) {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const done = await window.instanceAPI.installVersion(instanceName, itemKey, picked.id, force);
      if (done.needsConfirm) {
        setProblems(done.problems);
      } else {
        onDone(done);
        onClose();
      }
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  return (
    <div
      data-testid="version-picker"
      onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0, 0, 0, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="dialog"
        aria-label={`Choose a version of ${name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(760px, 90vh)",
          display: "flex",
          flexDirection: "column",
          background: "#17141f",
          border: "1px solid #6d28d9",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
          textAlign: "left",
          color: "#e4e4e7",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #2e2640" }}>
          {icon ? (
            <img src={icon} alt="" width={36} height={36} style={{ borderRadius: 8, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#2b1d47" }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#e9d5ff" }}>{name}</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>
              {installed ? `You have ${installed.number}. ` : ""}Choose any version that works on this instance.
            </div>
          </div>
          <button aria-label="Close" disabled={busy} onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#9ca3af", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "10px 14px", flex: 1 }}>
          {loadError ? (
            <div style={{ color: "#fca5a5", fontSize: 13, padding: 8 }}>{loadError}</div>
          ) : !versions ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 8 }}>Finding versions...</div>
          ) : !versions.length ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 8 }}>No versions of this work on this instance.</div>
          ) : (
            versions.map((version, index) => {
              const selected = version.id === chosen;
              const channel = CHANNEL[version.channel] ?? CHANNEL.release;
              return (
                <div key={version.id} data-testid="version-row" style={{ marginBottom: 6 }}>
                  <div
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => !busy && choose(version.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && choose(version.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 10,
                      cursor: "pointer",
                      background: selected ? "#2b1d47" : "#100e16",
                      border: `1px solid ${selected ? "#7c3aed" : "#231d31"}`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: `2px solid ${selected ? "#a78bfa" : "#52525b"}`, background: selected ? "#a78bfa" : "transparent" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{version.number}</span>
                        <span style={{ fontSize: 10, color: channel.colour, border: `1px solid ${channel.colour}`, borderRadius: 6, padding: "0 6px" }}>{channel.label}</span>
                        {version.installed && <span style={{ fontSize: 10, color: "#e9d5ff", background: "#6d28d9", borderRadius: 6, padding: "1px 6px" }}>Installed</span>}
                        {index === 0 && !version.installed && <span style={{ fontSize: 10, color: "#86efac" }}>Newest</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>
                        {new Date(version.published).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        {version.size ? ` · ${formatBytes(version.size)}` : ""}
                      </div>
                    </div>
                    <button
                      data-testid="changelog-toggle"
                      aria-expanded={version.id in open}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleChangelog(version.id);
                      }}
                      style={{ background: "none", border: "none", color: "#c4b5fd", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                    >
                      Changelog {version.id in open ? "▾" : "▸"}
                    </button>
                  </div>
                  {version.id in open && (
                    <div
                      data-testid="changelog"
                      style={{ margin: "4px 0 2px 36px", padding: "8px 12px", maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, color: "#d4d4d8", background: "#0b0a10", border: "1px solid #231d31", borderRadius: 8 }}
                    >
                      {open[version.id] ?? "Loading..."}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {problems && (
          <div role="alert" style={{ margin: "0 20px", padding: "10px 12px", borderRadius: 10, background: "#2a1a05", border: "1px solid #b45309", color: "#fcd34d", fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>This version probably won't work with the rest of the instance:</div>
            <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <div role="alert" style={{ margin: "8px 20px 0", color: "#fca5a5", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid #2e2640" }}>
          <span style={{ fontSize: 12, color: "#9ca3af", marginRight: "auto" }}>
            {picked && !picked.installed ? `${goingBack ? "Going back to" : "Updating to"} ${picked.number}` : "Pick a version"}
          </span>
          <button className="sidebar-button" disabled={busy} onClick={onClose} style={{ padding: "8px 14px", fontSize: 13 }}>
            Cancel
          </button>
          {problems ? (
            <button className="sidebar-button" data-testid="install-anyway" disabled={busy} onClick={() => install(true)} style={{ padding: "8px 14px", fontSize: 13, background: "#b45309", borderColor: "#b45309" }}>
              {busy ? "Installing..." : "Install anyway"}
            </button>
          ) : (
            <button
              className="sidebar-button"
              data-testid="install-version"
              disabled={busy || !picked || picked.installed}
              onClick={() => install(false)}
              style={{ padding: "8px 14px", fontSize: 13, background: picked && !picked.installed ? "#16a34a" : undefined, borderColor: picked && !picked.installed ? "#16a34a" : undefined }}
            >
              {busy ? "Checking..." : picked && !picked.installed ? `${goingBack ? "Go back to" : "Install"} ${picked.number}` : "Install"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
