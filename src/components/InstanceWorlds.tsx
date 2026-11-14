import { useCallback, useEffect, useState } from "react";

type Props = { instanceName: string };

const card: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: 14,
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/* An instance's worlds: what they are, when they were played, and their files. */
export default function InstanceWorlds({ instanceName }: Props) {
  const [worlds, setWorlds] = useState<InstanceWorld[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    window.instanceAPI
      .worlds(instanceName)
      .then((list) => {
        setWorlds(list);
        setError(null);
      })
      .catch((err) => setError(message(err)));
  }, [instanceName]);

  useEffect(load, [load]);

  const act = async (request: Parameters<typeof window.instanceAPI.fileAction>[1]) => {
    try {
      await window.instanceAPI.fileAction(instanceName, request);
      if (request.action === "trash") load();
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <div data-testid="worlds-tab">
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--color-text-muted)", fontSize: 13, marginRight: "auto" }}>
          {worlds ? `${worlds.length} world${worlds.length === 1 ? "" : "s"}` : "Loading..."}
        </span>
        <button className="sidebar-button" onClick={load}>
          Refresh
        </button>
        <button className="sidebar-button" onClick={() => act({ kind: "world", action: "folder" })}>
          Open Worlds Folder
        </button>
      </div>

      {error && (
        <div role="alert" style={{ ...card, borderColor: "var(--color-danger-border)", color: "var(--color-danger-text)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {worlds && worlds.length === 0 && (
        <div style={{ ...card, color: "var(--color-text-muted)" }}>No worlds yet. They appear here once you've played one.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {worlds?.map((world) => (
          <div key={world.folder} data-testid="world" style={{ ...card, display: "flex", gap: 14, alignItems: "center" }}>
            {world.icon ? (
              <img src={world.icon} alt="" width={56} height={56} style={{ borderRadius: 8, imageRendering: "pixelated", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--color-surface)", flexShrink: 0 }} />
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--color-accent-text)", fontWeight: 600 }}>{world.name}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
                {[
                  world.hardcore ? "Hardcore" : world.gameMode,
                  world.cheats ? "Cheats on" : null,
                  world.version ? `Minecraft ${world.version}` : null,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                Last played {new Date(world.lastPlayed).toLocaleString()} • {formatBytes(world.size)}
                {world.folder !== world.name ? ` • folder "${world.folder}"` : ""}
              </div>
            </div>

            <button className="sidebar-button" onClick={() => act({ kind: "world", name: world.folder, action: "show" })}>
              Show Files
            </button>
            <button
              className="sidebar-button"
              style={{ background: "var(--color-danger-solid)" }}
              onClick={() => {
                if (window.confirm(`Move "${world.name}" to the Bin? You can get it back from there.`)) {
                  act({ kind: "world", name: world.folder, action: "trash" });
                }
              }}
            >
              Move to Bin
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
