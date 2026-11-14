import { useCallback, useEffect, useState } from "react";

type Props = { instanceName: string };

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const small: React.CSSProperties = { padding: "4px 10px", fontSize: 12 };

/* An instance's screenshots, newest first. Clicking one opens it full size. */
export default function InstanceScreenshots({ instanceName }: Props) {
  const [shots, setShots] = useState<InstanceScreenshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    window.instanceAPI
      .screenshots(instanceName)
      .then((list) => {
        setShots(list);
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
    <div data-testid="screenshots-tab">
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--color-text-muted)", fontSize: 13, marginRight: "auto" }}>
          {shots ? `${shots.length} screenshot${shots.length === 1 ? "" : "s"}` : "Loading..."}
          {shots && shots.length > 0 ? " • F2 in game takes one" : ""}
        </span>
        <button className="sidebar-button" onClick={load}>
          Refresh
        </button>
        <button className="sidebar-button" onClick={() => act({ kind: "screenshot", action: "folder" })}>
          Open Screenshots Folder
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: "var(--color-danger-text)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {shots && shots.length === 0 && (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 14, color: "var(--color-text-muted)" }}>
          No screenshots yet. Press F2 in game to take one.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
        {shots?.map((shot) => (
          <div
            key={shot.fileName}
            data-testid="screenshot"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}
          >
            <button
              onClick={() => act({ kind: "screenshot", name: shot.fileName, action: "open" })}
              title="Open full size"
              style={{ display: "block", width: "100%", padding: 0, border: "none", background: "var(--color-bg)", cursor: "zoom-in" }}
            >
              {shot.thumbnail ? (
                <img src={shot.thumbnail} alt={shot.fileName} style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ aspectRatio: "16 / 9", color: "var(--color-text-muted)", display: "grid", placeItems: "center" }}>No preview</div>
              )}
            </button>
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{new Date(shot.taken).toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
                {shot.width} × {shot.height}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="sidebar-button" style={small} onClick={() => act({ kind: "screenshot", name: shot.fileName, action: "show" })}>
                  Show File
                </button>
                <button
                  className="sidebar-button"
                  style={{ ...small, background: "var(--color-danger-solid)" }}
                  onClick={() => {
                    if (window.confirm("Move this screenshot to the Bin?")) act({ kind: "screenshot", name: shot.fileName, action: "trash" });
                  }}
                >
                  Move to Bin
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
