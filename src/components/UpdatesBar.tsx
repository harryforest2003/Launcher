import type { ContentUpdates } from "./useContentUpdates";
import { updateKey } from "./useContentUpdates";
import { CheckIcon, DownloadIcon, RefreshIcon } from "./Icons";

const GREEN = "#16a34a";

/* In line with the content tabs: what the update check found, Check Again and Update All. */
export function UpdatesControls({ updates }: { updates: ContentUpdates }) {
  const count = updates.updates.length;
  const busy = updates.installing.length > 0;

  const text = busy
    ? (updates.progress ?? "Updating...")
    : updates.checking
      ? "Checking for updates..."
      : count
        ? "" // Update All says how many.
        : "Up to date";

  return (
    <div data-testid="updates-bar" style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: count && !busy ? "#86efac" : "#9ca3af", fontSize: 12 }}>
        {!updates.checking && !busy && !count && (
          <span style={{ color: GREEN, display: "inline-flex" }}>
            <CheckIcon size={14} />
          </span>
        )}
        <span data-testid="updates-status" title={count ? `${count} update${count === 1 ? "" : "s"} available` : undefined}>
          {text}
        </span>
      </span>

      <button
        className="sidebar-button"
        title="Check for updates again"
        aria-label="Check for updates again"
        disabled={updates.checking || busy}
        onClick={updates.recheck}
        style={{ padding: 6, display: "inline-flex", alignItems: "center" }}
      >
        <RefreshIcon size={14} />
      </button>

      <button
        className="sidebar-button"
        data-testid="update-all"
        disabled={!count || updates.checking || busy}
        onClick={updates.updateAll}
        style={{
          padding: "6px 12px",
          fontSize: 13,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: count ? GREEN : undefined,
          borderColor: count ? GREEN : undefined,
          opacity: count ? 1 : 0.5,
        }}
      >
        <DownloadIcon size={14} />
        Update All{count ? ` (${count})` : ""}
      </button>
    </div>
  );
}

const ago = (time: string) => {
  const minutes = Math.round((Date.now() - Date.parse(time)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

/* Under the toolbar: what the last update did or why it couldn't, and undoing it. */
export function UpdatesMessages({ updates }: { updates: ContentUpdates }) {
  const batch = updates.lastBatch;
  if (!updates.result && !updates.error && !batch) return null;
  return (
    <div style={{ marginBottom: 12, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
      {updates.result && <div style={{ color: "#86efac" }}>{updates.result}</div>}
      {updates.error && (
        <div role="alert" style={{ color: "#fca5a5" }}>
          {updates.error}
        </div>
      )}
      {batch && (
        <div data-testid="last-update" style={{ color: "#9ca3af", fontSize: 12, display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={batch.names.join("\n")}>
            Last change, {ago(batch.time)}: {batch.names.length === 1 ? batch.names[0] : `${batch.names.length} items`}
          </span>
          <button
            data-testid="undo-update"
            disabled={updates.installing.length > 0}
            onClick={updates.undo}
            style={{ background: "none", border: "none", color: "#c4b5fd", cursor: "pointer", fontSize: 12, padding: 0, whiteSpace: "nowrap" }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

const SLOT: React.CSSProperties = { width: 32, height: 32, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };

/*
 * On each item: an update button when there's a newer build, a tick when it's the newest.
 * Either opens the version list (onPick), to update or to go back to an older version.
 */
export function ItemUpdateStatus({ item, updates, onPick }: { item: InstanceMod; updates: ContentUpdates; onPick: (item: InstanceMod) => void }) {
  if (item.kind !== "file") return null;
  const status = updates.statusOf(item);
  const key = updateKey(item);

  if (updates.installing.includes(key)) {
    return <span style={{ ...SLOT, width: "auto", color: "#86efac", fontSize: 11 }}>Updating...</span>;
  }

  if (!status) {
    return updates.checking ? <span style={{ ...SLOT, color: "#6b7280" }}>…</span> : null;
  }

  if (status.state === "update") {
    return (
      <button
        data-testid="item-update"
        title={`Update${status.current ? ` from ${status.current}` : ""} to ${status.latest}, or choose another version`}
        aria-label={`Choose a version of ${status.name ?? item.name}`}
        disabled={updates.installing.length > 0}
        onClick={() => onPick(item)}
        style={{ ...SLOT, padding: 0, background: GREEN, color: "white", border: "none", borderRadius: 8, cursor: "pointer" }}
      >
        <DownloadIcon size={16} />
      </button>
    );
  }

  if (status.state === "current") {
    return (
      <button
        data-testid="item-current"
        title={`Up to date${status.current ? ` (${status.current})` : ""}. Click to choose another version.`}
        aria-label={`Choose a version of ${status.name ?? item.name}`}
        disabled={updates.installing.length > 0}
        onClick={() => onPick(item)}
        className="tick-button"
        style={{ ...SLOT, padding: 0, color: GREEN }}
      >
        <CheckIcon size={18} />
      </button>
    );
  }

  return (
    <span title="Not from Modrinth or CurseForge, so it can't be checked for updates" style={{ ...SLOT, color: "#52525b" }}>
      –
    </span>
  );
}
