import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";

const GAME_NAMES: Record<string, string> = {
  sims4: "The Sims 4",
  gtav: "GTA V",
  skyrimse: "Skyrim",
  fallout4: "Fallout 4",
  cyberpunk2077: "Cyberpunk 2077",
  stardew: "Stardew Valley",
};

const STATUS: Record<GameQueueItem["status"], { label: string; colour: string }> = {
  waiting: { label: "Waiting", colour: "#9ca3af" },
  working: { label: "Getting it", colour: "#c084fc" },
  website: { label: "On Nexus Mods", colour: "#fcd34d" },
  done: { label: "Done", colour: "#86efac" },
  failed: { label: "Didn't work", colour: "#fca5a5" },
  skipped: { label: "Skipped", colour: "#6b7280" },
};

const button: React.CSSProperties = { padding: "5px 10px", fontSize: 12 };

/*
 * The game sections' downloads, on every page: what's being got now, how many are left,
 * and for a free Nexus account, which page to press the download button on.
 */
export default function DownloadQueue() {
  const [queue, setQueue] = useState<GameQueue | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.gamesAPI?.queue) return;
    let active = true;
    window.gamesAPI
      .queue()
      .then((found) => active && found && setQueue(found))
      .catch(() => {});
    const stop = window.gamesAPI.onQueue((next) => setQueue(next));
    return () => {
      active = false;
      stop();
    };
  }, []);

  if (!queue || queue.counts.total === 0) return null;
  const { current, counts } = queue;
  const left = counts.waiting + (current ? 1 : 0);
  const finished = counts.done + counts.failed + counts.skipped;
  if (!left && !open && finished === 0) return null;
  const fraction = counts.total ? finished / counts.total : 0;

  return (
    <div
      data-testid="download-queue"
      style={{
        position: "fixed",
        right: 16,
        bottom: 48,
        zIndex: 8000,
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        background: "#17141f",
        border: "1px solid #6d28d9",
        borderRadius: 12,
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.5)",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <Download size={16} color="#c084fc" />
        <span style={{ flex: 1, fontWeight: 600, color: "#e9d5ff" }}>
          {left ? `Downloads: ${left} to go` : `Downloads: all done${counts.failed ? ` (${counts.failed} didn't work)` : ""}`}
        </span>
        <button onClick={() => setOpen((now) => !now)} aria-label={open ? "Hide the list" : "Show the list"} style={{ background: "none", border: "none", color: "#c084fc", cursor: "pointer", display: "flex" }}>
          {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </div>
      <div style={{ height: 3, background: "#2e2e2e", margin: "0 12px" }}>
        <div style={{ width: `${Math.round(fraction * 100)}%`, height: "100%", background: "#7c3aed", transition: "width .2s" }} />
      </div>

      {current && (
        <div style={{ padding: "10px 12px 0" }} data-testid="queue-current">
          <div style={{ color: "#e9d5ff" }}>
            {current.name} <span style={{ color: "#6b7280" }}>• {GAME_NAMES[current.gameId] ?? current.gameId}</span>
          </div>
          <div style={{ color: current.status === "website" ? "#fcd34d" : "#9ca3af", fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>
            {current.status === "website"
              ? "Press the download button on the Nexus Mods page that opened; the launcher installs it and opens the next."
              : (current.detail ?? "Getting it...")}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, padding: "10px 12px", flexWrap: "wrap" }}>
        {current?.status === "website" && (
          <>
            <button className="sidebar-button" style={button} onClick={() => window.gamesAPI.queueControl("open")}>
              Open the page again
            </button>
            <button className="sidebar-button" style={button} onClick={() => window.gamesAPI.queueControl("skip")}>
              Skip this one
            </button>
          </>
        )}
        {left > 0 && (
          <button className="sidebar-button" style={button} onClick={() => window.gamesAPI.queueControl("stop")}>
            Stop
          </button>
        )}
        {counts.failed > 0 && (
          <button className="sidebar-button" style={button} onClick={() => window.gamesAPI.queueControl("retry")}>
            Try failed again
          </button>
        )}
        {!left && (
          <button className="sidebar-button" style={button} onClick={() => window.gamesAPI.queueControl("clear")}>
            Clear
          </button>
        )}
      </div>

      {open && (
        <div style={{ maxHeight: 260, overflowY: "auto", borderTop: "1px solid #2e2e2e", padding: "6px 12px 10px" }}>
          {queue.items.map((item) => (
            <div key={item.id} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.error ?? undefined}>
                {item.name} <span style={{ color: "#6b7280" }}>• {GAME_NAMES[item.gameId] ?? item.gameId}</span>
              </span>
              <span style={{ color: STATUS[item.status].colour, flexShrink: 0 }}>{STATUS[item.status].label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
