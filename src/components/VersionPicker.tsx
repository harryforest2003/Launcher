import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge, Button, type Tone } from "./ui";
import { color, font, radius, shadow, space, z } from "../theme/tokens";
import { countChannels, useChannelFilter } from "./versionChannels";
import ChannelFilterBar from "./ChannelFilterBar";

type Props = {
  instanceName: string;
  /** The item's key for the update check: "mod/sodium.jar". */
  itemKey: string;
  name: string;
  icon: string | null;
  /** The version to start on (the update found), if any. */
  suggested?: string;
  onDone: (result: UpdateResult & DependencyCheck) => void;
  onClose: () => void;
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

// How finished each version is, as a word with a status colour behind it.
const CHANNEL: Record<ContentVersion["channel"], { label: string; tone: Tone }> = {
  release: { label: "Release", tone: "success" },
  beta: { label: "Beta", tone: "warning" },
  alpha: { label: "Alpha", tone: "danger" },
};

function formatBytes(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/*
 * Every version of one mod (or pack) that works on this instance, like the Modrinth app's
 * version list: pick any, newer or older, and see each one's changelog when you open it.
 */
export default function VersionPicker({ instanceName, itemKey, name, icon, suggested, onDone, onClose }: Props) {
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .versions(instanceName, itemKey)
      .then((found) => {
        if (!current) return;
        setVersions(found.versions);
      })
      .catch((err) => current && setLoadError(message(err)));
    return () => {
      current = false;
    };
  }, [instanceName, itemKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Changelogs load one at a time, when opened.
  const toggleChangelog = (id: string) => {
    if (id in open) {
      setOpen((current) => {
        const rest = { ...current };
        delete rest[id];
        return rest;
      });
      return;
    }
    setOpen((current) => ({ ...current, [id]: null }));
    window.instanceAPI
      .versionChangelog(instanceName, itemKey, id)
      .then((text) => setOpen((current) => (id in current ? { ...current, [id]: text || "No changelog for this version." } : current)))
      .catch((err) => setOpen((current) => (id in current ? { ...current, [id]: `Couldn't load the changelog: ${message(err)}` } : current)));
  };

  const choose = (id: string) => {
    setChosen(id);
    setProblems(null);
    setError(null);
  };

  const counts = useMemo(() => countChannels((versions ?? []).map((v) => v.channel)), [versions]);
  const { filter, wanted, setFilter } = useChannelFilter(counts);
  const shown = !versions ? null : filter === "all" ? versions : versions.filter((v) => v.channel === filter);
  // Until one is clicked: the update that was found, or else the newest shown if it isn't the one installed.
  const start = shown && (shown.find((v) => v.number === suggested) ?? (shown[0] && !shown[0].installed ? shown[0] : null));
  const chosenId = chosen ?? start?.id ?? null;

  const installed = versions?.find((v) => v.installed) ?? null;
  const picked = versions?.find((v) => v.id === chosenId) ?? null;
  const goingBack = Boolean(picked && installed && Date.parse(picked.published) < Date.parse(installed.published));

  async function install(force: boolean) {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const done = await window.instanceAPI.installVersion(instanceName, itemKey, picked.id, force);
      if (done.needsConfirm) {
        setProblems(done.problems);
      } else {
        onDone(done);
        onClose();
      }
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  return (
    <div
      data-testid="version-picker"
      onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: z.modal, background: color.scrim, display: "flex", alignItems: "center", justifyContent: "center", padding: space[6] }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose a version of ${name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(760px, 90vh)",
          display: "flex",
          flexDirection: "column",
          background: color.surfaceRaised,
          borderRadius: radius.lg,
          boxShadow: `${shadow.lg}, ${shadow.edge}`,
          textAlign: "start",
          color: color.text,
          fontFamily: font.ui,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: space[3], padding: `${space[4]} ${space[5]}`, borderBottom: `1px solid ${color.border}` }}>
          {icon ? (
            <img src={icon} alt="" width={36} height={36} style={{ borderRadius: radius.md, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: radius.md, background: color.accentSubtle }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.text }}>{name}</div>
            <div style={{ fontSize: font.size.xs, color: color.textMuted }}>
              {installed ? `You have ${installed.number}. ` : ""}Choose any version that works on this instance.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            style={{ marginLeft: "auto", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: radius.sm, color: color.textSecondary, cursor: "pointer" }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {versions && versions.length > 0 && (
          <ChannelFilterBar counts={counts} value={filter} wanted={wanted} onChange={setFilter} style={{ padding: `${space[3]} ${space[4]} 0` }} />
        )}

        <div role="radiogroup" aria-label="Versions" style={{ overflowY: "auto", padding: `${space[3]} ${space[4]}`, flex: 1 }}>
          {loadError ? (
            <div style={{ color: color.dangerText, fontSize: font.size.sm, padding: space[2] }}>{loadError}</div>
          ) : !versions || !shown ? (
            <div style={{ color: color.textMuted, fontSize: font.size.sm, padding: space[2] }}>Finding versions...</div>
          ) : !versions.length ? (
            <div style={{ color: color.textMuted, fontSize: font.size.sm, padding: space[2] }}>No versions of this work on this instance.</div>
          ) : (
            shown.map((version) => {
              const selected = version.id === chosenId;
              const channel = CHANNEL[version.channel] ?? CHANNEL.release;
              return (
                <div key={version.id} data-testid="version-row" style={{ marginBottom: space[1.5] }}>
                  <div
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => !busy && choose(version.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      choose(version.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: space[3],
                      padding: `${space[2]} ${space[3]}`,
                      borderRadius: radius.sm,
                      cursor: "pointer",
                      background: selected ? color.accentSubtle : color.surface,
                      boxShadow: selected ? `inset var(--rail-width) 0 0 ${color.accentLine}` : shadow.edge,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: radius.full,
                        flexShrink: 0,
                        boxSizing: "border-box",
                        border: `2px solid ${selected ? color.accentLine : color.borderStrong}`,
                        background: selected ? color.accentLine : "transparent",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                        <span style={{ fontWeight: font.weight.semibold, fontSize: font.size.sm, fontFamily: font.mono }}>{version.number}</span>
                        <Badge tone={channel.tone}>{channel.label}</Badge>
                        {version.installed && <Badge tone="accent">Installed</Badge>}
                        {version === versions[0] && !version.installed && <span style={{ fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.successText }}>Newest</span>}
                      </div>
                      <div style={{ fontSize: font.size.xs, color: color.textMuted }}>
                        {new Date(version.published).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        {version.size ? `, ${formatBytes(version.size)}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="changelog-toggle"
                      aria-expanded={version.id in open}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleChangelog(version.id);
                      }}
                      style={{ background: "none", border: "none", color: color.accentText, cursor: "pointer", fontFamily: font.ui, fontSize: font.size.xs, fontWeight: font.weight.semibold, whiteSpace: "nowrap", padding: space[1] }}
                    >
                      Changelog {version.id in open ? "▾" : "▸"}
                    </button>
                  </div>
                  {version.id in open && (
                    <div
                      data-testid="changelog"
                      style={{
                        margin: `${space[1]} 0 ${space[0.5]} 36px`,
                        padding: `${space[2]} ${space[3]}`,
                        maxHeight: 220,
                        overflowY: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily: font.body,
                        fontSize: font.size.xs,
                        lineHeight: font.leading.relaxed,
                        color: color.textSecondary,
                        background: color.surfaceSunken,
                        borderRadius: radius.sm,
                      }}
                    >
                      {open[version.id] ?? "Loading..."}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {problems && (
          <div
            role="alert"
            style={{
              margin: `0 ${space[5]}`,
              padding: `${space[3]} ${space[3]} ${space[3]} ${space[4]}`,
              borderRadius: radius.sm,
              background: color.warningBg,
              boxShadow: `inset var(--rail-width) 0 0 ${color.warningBorder}`,
              color: color.text,
              fontSize: font.size.sm,
            }}
          >
            <div style={{ fontWeight: font.weight.semibold, marginBottom: space[1], color: color.warningText }}>This version probably won't work with the rest of the instance:</div>
            <ul style={{ margin: `0 0 0 ${space[4]}`, padding: 0 }}>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div role="alert" style={{ margin: `${space[2]} ${space[5]} 0`, color: color.dangerText, fontSize: font.size.sm }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: space[2], padding: `${space[3]} ${space[5]}`, borderTop: `1px solid ${color.border}` }}>
          <span style={{ fontSize: font.size.xs, color: color.textMuted, marginRight: "auto" }}>
            {picked && !picked.installed ? `${goingBack ? "Going back to" : "Updating to"} ${picked.number}` : "Pick a version"}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {problems ? (
            <Button
              size="sm"
              data-testid="install-anyway"
              disabled={busy}
              onClick={() => install(true)}
              style={{ background: color.warningSolid, color: color.onWarning }}
            >
              {busy ? "Installing..." : "Install anyway"}
            </Button>
          ) : (
            <Button size="sm" variant="primary" data-testid="install-version" disabled={busy || !picked || picked.installed} onClick={() => install(false)}>
              {busy ? "Checking..." : picked && !picked.installed ? `${goingBack ? "Go back to" : "Install"} ${picked.number}` : "Install"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
