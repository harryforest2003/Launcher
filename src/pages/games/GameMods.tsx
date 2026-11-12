import { useEffect, useMemo, useState } from "react";
import { Folder, Play } from "lucide-react";
import IconButton from "../../components/IconButton";
import { BinIcon, DownloadIcon, PlusIcon, RefreshIcon } from "../../components/Icons";
import Toggle from "../../components/Toggle";
import { errorText, installSummary, note, panel, shortDate, sizeText, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  mods: GameMod[];
  reload: () => Promise<void>;
  onPlay: () => void;
  playing: string | null;
  goSettings: () => void;
};

type Filter = "all" | "on" | "off" | "update";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
  { id: "update", label: "May need updating" },
];

const PROVIDERS: Record<string, string> = { nexus: "Nexus Mods", curseforge: "CurseForge", file: "From a file", hand: "Added by hand" };

/*
 * A game's mods: each one on or off, what it is and where its files went, the ones that
 * may need updating after a game update, and adding more from Downloads.
 */
export default function GameMods({ detail, mods, reload, onPlay, playing, goSettings }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn"; text: string; notes?: string[] } | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [downloads, setDownloads] = useState<GameDownload[] | null>(null);
  // Ticked for installing together: to start with, the new ones that look like this game's mods.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadDownloads = () =>
    window.gamesAPI
      .downloads(detail.id)
      .then((found) => {
        setDownloads(found);
        setPicked(new Set(found.filter((file) => !file.installed && file.fits !== false).map((file) => file.path)));
      })
      .catch(() => setDownloads([]));

  useEffect(() => {
    if (showDownloads) loadDownloads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDownloads, detail.id]);

  // A second press of a bin is needed within a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return mods.filter((mod) => {
      if (words && !mod.name.toLowerCase().includes(words) && !(mod.where ?? "").toLowerCase().includes(words)) return false;
      if (filter === "on") return mod.enabled;
      if (filter === "off") return !mod.enabled;
      if (filter === "update") return mod.mayNeedUpdate;
      return true;
    });
  }, [mods, query, filter]);

  const mayNeedUpdate = mods.filter((mod) => mod.mayNeedUpdate && mod.enabled);
  const onCount = mods.filter((mod) => mod.enabled).length;

  async function act(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    try {
      await work();
      await reload();
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
  }

  async function install(filePath?: string) {
    setBusy(filePath ?? "file");
    setMessage(null);
    try {
      const result = await window.gamesAPI.install(detail.id, filePath);
      if (!result) {
        setBusy(null);
        return;
      }
      if (result.failed) setMessage({ tone: "bad", text: result.failed, notes: result.notes });
      else {
        const skipped = (result.skipped ?? []).map((s) => `Left out ${s.file} (${s.reason})`);
        setMessage({ tone: (result.notes?.length ?? 0) + skipped.length ? "warn" : "good", text: installSummary(result), notes: [...(result.notes ?? []), ...skipped.slice(0, 8)] });
      }
      await reload();
      if (showDownloads) await loadDownloads();
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setBusy(null);
  }

  /* The ticked downloads, one after another. */
  async function installPicked() {
    const fresh = (downloads ?? []).filter((file) => picked.has(file.path));
    if (!fresh.length) return;
    setMessage(null);
    const done: string[] = [];
    const problems: string[] = [];
    for (const [index, file] of fresh.entries()) {
      setBusy(`all:${index + 1}/${fresh.length}`);
      try {
        const result = await window.gamesAPI.install(detail.id, file.path);
        if (!result) continue;
        if (result.failed) problems.push(`${file.name}: ${result.failed}`);
        else {
          done.push(result.mod?.name ?? file.name);
          for (const line of result.notes ?? []) if (!/^Replaced the copy installed before/.test(line)) problems.push(`${result.mod?.name ?? file.name}: ${line}`);
        }
      } catch (err) {
        problems.push(`${file.name}: ${errorText(err)}`);
      }
    }
    setBusy(null);
    setMessage({
      tone: problems.length ? (done.length ? "warn" : "bad") : "good",
      text: `Installed ${done.length} of ${fresh.length} download${fresh.length === 1 ? "" : "s"}.`,
      notes: problems.slice(0, 12),
    });
    await reload();
    await loadDownloads();
  }

  // Mods The Sims 4 named in what went wrong, matched to the list.
  const namedMods = (names: string[]) =>
    mods.filter((mod) => mod.enabled && names.some((name) => name.length > 2 && (mod.name.toLowerCase().includes(name.toLowerCase()) || mod.key.toLowerCase().includes(name.toLowerCase()))));

  const sims = detail.id === "sims4" ? detail.simsOptions : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* HEADER */}
      <div style={{ ...panel, display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 8, alignSelf: "stretch", borderRadius: 4, background: detail.colour, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, color: "#c084fc", fontSize: 28 }}>{detail.name}</h1>
          <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 6 }}>
            {detail.found ? `Found via ${detail.source}` : "Not found on this computer"}
            {detail.version ? ` • ${/^\d/.test(detail.version) ? `Version ${detail.version}` : detail.version}` : ""}
            {detail.lastPlayed ? ` • Last played from here ${shortDate(detail.lastPlayed)}` : ""}
          </div>
          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
            {onCount} of {mods.length} mod{mods.length === 1 ? "" : "s"} on
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <IconButton
            tip={detail.found ? "Open the game's folder" : "The game's folder hasn't been found: choose it in Settings"}
            label="Open the game's folder"
            disabled={!detail.gameDir}
            onUnavailable={goSettings}
            onClick={() => window.gamesAPI.openFolder(detail.id, "game").catch((err) => setMessage({ tone: "bad", text: errorText(err) }))}
          >
            <Folder size={20} />
          </IconButton>
          {detail.id === "sims4" && (
            <IconButton
              tip="Open The Sims 4's folder in Documents (Mods, Tray, saves)"
              label="Open The Sims 4's Documents folder"
              disabled={!detail.docsDir}
              onUnavailable={goSettings}
              onClick={() => window.gamesAPI.openFolder(detail.id, "docs").catch((err) => setMessage({ tone: "bad", text: errorText(err) }))}
            >
              <Folder size={20} />
            </IconButton>
          )}
          <button
            className="sidebar-button"
            data-testid="game-play"
            onClick={onPlay}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", fontSize: 15, background: "#7c3aed", borderColor: "#a78bfa" }}
          >
            <Play size={18} fill="currentColor" />
            {playing ?? "Play"}
          </button>
        </div>
      </div>

      {/* WHAT NEEDS SAYING */}
      {!detail.found && (
        <div style={{ ...note("warn"), display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>
            {detail.name} wasn't found on this computer.
            {detail.windowsOnly && detail.platform === "darwin"
              ? " It only runs on Windows: on a Mac, install it in CrossOver or Whisky and the launcher finds it in their bottles."
              : " If it's somewhere unusual, choose its folder."}
          </span>
          <button className="sidebar-button" style={smallButton} onClick={goSettings}>
            Choose folder
          </button>
        </div>
      )}

      {detail.updated && (
        <div style={note("warn")} data-testid="game-updated">
          {detail.name} has updated since you last played it from here
          {detail.updated.from && detail.updated.to ? ` (${detail.updated.from} → ${detail.updated.to})` : ""}.{" "}
          {mayNeedUpdate.length
            ? mayNeedUpdate.length === 1
              ? "1 mod that changes the game's code may need updating before it works again. Play asks whether to start without it."
              : `${mayNeedUpdate.length} mods that change the game's code may need updating before they work again. Play asks whether to start without them.`
            : mods.some((mod) => mod.hooks && !mod.enabled)
              ? "The mods that change the game's code are turned off, so the rest should carry on working."
              : "None of your mods change the game's code, so they should carry on working."}
        </div>
      )}

      {sims && (!sims.scripts || !sims.mods) && (
        <div style={{ ...note("info"), display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>
            {!sims.mods
              ? "Custom content and mods are off in The Sims 4's own options, so none of these load."
              : "Script mods are off in The Sims 4's own options, so .ts4script mods don't load."}
          </span>
          <button
            className="sidebar-button"
            style={smallButton}
            onClick={() => act("options", () => window.gamesAPI.setSimsOptions({ mods: true, scripts: true }))}
          >
            Turn them on
          </button>
        </div>
      )}

      {detail.problems.length > 0 && (
        <div style={note("bad")} data-testid="sims-problems">
          <div style={{ marginBottom: 6 }}>
            The Sims 4 reported {detail.problems.length === 1 ? "an error" : `${detail.problems.length} errors`} since you last played from here.
            {" "}A mod {detail.problems.length === 1 ? "it names" : "they name"} is the likeliest cause.
          </div>
          {detail.problems.slice(0, 4).map((problem) => {
            const matches = namedMods(problem.mods);
            return (
              <div key={problem.file} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #4c1d1d" }}>
                <div style={{ fontSize: 12, color: "#fecaca" }}>
                  {problem.file} • {shortDate(problem.time)}
                  {problem.mods.length ? ` • names ${problem.mods.join(", ")}` : " • no mod named"}
                </div>
                {problem.line && <div style={{ fontSize: 12, color: "#f87171", marginTop: 2, fontFamily: "monospace", wordBreak: "break-word" }}>{problem.line}</div>}
                {matches.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {matches.slice(0, 4).map((mod) => (
                      <button key={mod.key} className="sidebar-button" style={{ ...smallButton, padding: "6px 10px", fontSize: 12 }} onClick={() => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, false))}>
                        Turn off {mod.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {message && (
        <div style={note(message.tone)} data-testid="mods-message">
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ flex: 1 }}>{message.text}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>
              ×
            </button>
          </div>
          {message.notes?.map((line) => (
            <div key={line} style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
              • {line}
            </div>
          ))}
        </div>
      )}

      {/* TOOLBAR */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your mods..."
          style={{ flex: "1 1 220px", padding: 12, borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9" }}
        />
        {FILTERS.map((option) => (
          <button
            key={option.id}
            className="sidebar-button"
            onClick={() => setFilter(option.id)}
            style={{ fontSize: 12, padding: "8px 12px", opacity: filter === option.id ? 1 : 0.6, ...(filter === option.id ? { background: "#6d28d9" } : {}) }}
          >
            {option.label}
            {option.id === "update" && mods.some((mod) => mod.mayNeedUpdate) ? ` (${mods.filter((mod) => mod.mayNeedUpdate).length})` : ""}
          </button>
        ))}
        <IconButton tip="Look again for mods in the game's folders" label="Refresh" onClick={() => act("refresh", reload)}>
          <RefreshIcon size={18} />
        </IconButton>
        <IconButton tip="Install a mod from a file you choose" label="Install from a file" onClick={() => install()}>
          <PlusIcon size={18} />
        </IconButton>
        <button
          className="sidebar-button"
          data-testid="add-from-downloads"
          onClick={() => setShowDownloads((open) => !open)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", ...(showDownloads ? { background: "#6d28d9" } : {}) }}
        >
          <DownloadIcon size={16} />
          Add from Downloads
        </button>
      </div>

      {/* DOWNLOADS */}
      {showDownloads && (
        <div style={panel} data-testid="downloads-panel">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <div style={{ color: "#c084fc", fontWeight: 600, flex: 1 }}>From your Downloads folder</div>
            {picked.size > 0 && (
              <button
                className="sidebar-button"
                data-testid="install-picked"
                style={{ ...smallButton, background: "#7c3aed", borderColor: "#a78bfa" }}
                onClick={() => {
                  if (!busy) installPicked();
                }}
              >
                {busy?.startsWith("all:") ? `Installing ${busy.slice(4)}...` : `Install ticked (${picked.size})`}
              </button>
            )}
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 10 }}>
            Zips, 7z and RAR archives are unpacked and each file goes where {detail.name} needs it. Newest first, from the last 90 days; new ones that
            look like {detail.name} mods are ticked.
          </div>
          {downloads === null ? (
            <div style={{ color: "#9ca3af" }}>Looking...</div>
          ) : downloads.length === 0 ? (
            <div style={{ color: "#9ca3af" }}>Nothing in Downloads looks like a mod for {detail.name}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
              {downloads.map((file) => (
                <div key={file.path} data-testid="download-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "#1b1b1b", borderRadius: 8, opacity: file.fits === false ? 0.6 : 1 }}>
                  <input
                    type="checkbox"
                    aria-label={`Tick ${file.name} to install`}
                    checked={picked.has(file.path)}
                    onChange={(event) =>
                      setPicked((now) => {
                        const next = new Set(now);
                        if (event.target.checked) next.add(file.path);
                        else next.delete(file.path);
                        return next;
                      })
                    }
                    style={{ width: 16, height: 16, accentColor: "#7c3aed", flexShrink: 0, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                    <div style={{ color: "#6b7280", fontSize: 11 }}>
                      {sizeText(file.size)} • {shortDate(file.modified)}
                      {file.installed ? " • installed" : ""}
                      {file.fits === false ? ` • doesn't look like a ${detail.name} mod` : ""}
                    </div>
                  </div>
                  <button className="sidebar-button" style={{ ...smallButton, ...(file.installed ? {} : { background: "#7c3aed", borderColor: "#a78bfa" }) }} onClick={() => install(file.path)}>
                    {busy === file.path ? "Installing..." : file.installed ? "Reinstall" : "Install"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="mod-list">
        {shown.length === 0 ? (
          <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>
            {mods.length === 0
              ? detail.found
                ? "No mods yet. Add one from Downloads, or find some in Discover Mods."
                : "Once the game's found, its mods show here."
              : "No mods match."}
          </div>
        ) : (
          shown.map((mod) => (
            <div
              key={mod.key}
              data-testid="game-mod"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 14px",
                background: "rgba(27, 27, 27, 0.9)",
                border: `1px solid ${mod.mayNeedUpdate && mod.enabled ? "#b45309" : "#2e2e2e"}`,
                borderRadius: 10,
                opacity: mod.enabled ? 1 : 0.65,
              }}
            >
              <Toggle
                on={mod.enabled}
                label={mod.enabled ? `Turn off ${mod.name}` : `Turn on ${mod.name}`}
                disabled={busy === mod.key}
                onChange={(on) => act(mod.key, () => window.gamesAPI.setEnabled(detail.id, mod.key, on))}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: mod.enabled ? "#e9d5ff" : "#a1a1aa" }}>{mod.name}</span>
                  {mod.mayNeedUpdate && (
                    <span data-tip="It changes the game's code and is older than the game's latest update" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#78350f", color: "#fde68a" }}>
                      May need updating
                    </span>
                  )}
                  {mod.hooks && !mod.mayNeedUpdate && (
                    <span data-tip="It changes the game's code, so game updates can break it" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#2e1065", color: "#d8b4fe" }}>
                      Script mod
                    </span>
                  )}
                  {mod.kind === "plugin" && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#1e293b", color: "#93c5fd" }}>Plugin</span>}
                </div>
                <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3 }}>
                  {mod.managed
                    ? [
                        PROVIDERS[mod.source?.provider ?? "file"] ?? mod.source?.provider,
                        mod.areas.map((a) => `${a.count} in ${a.area}`).join(", "),
                        mod.plugins.length ? `plugins: ${mod.plugins.join(", ")}` : "",
                        mod.installedAt ? `installed ${shortDate(mod.installedAt)}` : "",
                      ]
                        .filter(Boolean)
                        .join(" • ")
                    : [`In ${mod.where}`, PROVIDERS.hand, mod.since ? `changed ${shortDate(mod.since)}` : ""].filter(Boolean).join(" • ")}
                </div>
                {mod.notes.slice(0, 2).map((line) => (
                  <div key={line} style={{ color: "#fcd34d", fontSize: 11, marginTop: 2 }}>
                    {line}
                  </div>
                ))}
              </div>
              <IconButton
                tip={confirming === mod.key ? "Click again to delete it" : mod.managed ? "Delete this mod (what it replaced comes back)" : "Delete this from the game's folders"}
                label={`Delete ${mod.name}`}
                variant={confirming === mod.key ? "confirming" : ""}
                onClick={() => {
                  if (confirming !== mod.key) {
                    setConfirming(mod.key);
                    return;
                  }
                  setConfirming(null);
                  act(mod.key, () => window.gamesAPI.remove(detail.id, mod.key));
                }}
              >
                <BinIcon size={18} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
