import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = { instanceName: string };

const MAX_LINES = 5000;

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 14,
};

function lineColour(line: string) {
  if (line.startsWith("[Unity Launcher]")) return "#c084fc";
  if (/\b(ERROR|FATAL)\b|Exception|^\s+at |Caused by|^Error/.test(line)) return "#fca5a5";
  if (/\bWARN\b/.test(line)) return "#fcd34d";
  return "#d4d4d8";
}

const isError = (line: string) => lineColour(line) === "#fca5a5";

/* The latest run's output, and what went wrong if it crashed. */
export default function InstanceLog({ instanceName }: Props) {
  const [log, setLog] = useState<InstanceLog | null>(null);
  const [help, setHelp] = useState<CrashHelp | null>(null);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);

  const fetchLatest = useCallback(
    () => Promise.all([window.instanceAPI.log(instanceName), window.instanceAPI.crashHelp(instanceName)]),
    [instanceName]
  );

  const load = useCallback(() => {
    fetchLatest()
      .then(([latest, crash]) => {
        setLog(latest);
        setHelp(crash);
        setError(null);
      })
      .catch((err) => setError(message(err)));
  }, [fetchLatest]);

  useEffect(() => {
    let current = true;
    fetchLatest()
      .then(([latest, crash]) => {
        if (!current) return;
        setLog(latest);
        setHelp(crash);
      })
      .catch((err) => current && setError(message(err)));
    return () => {
      current = false;
    };
  }, [fetchLatest]);

  // New output as it arrives; on exit, the final state and crash help.
  useEffect(() => {
    let partial = "";
    const stopLog = window.instanceAPI.onLog(({ name, text }) => {
      if (name !== instanceName) return;
      const parts = (partial + text).split(/\r?\n/);
      partial = parts.pop() ?? "";
      if (!parts.length) return;
      setLog((current) => {
        const base: InstanceLog =
          current && current.source === "live" ? current : { source: "live", running: true, startedAt: Date.now(), endedAt: null, exitCode: null, lines: [] };
        return { ...base, running: true, lines: [...base.lines, ...parts].slice(-MAX_LINES) };
      });
      setHelp({ crashed: false });
    });
    const stopExit = window.instanceAPI.onExit(({ name }) => {
      if (name === instanceName) setTimeout(load, 300);
    });
    return () => {
      stopLog();
      stopExit();
    };
  }, [instanceName, load]);

  useLayoutEffect(() => {
    if (follow && view.current) view.current.scrollTop = view.current.scrollHeight;
  }, [log, follow, filter, errorsOnly]);

  const disable = async (mod: CrashCause["mods"][number]) => {
    try {
      await window.instanceAPI.contentToggle(instanceName, { type: "mod", fileName: mod.fileName }, false);
      setNotice(`Disabled ${mod.name}. Launch again to see if that fixed it.`);
      setHelp(await window.instanceAPI.crashHelp(instanceName));
    } catch (err) {
      setError(message(err));
    }
  };

  const shown = (log?.lines ?? []).filter(
    (line) => (!errorsOnly || isError(line)) && (!filter.trim() || line.toLowerCase().includes(filter.trim().toLowerCase()))
  );

  const status = !log
    ? "Loading..."
    : log.running
      ? "Running"
      : log.source === "none"
        ? "No log yet. It appears here when the game runs."
        : log.source === "file"
          ? `Last run${log.endedAt ? `, ${new Date(log.endedAt).toLocaleString()}` : ""}`
          : log.exitCode === 0
            ? "Closed normally"
            : `Stopped${log.exitCode !== null ? ` (exit code ${log.exitCode})` : ""}`;

  return (
    <div data-testid="log-tab" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {help?.crashed && (
        <div data-testid="crash-help" style={{ ...card, borderColor: "#ef4444", background: "#1f0b0b" }}>
          <div style={{ color: "#fca5a5", fontWeight: 600, marginBottom: 4 }}>Minecraft crashed: {help.summary}</div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 10 }}>
            {help.causes.length > 1 ? "What the crash points to, most likely first:" : "What the crash points to:"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {help.causes.map((cause) => (
              <div key={cause.title} data-testid="crash-cause" style={{ background: "#151515", borderRadius: 10, padding: 12 }}>
                <div style={{ color: "#fecaca", marginBottom: 4 }}>{cause.title}</div>
                {cause.detail && (
                  <div style={{ color: "#a1a1aa", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 4 }}>{cause.detail}</div>
                )}
                {cause.fix && <div style={{ color: "#86efac", fontSize: 12 }}>{cause.fix}</div>}
                {cause.mods.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {cause.mods.map((mod) => (
                      <span key={mod.fileName} style={{ display: "inline-flex", gap: 6, alignItems: "center", background: "#232323", borderRadius: 8, padding: "4px 4px 4px 10px", fontSize: 12 }}>
                        <span title={mod.fileName}>{mod.name}</span>
                        {mod.enabled ? (
                          <button className="sidebar-button" style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => disable(mod)}>
                            Disable
                          </button>
                        ) : (
                          <span style={{ color: "#6b7280", padding: "0 6px" }}>disabled</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {(help.reportFile || help.jvmCrashFile) && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {help.reportFile && (
                <button className="sidebar-button" onClick={() => window.instanceAPI.openLogFile(instanceName, help.reportFile!).catch((err) => setError(message(err)))}>
                  Open Crash Report
                </button>
              )}
              {help.jvmCrashFile && (
                <button className="sidebar-button" onClick={() => window.instanceAPI.openLogFile(instanceName, help.jvmCrashFile!).catch((err) => setError(message(err)))}>
                  Open Java Crash File
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {notice && <div style={{ color: "#86efac", fontSize: 13 }}>{notice}</div>}
      {error && (
        <div role="alert" style={{ color: "#fca5a5", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span data-testid="log-status" style={{ color: log?.running ? "#86efac" : "#9ca3af", fontSize: 13, marginRight: "auto" }}>
          {status}
        </span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          aria-label="Filter the log"
          style={{ padding: "6px 10px", borderRadius: 8, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", width: 160 }}
        />
        <label style={{ color: "#d4d4d8", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Errors only
        </label>
        <label style={{ color: "#d4d4d8", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
        <button
          className="sidebar-button"
          style={{ padding: "6px 12px", fontSize: 12 }}
          disabled={!shown.length}
          onClick={() =>
            navigator.clipboard
              .writeText(shown.join("\n"))
              .then(() => setNotice(`Copied ${shown.length.toLocaleString()} lines.`))
              .catch((err) => setError(message(err)))
          }
        >
          Copy
        </button>
        <button className="sidebar-button" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => window.instanceAPI.openLogFile(instanceName).catch((err) => setError(message(err)))}>
          Open Logs Folder
        </button>
      </div>

      <div
        ref={view}
        data-testid="log-view"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (atEnd !== follow) setFollow(atEnd);
        }}
        style={{
          ...card,
          height: 460,
          overflow: "auto",
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {shown.length ? (
          shown.map((line, i) => (
            <div key={i} style={{ color: lineColour(line) }}>
              {line || " "}
            </div>
          ))
        ) : (
          <div style={{ color: "#6b7280" }}>{log && log.lines.length ? "Nothing matches." : "Nothing here yet."}</div>
        )}
      </div>
    </div>
  );
}
