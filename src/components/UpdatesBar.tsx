import { Pin } from "lucide-react";
import type { ContentUpdates } from "./useContentUpdates";
import { updateKey } from "./useContentUpdates";
import { CheckIcon, DownloadIcon, RefreshIcon } from "./Icons";
import { Badge, Button, Modal } from "./ui";

const GREEN = "var(--color-success-solid)";
const GREEN_TEXT = "var(--color-success-text)";

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
        : updates.keptWaiting
          ? `${updates.keptWaiting} kept at ${updates.keptWaiting === 1 ? "its version" : "their versions"}`
          : "Up to date";

  return (
    <div data-testid="updates-bar" style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: count && !busy ? "var(--color-success-text)" : "var(--color-text-muted)", fontSize: 12 }}>
        {!updates.checking && !busy && !count && !updates.keptWaiting && (
          <span style={{ color: GREEN_TEXT, display: "inline-flex" }}>
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

      {/* Only there when there's something to update, rather than greyed out. */}
      {count > 0 && (
        <button
          className="sidebar-button"
          data-testid="update-all"
          disabled={updates.checking || busy}
          onClick={updates.updateAll}
          style={{
            padding: "6px 12px",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: GREEN,
            borderColor: GREEN,
            color: "var(--color-on-success)",
          }}
        >
          <DownloadIcon size={14} />
          Update All ({count})
        </button>
      )}

      <UnstableUpdates updates={updates} />
    </div>
  );
}

/* Before Update All installs a beta or alpha: back out, update anyway, or full releases only. */
function UnstableUpdates({ updates }: { updates: ContentUpdates }) {
  const list = updates.unstable ?? [];
  return (
    <Modal
      open={list.length > 0}
      onClose={() => updates.resolveUnstable("cancel")}
      title={list.length === 1 ? "One update is a beta or alpha" : `${list.length} updates are betas or alphas`}
      lead="They aren't finished releases, so they can have bugs or harm worlds."
      footer={
        <>
          <Button variant="ghost" onClick={() => updates.resolveUnstable("cancel")}>
            Back out
          </Button>
          <Button data-testid="update-anyway" onClick={() => updates.resolveUnstable("anyway")}>
            Update anyway
          </Button>
          <Button variant="primary" data-testid="update-releases" onClick={() => updates.resolveUnstable("releases")}>
            Latest full releases only
          </Button>
        </>
      }
    >
      <ul data-testid="unstable-updates" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map((update) => (
          <li key={update.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, minWidth: 0 }}>
            <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{update.name}</span>
            <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>to {update.latest}</span>
            <Badge tone={update.channel === "alpha" ? "danger" : "warning"}>{update.channel === "alpha" ? "Alpha" : "Beta"}</Badge>
          </li>
        ))}
      </ul>
      <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 12 }}>
        Latest full releases only still updates everything else, and moves each of these to its newest full release instead, when one is newer than the version you have.
      </p>
    </Modal>
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
      {updates.result && <div style={{ color: "var(--color-success-text)" }}>{updates.result}</div>}
      {updates.error && (
        <div role="alert" style={{ color: "var(--color-danger-text)" }}>
          {updates.error}
        </div>
      )}
      {batch && (
        <div data-testid="last-update" style={{ color: "var(--color-text-muted)", fontSize: 12, display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={batch.names.join("\n")}>
            Last change, {ago(batch.time)}: {batch.names.length === 1 ? batch.names[0] : `${batch.names.length} items`}
          </span>
          <button
            data-testid="undo-update"
            disabled={updates.installing.length > 0}
            onClick={updates.undo}
            style={{ background: "none", border: "none", color: "var(--color-accent-text)", cursor: "pointer", fontSize: 12, padding: 0, whiteSpace: "nowrap" }}
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
    return <span style={{ ...SLOT, width: "auto", color: "var(--color-success-text)", fontSize: 11 }}>Updating...</span>;
  }

  if (!status) {
    return updates.checking ? <span style={{ ...SLOT, color: "var(--color-text-muted)" }}>…</span> : null;
  }

  // Kept at its version: a pin, whether or not a newer build is out.
  if (status.kept && (status.state === "kept" || status.state === "current")) {
    return (
      <button
        data-testid="item-kept"
        title={`Kept at ${status.current ?? "its version"}: Update All leaves it alone.${status.state === "kept" ? ` ${status.latest} is out.` : ""} Click to choose a version or stop keeping it.`}
        aria-label={`Choose a version of ${status.name ?? item.name} (kept at its version)`}
        disabled={updates.installing.length > 0}
        onClick={() => onPick(item)}
        className="tick-button"
        style={{ ...SLOT, padding: 0, color: status.state === "kept" ? "var(--color-warning-text)" : "var(--color-text-secondary)" }}
      >
        <Pin size={16} />
      </button>
    );
  }

  if (status.state === "update") {
    return (
      <button
        data-testid="item-update"
        title={`Update${status.current ? ` from ${status.current}` : ""} to ${status.latest}, or choose another version`}
        aria-label={`Choose a version of ${status.name ?? item.name}`}
        disabled={updates.installing.length > 0}
        onClick={() => onPick(item)}
        style={{ ...SLOT, padding: 0, background: GREEN, color: "var(--color-on-success)", border: "none", borderRadius: 8, cursor: "pointer" }}
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
        style={{ ...SLOT, padding: 0, color: GREEN_TEXT }}
      >
        <CheckIcon size={18} />
      </button>
    );
  }

  return (
    <span title="Not from Modrinth or CurseForge, so it can't be checked for updates" style={{ ...SLOT, color: "var(--color-text-muted)" }}>
      –
    </span>
  );
}
