import { useCallback, useEffect, useState } from "react";
import { Gauge, Info } from "lucide-react";
import { CheckIcon } from "./Icons";

type Props = {
  instanceName: string;
  /** Something was changed: the instance's page refreshes (memory, mods). */
  onChanged: () => void;
  onClose: () => void;
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const STATE = {
  fix: { colour: "#f59e0b", label: "Could be faster" },
  tip: { colour: "#a78bfa", label: "Worth knowing" },
  ok: { colour: "#22c55e", label: "Fine" },
} as const;

/*
 * What's slowing an instance down and a fix for each, like Lunar Client's performance
 * settings: speed mods, shaders, Java settings, graphics settings and resource packs.
 * Nothing changes until a fix is chosen, and Undo puts everything back.
 */
export default function OptimisePanel({ instanceName, onChanged, onClose }: Props) {
  const [report, setReport] = useState<OptimiseReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ done: string[]; skipped: { name: string; reason: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      window.instanceAPI
        .optimiseCheck(instanceName)
        .then((found) => {
          setReport(found);
          setLoadError(null);
        })
        .catch((err) => setLoadError(message(err))),
    [instanceName]
  );

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .optimiseCheck(instanceName)
      .then((found) => current && setReport(found))
      .catch((err) => current && setLoadError(message(err)));
    return () => {
      current = false;
    };
  }, [instanceName]);

  useEffect(
    () =>
      window.instanceAPI.onProgress((p) => {
        if (p.name === instanceName && p.stage === "optimise") setProgress(p.detail ?? null);
      }),
    [instanceName]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function fix(ids: string[], label: string) {
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      setResult(await window.instanceAPI.optimiseApply(instanceName, ids));
      onChanged();
    } catch (err) {
      setError(message(err));
    }
    setProgress(null);
    await load();
    setBusy(null);
  }

  async function undo() {
    setBusy("undo");
    setError(null);
    setResult(null);
    try {
      const done = await window.instanceAPI.optimiseUndo(instanceName);
      setResult({ done: [`Put back: ${done.restored.join(", ") || "nothing needed changing"}.`], skipped: [] });
      onChanged();
    } catch (err) {
      setError(message(err));
    }
    await load();
    setBusy(null);
  }

  const fixable = report?.items.filter((item) => item.state === "fix" && item.action) ?? [];
  const hw = report?.hardware;
  const blocked = Boolean(busy) || Boolean(report?.running);

  return (
    <div
      data-testid="optimise-panel"
      onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0, 0, 0, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="dialog"
        aria-label={`Optimise ${instanceName}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 100%)",
          maxHeight: "min(800px, 92vh)",
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
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "#2b1d47", color: "#c4b5fd", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Gauge size={22} aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#e9d5ff" }}>Optimise {instanceName}</div>
            <div data-testid="optimise-hardware" style={{ fontSize: 12, color: "#9ca3af" }}>
              {hw
                ? [hw.gpu ? `${hw.gpu}${hw.builtIn ? " (built in)" : ""}` : "Unknown graphics", `${hw.memoryGb} GB memory`, hw.retina ? "Retina screen" : null].filter(Boolean).join(" · ")
                : "Looking at your computer and this instance..."}
            </div>
          </div>
          <button aria-label="Close" disabled={!!busy} onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#9ca3af", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "12px 16px", flex: 1 }}>
          {report?.running && (
            <div role="alert" style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 10, background: "#2a1a05", border: "1px solid #b45309", color: "#fcd34d", fontSize: 13 }}>
              Close Minecraft to change these: it saves its own settings when it quits, over anything changed while it's open.
            </div>
          )}

          {loadError ? (
            <div style={{ color: "#fca5a5", fontSize: 13, padding: 8 }}>{loadError}</div>
          ) : !report ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 8 }}>Checking mods, shaders, Java and graphics settings...</div>
          ) : (
            report.items.map((item) => {
              const state = STATE[item.state];
              return (
                <div
                  key={item.id}
                  data-testid={`optimise-${item.id}`}
                  data-state={item.state}
                  style={{ display: "flex", gap: 12, padding: "12px 14px", marginBottom: 8, borderRadius: 10, background: "#100e16", border: `1px solid ${item.state === "ok" ? "#231d31" : "#3b2a5c"}` }}
                >
                  <span
                    aria-label={state.label}
                    data-tip={state.label}
                    style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", color: state.colour, border: `1.5px solid ${state.colour}` }}
                  >
                    {item.state === "ok" ? <CheckIcon size={13} /> : item.state === "fix" ? <span style={{ fontWeight: 800, fontSize: 13, lineHeight: 1 }}>!</span> : <Info size={13} aria-hidden="true" />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#ede9fe" }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 2 }}>{item.detail}</div>
                    {item.list && item.list.length > 0 && (
                      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
                        {item.list.map((entry) => (
                          <li key={entry.label} style={{ fontSize: 12, color: "#d4d4d8", marginTop: 3 }}>
                            <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{entry.label}</span>: {entry.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {item.action && (
                    <button
                      className="sidebar-button"
                      data-testid={`optimise-fix-${item.id}`}
                      disabled={blocked}
                      onClick={() => fix([item.id], item.id)}
                      style={{ alignSelf: "center", padding: "7px 12px", fontSize: 12, whiteSpace: "nowrap", background: item.state === "fix" ? "#7c3aed" : undefined }}
                    >
                      {busy === item.id ? "Working..." : item.action}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {(result || error || (busy && progress)) && (
          <div data-testid="optimise-result" style={{ margin: "0 20px", fontSize: 13 }}>
            {busy && progress && <div style={{ color: "#c4b5fd" }}>{progress}</div>}
            {result?.done.map((line) => (
              <div key={line} style={{ color: "#86efac" }}>
                {line}
              </div>
            ))}
            {result?.skipped.map((skip) => (
              <div key={skip.name} style={{ color: "#fcd34d" }}>
                Left out {skip.name}: {skip.reason}.
              </div>
            ))}
            {result && result.done.length === 0 && result.skipped.length === 0 && <div style={{ color: "#9ca3af" }}>Nothing needed changing.</div>}
            {error && <div style={{ color: "#fca5a5" }}>{error}</div>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid #2e2640" }}>
          {report?.undo ? (
            <button className="sidebar-button" data-testid="optimise-undo" disabled={blocked} onClick={undo} style={{ padding: "8px 14px", fontSize: 13 }}>
              {busy === "undo" ? "Putting back..." : "Undo Optimise"}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "#71717a" }}>Changes take effect next time you play.</span>
          )}
          <span style={{ marginLeft: "auto" }} />
          <button className="sidebar-button" disabled={!!busy} onClick={onClose} style={{ padding: "8px 14px", fontSize: 13 }}>
            Close
          </button>
          {fixable.length > 0 && (
            <button
              className="sidebar-button"
              data-testid="optimise-fix-all"
              disabled={blocked}
              onClick={() => fix(fixable.map((item) => item.id), "all")}
              style={{ padding: "8px 14px", fontSize: 13, background: "#7c3aed" }}
            >
              {busy === "all" ? "Working..." : `Fix all (${fixable.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
