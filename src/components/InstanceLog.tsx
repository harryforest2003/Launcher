import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  instanceName: string;
  /** Runs the instance page's Repair. */
  onRepair?: () => void;
  /** Opens another tab of the instance page. */
  onOpenTab?: (tab: "settings" | "browse") => void;
};

type Level = "info" | "warn" | "error" | "launcher";

const MAX_LINES = 5000;

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const card: React.CSSProperties = {
  background: "#151515",
  border: "1px solid #6d28d9",
  borderRadius: 12,
  padding: 14,
};

const COLOURS: Record<Level, string> = { info: "#e4e4e7", warn: "#fcd34d", error: "#fca5a5", launcher: "#c084fc" };

const HEADER = /^(?:\[[^\]]*\] )?\[[^\]]*\/(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]/;
const EXCEPTION = /^\s*(?:Caused by: |Suppressed: )?(?:[a-zA-Z_$][\w$]*\.)+[\w$]*(?:Exception|Error|Throwable)(?::.*)?$/;

/*
 * Each line's level, from its "[time] [thread/LEVEL]" header. A line without one (a stack
 * trace, the list under "Warnings were found!") belongs to the entry above it, so a
 * warning's trace stays amber and only real errors are red.
 */
function lineLevels(lines: string[]): Level[] {
  let current: Level = "info";
  return lines.map((line) => {
    if (line.startsWith("[Unity Launcher]")) return "launcher";
    const header = line.match(HEADER);
    if (header) {
      current = /WARN/.test(header[1]) ? "warn" : /ERROR|FATAL/.test(header[1]) ? "error" : "info";
      return current;
    }
    if (/^Exception in thread /.test(line)) {
      current = "error";
      return current;
    }
    if (current === "info" && (EXCEPTION.test(line) || /^\s+at \S/.test(line))) return "error";
    return current;
  });
}

const SOURCE_LABEL: Record<NonNullable<CrashCause["evidence"]>["source"], string> = {
  log: "The line in the log that shows it",
  report: "The line in the crash report that shows it",
  java: "The line in Java's crash file that shows it",
};

// Kinds that are never a mod's fault, so the page can say so.
const NOT_A_MOD = new Set(["install", "memory", "graphics", "java-crash"]);

