import type { ContentUpdates } from "./useContentUpdates";
import { updateKey } from "./useContentUpdates";
import { CheckIcon, DownloadIcon, RefreshIcon } from "./UpdateIcons";

const GREEN = "#16a34a";

/* Above the content list: what the update check found, Update All, and Check Again. */
export function UpdatesBar({ updates }: { updates: ContentUpdates }) {
  const count = updates.updates.length;
  const busy = updates.installing.length > 0;

  const text = busy
    ? (updates.progress ?? "Updating...")
    : updates.checking
      ? "Checking for updates..."
      : count
        ? `${count} update${count === 1 ? "" : "s"} available`
        : "Everything is up to date";

  return (
    <div data-testid="updates-bar" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: count && !busy ? "#86efac" : "#d4d4d8", fontSize: 14, marginRight: "auto" }}>
          {!updates.checking && !busy && !count && (
            <span style={{ color: GREEN, display: "inline-flex" }}>
              <CheckIcon size={16} />
            </span>
          )}
          <span data-testid="updates-status">{text}</span>
        </span>

        <button
          className="sidebar-button"
          title="Check for updates again"
          aria-label="Check for updates again"
          disabled={updates.checking || busy}
          onClick={updates.recheck}
          style={{ padding: "8px 10px", display: "inline-flex", alignItems: "center" }}
        >
          <RefreshIcon />
        </button>

        <button
          className="sidebar-button"
          data-testid="update-all"
          disabled={!count || updates.checking || busy}
          onClick={updates.updateAll}
          style={{
            padding: "8px 14px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: count ? GREEN : undefined,
            borderColor: count ? GREEN : undefined,
            opacity: count ? 1 : 0.5,
          }}
        >
          <DownloadIcon size={16} />
          Update All{count ? ` (${count})` : ""}
        </button>
      </div>

      {updates.result && <div style={{ color: "#86efac", fontSize: 13, marginTop: 8 }}>{updates.result}</div>}
      {updates.error && (
        <div role="alert" style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>
          {updates.error}
        </div>
      )}
    </div>
  );
}

/* On each item: an update button when there's a newer build, a tick when it's the newest. */
export function ItemUpdateStatus({ item, updates }: { item: InstanceMod; updates: ContentUpdates }) {
  if (item.kind !== "file") return null;
  const status = updates.statusOf(item);
  const key = updateKey(item);

  if (updates.installing.includes(key)) {
    return <span style={{ color: "#86efac", fontSize: 12, minWidth: 40, textAlign: "center" }}>Updating...</span>;
  }

  if (!status) {
    return updates.checking ? <span style={{ color: "#6b7280", width: 40, textAlign: "center" }}>…</span> : null;
  }

  if (status.state === "update") {
    return (
      <button
        data-testid="item-update"
        title={`Update${status.current ? ` from ${status.current}` : ""} to ${status.latest}`}
        aria-label={`Update ${status.name ?? item.name} to ${status.latest}`}
        disabled={updates.installing.length > 0}
        onClick={() => updates.install([key])}
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: GREEN,
          color: "white",
          border: "none",
          borderRadius: 10,
          cursor: "pointer",
        }}
      >
        <DownloadIcon />
      </button>
    );
  }

  if (status.state === "current") {
    return (
      <span
        data-testid="item-current"
        title={`Up to date${status.current ? ` (${status.current})` : ""}`}
        style={{ width: 40, height: 40, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: GREEN }}
      >
        <CheckIcon size={22} />
      </span>
    );
  }

  return (
    <span
      title="Not from Modrinth or CurseForge, so it can't be checked for updates"
      style={{ width: 40, flexShrink: 0, textAlign: "center", color: "#52525b" }}
    >
      –
    </span>
  );
}
