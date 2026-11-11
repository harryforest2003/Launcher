import { useEffect, useState } from "react";

type Props = {
  instanceName: string;
  /** Called after updates are installed, so the content list can reload. */
  onUpdated: () => void;
};

type Check = Awaited<ReturnType<typeof window.instanceAPI.checkUpdates>>;

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const TYPE_LABEL: Record<string, string> = { mod: "", resourcepack: "resource pack", shader: "shader", datapack: "data pack" };

/* Newer builds of an instance's mods, resource packs and shaders, and installing them. */
export default function ModUpdatesPanel({ instanceName, onUpdated }: Props) {
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      window.instanceAPI.onProgress((p) => {
        if (p.name === instanceName && p.stage === "updates") setProgress(p.detail ?? null);
      }),
    [instanceName]
  );

  async function runCheck() {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setCheck(await window.instanceAPI.checkUpdates(instanceName));
    } catch (err) {
      setError(message(err));
    }
    setChecking(false);
  }

  async function install(keys: string[]) {
    setInstalling(keys);
    setError(null);
    setResult(null);
    try {
      const done = await window.instanceAPI.applyUpdates(instanceName, keys);
      setResult(
        `Updated ${done.updated.length} ${done.updated.length === 1 ? "item" : "items"}.` +
          (done.failed.length ? ` Couldn't update ${done.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}.` : "")
      );
      onUpdated();
      setCheck(await window.instanceAPI.checkUpdates(instanceName));
    } catch (err) {
      setError(message(err));
    }
    setInstalling(null);
    setProgress(null);
  }

  const updates = check?.updates ?? [];

  return (
    <div data-testid="mod-updates" style={{ background: "#151515", border: "1px solid #6d28d9", borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "#d8b4fe", marginRight: "auto" }}>
          {checking
            ? "Checking for updates..."
            : installing
              ? progress ?? "Updating..."
              : !check
                ? "Updates"
                : updates.length
                  ? `${updates.length} update${updates.length === 1 ? "" : "s"} available`
                  : "Everything is up to date"}
          {check && !checking && !installing && (
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              {" "}
              · checked {check.checked}
              {check.checked > check.identified ? `, ${check.checked - check.identified} not on Modrinth or CurseForge` : ""}
            </span>
          )}
        </span>
        {updates.length > 1 && (
          <button className="sidebar-button" style={{ background: "#7c3aed" }} disabled={Boolean(installing) || checking} onClick={() => install(updates.map((u) => u.key))}>
            Update All
          </button>
        )}
        <button className="sidebar-button" disabled={checking || Boolean(installing)} onClick={runCheck}>
          {check ? "Check Again" : "Check for Updates"}
        </button>
      </div>

      {result && <div style={{ color: "#86efac", fontSize: 13, marginTop: 10 }}>{result}</div>}
      {error && (
        <div role="alert" style={{ color: "#fca5a5", fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      )}

      {updates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {updates.map((update) => (
            <div key={update.key} data-testid="mod-update" style={{ display: "flex", gap: 12, alignItems: "center", background: "#1b1b1b", borderRadius: 10, padding: 8 }}>
              {update.iconUrl ? (
                <img src={update.iconUrl} alt="" width={32} height={32} style={{ borderRadius: 6, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 6, background: "#2b1d47", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#ede9fe", fontSize: 14 }}>
                  {update.name}
                  {TYPE_LABEL[update.type] && <span style={{ color: "#a78bfa", fontSize: 11 }}> ({TYPE_LABEL[update.type]})</span>}
                  {!update.enabled && <span style={{ color: "#6b7280", fontSize: 11 }}> · disabled</span>}
                </div>
                <div style={{ color: "#9ca3af", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {update.current} → <span style={{ color: "#86efac" }}>{update.latest}</span>
                  <span style={{ color: "#6b7280" }}> · {update.source === "modrinth" ? "Modrinth" : "CurseForge"}</span>
                </div>
              </div>
              <button className="sidebar-button" disabled={Boolean(installing) || checking} onClick={() => install([update.key])}>
                {installing?.includes(update.key) ? "Updating..." : "Update"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