/* The latest run's output, and what went wrong if it crashed. */
export default function InstanceLog({ instanceName, onRepair, onOpenTab }: Props) {
  const [log, setLog] = useState<InstanceLog | null>(null);
  const [help, setHelp] = useState<CrashHelp | null>(null);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [highlight, setHighlight] = useState<number | null>(null);
  // Counts "Show in Log" clicks, so clicking again for the same line still jumps to it.
  const [jumps, setJumps] = useState(0);
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
      setHighlight(null);
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
    if (follow && highlight === null && view.current) view.current.scrollTop = view.current.scrollHeight;
  }, [log, follow, filter, errorsOnly, highlight]);

  // "Show in log": the line in the middle of the view.
  useEffect(() => {
    if (highlight === null || !view.current) return;
    const row = view.current.querySelector<HTMLElement>(`[data-line="${highlight}"]`);
    if (row) view.current.scrollTop = row.offsetTop - view.current.clientHeight / 2;
    view.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlight, jumps]);

  const disable = async (mod: CrashCause["mods"][number]) => {
    try {
      await window.instanceAPI.contentToggle(instanceName, { type: "mod", fileName: mod.fileName }, false);
      setNotice(`Disabled ${mod.name}. Launch again to see if that fixed it.`);
      setHelp(await window.instanceAPI.crashHelp(instanceName));
    } catch (err) {
      setError(message(err));
    }
  };

  const showInLog = (index: number) => {
    setFilter("");
    setErrorsOnly(false);
    setFollow(false);
    setHighlight(index);
    setJumps((count) => count + 1);
  };

  const openFile = (file: string | null) => file && window.instanceAPI.openLogFile(instanceName, file).catch((err) => setError(message(err)));

  const lines = log?.lines ?? [];
  const levels = lineLevels(lines);
  const query = filter.trim().toLowerCase();
  const shown = lines
    .map((line, index) => ({ line, index, level: levels[index] }))
    .filter(({ line, level }) => (!errorsOnly || level === "error") && (!query || line.toLowerCase().includes(query)));

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

  const cause = (item: CrashCause, main: boolean) => (
    <div
      key={item.title}
      data-testid="crash-cause"
      style={{ background: main ? "transparent" : "#151515", borderRadius: 10, padding: main ? 0 : 12, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ color: main ? "#ffffff" : "#fecaca", fontSize: main ? 19 : 15, fontWeight: 600 }}>{item.title}</div>

      {item.detail && <div style={{ color: "#d4d4d8", fontSize: 13, lineHeight: 1.5 }}>{item.detail}</div>}

      {item.evidence && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ color: "#9ca3af", fontSize: 12 }}>{SOURCE_LABEL[item.evidence.source]}</span>
            {item.evidence.source === "log" ? (
              <button className="sidebar-button" style={{ padding: "2px 10px", fontSize: 11, marginLeft: "auto" }} onClick={() => showInLog(item.evidence!.index)}>
                Show in Log
              </button>
            ) : (
              <button
                className="sidebar-button"
                style={{ padding: "2px 10px", fontSize: 11, marginLeft: "auto" }}
                onClick={() => openFile(item.evidence!.source === "report" ? (help?.crashed ? help.reportFile : null) : help?.crashed ? help.jvmCrashFile : null)}
              >
                {item.evidence.source === "report" ? "Open Crash Report" : "Open Java Crash File"}
              </button>
            )}
          </div>
          <div
            data-testid="crash-evidence"
            style={{
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              fontSize: 12,
              color: "#fca5a5",
              background: "#0b0b0b",
              border: "1px solid #3f1d1d",
              borderRadius: 8,
              padding: "8px 10px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {item.evidence.text}
          </div>
        </div>
      )}

      {item.mods.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#9ca3af", fontSize: 12 }}>{item.mods.length === 1 ? "Mod:" : "Mods:"}</span>
          {item.mods.map((mod) => (
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
      ) : (
        NOT_A_MOD.has(item.kind) && <div style={{ color: "#9ca3af", fontSize: 12 }}>Not caused by a mod.</div>
      )}

      {item.fix && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "#0f1f14", border: "1px solid #14532d", borderRadius: 8, padding: "8px 10px" }}>
          <span style={{ color: "#86efac", fontSize: 13, flex: "1 1 240px" }}>
            <b>How to fix it: </b>
            {item.fix}
          </span>
          {item.action === "repair" && onRepair && (
            <button className="sidebar-button" style={{ padding: "4px 12px", fontSize: 12 }} onClick={onRepair}>
              Repair
            </button>
          )}
          {item.action === "settings" && onOpenTab && (
            <button className="sidebar-button" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => onOpenTab("settings")}>
              Open Settings
            </button>
          )}
          {item.action === "add-content" && onOpenTab && (
            <button className="sidebar-button" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => onOpenTab("browse")}>
              Add Content
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div data-testid="log-tab" style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
      {help?.crashed && (
        <div data-testid="crash-help" style={{ ...card, borderColor: "#ef4444", background: "#1f0b0b", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#f87171", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MINECRAFT CRASHED</span>
            {help.description && <span style={{ color: "#9ca3af", fontSize: 12 }}>while {help.description.toLowerCase()}</span>}
          </div>

          {cause(help.causes[0], true)}

          {help.causes.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ color: "#9ca3af", fontSize: 12 }}>Also found:</div>
              {help.causes.slice(1).map((item) => cause(item, false))}
            </div>
          )}

          {(help.reportFile || help.jvmCrashFile) && (
            <div style={{ display: "flex", gap: 8 }}>
              {help.reportFile && (
                <button className="sidebar-button" onClick={() => openFile(help.reportFile)}>
                  Open Crash Report
                </button>
              )}
              {help.jvmCrashFile && (
                <button className="sidebar-button" onClick={() => openFile(help.jvmCrashFile)}>
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
          onChange={(e) => {
            setFilter(e.target.value);
            setHighlight(null);
          }}
          placeholder="Filter..."
          aria-label="Filter the log"
          style={{ padding: "6px 10px", borderRadius: 8, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", width: 160 }}
        />
        <label style={{ color: "#d4d4d8", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => {
              setErrorsOnly(e.target.checked);
              setHighlight(null);
            }}
          />
          Errors only
        </label>
        <label style={{ color: "#d4d4d8", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              setFollow(e.target.checked);
              if (e.target.checked) setHighlight(null);
            }}
          />
          Follow
        </label>
        <button
          className="sidebar-button"
          style={{ padding: "6px 12px", fontSize: 12 }}
          disabled={!shown.length}
          onClick={() =>
            navigator.clipboard
              .writeText(shown.map(({ line }) => line).join("\n"))
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
          if (atEnd !== follow && highlight === null) setFollow(atEnd);
        }}
        style={{
          ...card,
          position: "relative",
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
          shown.map(({ line, index, level }) => (
            <div
              key={index}
              data-line={index}
              style={{
                color: COLOURS[level],
                ...(index === highlight ? { background: "#4c1d1d", outline: "1px solid #ef4444", borderRadius: 3 } : null),
              }}
            >
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
