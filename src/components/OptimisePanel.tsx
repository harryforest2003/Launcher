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
  fix: { colour: "var(--color-warning-text)", label: "Could be faster" },
  tip: { colour: "var(--color-accent-text)", label: "Worth knowing" },
  ok: { colour: "var(--color-success-text)", label: "Fine" },
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

  const fixable = report?.items.filter((item) => item.state === "fix" && (item.action || item.fixes?.some((f) => f.recommended))) ?? [];
  const hw = report?.hardware;
  const blocked = Boolean(busy) || Boolean(report?.running);

  return (
    <div
      data-testid="optimise-panel"
      onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--color-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
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
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px var(--color-shadow)",
          textAlign: "left",
          color: "var(--color-text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--color-accent-subtle)", color: "var(--color-accent-text)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Gauge size={22} aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-accent-text)" }}>Optimise {instanceName}</div>
            <div data-testid="optimise-hardware" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {hw
                ? [hw.gpu ? `${hw.gpu}${hw.builtIn ? " (built in)" : ""}` : "Unknown graphics", `${hw.memoryGb} GB memory`, hw.retina ? "Retina screen" : null].filter(Boolean).join(" · ")
                : "Looking at your computer and this instance..."}
            </div>
          </div>
          <button aria-label="Close" disabled={!!busy} onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--color-text-muted)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "12px 16px", flex: 1 }}>
          {report?.running && (
            <div role="alert" style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 10, background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", color: "var(--color-warning-text)", fontSize: 13 }}>
              Close Minecraft to change these: it saves its own settings when it quits, over anything changed while it's open.
            </div>
          )}

          {loadError ? (
            <div style={{ color: "var(--color-danger-text)", fontSize: 13, padding: 8 }}>{loadError}</div>
          ) : !report ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: 8 }}>Checking mods, shaders, Java and graphics settings...</div>
          ) : (
            report.items.map((item) => {
              const state = STATE[item.state];
              return (
                <div
                  key={item.id}
                  data-testid={`optimise-${item.id}`}
                  data-state={item.state}
                  style={{ display: "flex", gap: 12, padding: "12px 14px", marginBottom: 8, borderRadius: 10, background: "var(--color-surface-sunken)", border: `1px solid ${item.state === "ok" ? "var(--color-border)" : "var(--color-border)"}` }}
                >
                  <span
                    aria-label={state.label}
                    data-tip={state.label}
                    style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", color: state.colour, border: `1.5px solid ${state.colour}` }}
                  >
                    {item.state === "ok" ? <CheckIcon size={13} /> : item.state === "fix" ? <span style={{ fontWeight: 800, fontSize: 13, lineHeight: 1 }}>!</span> : <Info size={13} aria-hidden="true" />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--color-accent-text)" }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>{item.detail}</div>
                    {item.fixes && item.fixes.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        {item.fixes.map((one) => {
                          const id = `${item.id}:${one.id}`;
                          return (
                            <div key={one.id} data-testid={`optimise-limit-${one.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                              <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
                                <span style={{ color: "var(--color-accent-text)", fontWeight: 600 }}>{one.label}</span>: {one.text}
                              </div>
                              <button
                                className="sidebar-button"
                                data-testid={`optimise-fix-${id}`}
                                disabled={blocked}
                                onClick={() => fix([id], id)}
                                style={{ padding: "5px 10px", fontSize: 12, whiteSpace: "nowrap", background: one.recommended ? "var(--color-accent-subtle)" : undefined }}
                              >
                                {busy === id ? "Working..." : one.action}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {item.list && item.list.length > 0 && (
                      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
                        {item.list.map((entry) => (
                          <li key={entry.label} style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>
                            <span style={{ color: "var(--color-accent-text)", fontWeight: 600 }}>{entry.label}</span>: {entry.text}
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
                      style={{ alignSelf: "center", padding: "7px 12px", fontSize: 12, whiteSpace: "nowrap", background: item.state === "fix" ? "var(--color-accent-subtle)" : undefined }}
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
            {busy && progress && <div style={{ color: "var(--color-accent-text)" }}>{progress}</div>}
            {result?.done.map((line) => (
              <div key={line} style={{ color: "var(--color-success-text)" }}>
                {line}
              </div>
            ))}
            {result?.skipped.map((skip) => (
              <div key={skip.name} style={{ color: "var(--color-warning-text)" }}>
                Left out {skip.name}: {skip.reason}.
              </div>
            ))}
            {result && result.done.length === 0 && result.skipped.length === 0 && <div style={{ color: "var(--color-text-muted)" }}>Nothing needed changing.</div>}
            {error && <div style={{ color: "var(--color-danger-text)" }}>{error}</div>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>
          {report?.undo ? (
            <button className="sidebar-button" data-testid="optimise-undo" disabled={blocked} onClick={undo} style={{ padding: "8px 14px", fontSize: 13 }}>
              {busy === "undo" ? "Putting back..." : "Undo Optimise"}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Changes take effect next time you play.</span>
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
              style={{ padding: "8px 14px", fontSize: 13, background: "var(--color-accent)", color: "var(--color-on-accent)" }}
            >
              {busy === "all" ? "Working..." : `Fix all (${fixable.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
