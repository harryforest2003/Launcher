import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import { countText, errorText, installSummary, note, shortDate, sizeText } from "./shared";

type Props = {
  detail: GameDetail;
  provider: GameModProvider;
  modId: string;
  afterInstall: (result: GameInstallResult) => void;
  /* A free Nexus account installs through the website; what the mod needs follows it. */
  openOnNexus: (item: { modId: string; name: string; page: string }) => Promise<void>;
  goLauncherSettings: () => void;
};

const SITES: Record<GameModProvider, { name: string; url: string }> = {
  nexus: { name: "Nexus Mods", url: "https://www.nexusmods.com/" },
  curseforge: { name: "CurseForge", url: "https://www.curseforge.com/" },
  thunderstore: { name: "Thunderstore", url: "https://thunderstore.io/" },
  modio: { name: "mod.io", url: "https://mod.io/" },
  workshop: { name: "Steam Workshop", url: "https://steamcommunity.com/" },
  gamebanana: { name: "GameBanana", url: "https://gamebanana.com/" },
  factorio: { name: "Factorio Mod Portal", url: "https://mods.factorio.com/" },
  spacedock: { name: "SpaceDock", url: "https://spacedock.info/" },
  beatmods: { name: "BeatMods", url: "https://beatmods.com/" },
  modworkshop: { name: "ModWorkshop", url: "https://modworkshop.net/" },
  ficsit: { name: "ficsit.app", url: "https://ficsit.app/" },
  vintagestory: { name: "Vintage Story Mod DB", url: "https://mods.vintagestory.at/" },
  contentdb: { name: "ContentDB", url: "https://content.luanti.org/" },
  idgames: { name: "idgames archive", url: "https://www.doomworld.com/idgames/" },
};

/* A mod's page, laid out as Minecraft's: what it is, its files, its pictures, and installing it. */
export default function GameModPage({ detail, provider, modId, afterInstall, openOnNexus, goLauncherSettings }: Props) {
  const [mod, setMod] = useState<GameModDetails | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<"desc" | "files" | "gallery">("desc");
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string; notes?: string[] } | null>(null);
  // A gallery picture shown large.
  const [viewing, setViewing] = useState<string | null>(null);

  // Each mod gets its own copy of this page (keyed by it), so it starts afresh.
  useEffect(() => {
    let active = true;
    window.gamesAPI
      .details(detail.id, provider, modId)
      .then((found) => active && setMod(found))
      .catch((err) => active && setFailed(errorText(err)));
    return () => {
      active = false;
    };
  }, [detail.id, provider, modId]);

  const site = SITES[provider] ?? { name: provider, url: "" };
  // Thunderstore, SpaceDock and the like write descriptions in Markdown.
  const body = useMemo(
    () => sanitizeHtml(mod?.html || (mod?.markdown ? marked.parse(mod.markdown, { async: false }) : "") || mod?.summary || "No description", { baseUrl: site.url || undefined }),
    [mod, site.url],
  );

  const mainFile = mod?.files.find((file) => file.category === "Main" || file.category === "File") ?? mod?.files[0] ?? null;
  // A free Nexus account downloads through the website's Mod Manager Download button.
  const viaWebsite = provider === "nexus" && !mod?.premium;

  async function install(file: GameModFile | null) {
    if (!mod) return;
    setMessage(null);
    if (viaWebsite) {
      const page = file ? `${mod.url}?tab=files&file_id=${file.id}&nmm=1` : `${mod.url}?tab=files`;
      if (mod.hasKey) {
        await openOnNexus({ modId: mod.id, name: mod.name, page });
        setMessage({ tone: "info", text: `Opened ${file ? file.name : "its files"} on Nexus Mods: press the download button there and the launcher installs it, then whatever it needs.` });
        return;
      }
      await window.gamesAPI.openUrl(page).catch(() => {});
      setMessage({
        tone: "info",
        text: mod.hasKey
          ? `Opened ${file ? file.name : "its files"} on Nexus Mods: press the download button there and the launcher installs it by itself.`
          : `Opened on Nexus Mods. To install with the launcher, add your Nexus Mods API key in Settings → Mod sites, then press "Mod Manager Download" there.`,
      });
      return;
    }
    setInstalling(file?.id ?? "main");
    try {
      const result = await window.gamesAPI.installRemote(detail.id, provider, mod.id, file?.id ?? null, mod.name);
      if (result.viaSteam) {
        setMessage({ tone: "info", text: result.reason ?? "Opened in Steam: press Subscribe there and Steam installs it." });
      } else if (result.needsWebsite && provider === "nexus") {
        await openOnNexus({ modId: mod.id, name: mod.name, page: result.needsWebsite });
      } else if (result.needsWebsite !== undefined) {
        const page = result.needsWebsite ?? mod.url;
        if (page) await window.gamesAPI.openUrl(page).catch(() => {});
        setMessage({ tone: "info", text: `${result.reason ?? "This one has to be downloaded from its website."} It's open in your browser; once it's downloaded, add it from Downloads on the Mods page.` });
      } else if (result.failed) {
        setMessage({ tone: "bad", text: result.failed, notes: result.notes });
      } else {
        const skipped = (result.skipped ?? []).map((s) => `Left out ${s.file} (${s.reason})`);
        setMessage({ tone: (result.notes?.length ?? 0) + skipped.length ? "warn" : "good", text: installSummary(result), notes: [...(result.notes ?? []), ...skipped.slice(0, 8)] });
        afterInstall(result);
      }
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setInstalling(null);
  }

  if (failed) return <div style={note("bad")}>{failed}</div>;
  if (!mod) return <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>;

  const tabButton = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className="sidebar-button" style={tab === id ? { background: "var(--color-accent-subtle)" } : undefined}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {viewing && (
        <div
          onClick={() => setViewing(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9000, background: "var(--color-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 30, cursor: "zoom-out" }}
        >
          <img src={viewing} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
        </div>
      )}
      {/* LEFT */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 20, background: "var(--color-surface)", padding: 20, borderRadius: 12, border: "1px solid var(--color-border)", alignItems: "center" }}>
          {mod.picture ? <img src={mod.picture} alt="" style={{ width: provider === "nexus" ? 190 : 110, height: 110, objectFit: "cover", borderRadius: 16, flexShrink: 0 }} /> : null}
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{mod.name}</h1>
            <p style={{ color: "var(--color-text-muted)", marginTop: 6 }}>{mod.author}</p>
            <span style={{ display: "inline-block", marginTop: 10, padding: "4px 10px", borderRadius: 8, background: "var(--color-warning-solid)", fontSize: 12, fontWeight: 700 }}>{site.name.toUpperCase()}</span>
            <p style={{ marginTop: 14, color: "var(--color-text-secondary)" }}>{mod.summary}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          {tabButton("desc", "Description")}
          {tabButton("files", "Files")}
          {tabButton("gallery", "Gallery")}
        </div>

        <div style={{ marginTop: 20 }}>
          {tab === "desc" && (
            <div style={{ color: "var(--color-text-secondary)", lineHeight: 1.7, overflowX: "hidden", wordBreak: "break-word" }}>
              <div
                className="mod-description"
                onClick={(event) => {
                  // Links go to the system browser, as on Minecraft's pages.
                  const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
                  if (!anchor) return;
                  event.preventDefault();
                  window.open(anchor.href, "_blank", "noopener");
                }}
                dangerouslySetInnerHTML={{ __html: body }}
              />
            </div>
          )}

          {tab === "files" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="mod-files">
              {mod.files.length === 0 ? (
                <div style={note(provider === "nexus" && !mod.hasKey ? "warn" : "info")}>
                  {provider === "nexus" && !mod.hasKey ? (
                    <>
                      Nexus Mods only lists a mod's files for apps with your personal API key.{" "}
                      <button className="sidebar-button" style={{ padding: "4px 10px", fontSize: 12, marginLeft: 6 }} onClick={goLauncherSettings}>
                        Open Settings
                      </button>
                    </>
                  ) : (
                    "No files to download."
                  )}
                </div>
              ) : (
                mod.files.map((file) => (
                  <div key={file.id} style={{ background: "var(--color-surface-sunken)", padding: 12, borderRadius: 10, border: "1px solid var(--color-border)", display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ color: "var(--color-accent-text)", margin: 0 }}>{file.name}</h4>
                      <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 4 }}>
                        {[file.category, file.version && `version ${file.version}`, sizeText(file.size), shortDate(file.date)].filter(Boolean).join(" • ")}
                      </div>
                      {file.description && <div style={{ color: "var(--color-text-secondary)", fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{file.description}</div>}
                    </div>
                    <button
                      className="sidebar-button"
                      style={{ padding: "8px 14px", flexShrink: 0, ...(file.category === "Main" || file.category === "File" ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-line)" } : {}) }}
                      onClick={() => install(file)}
                    >
                      {installing === file.id ? "Installing..." : viaWebsite ? "Get" : "Install"}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "gallery" && (
            <div data-testid="mod-gallery">
              {provider === "nexus" && mod.url && (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 12 }}>
                  Nexus Mods only shares a mod's main picture and the ones in its description with apps.{" "}
                  <a
                    href={`${mod.url}?tab=images`}
                    onClick={(event) => {
                      event.preventDefault();
                      window.gamesAPI.openUrl(`${mod.url}?tab=images`).catch(() => {});
                    }}
                    style={{ color: "var(--color-info-text)" }}
                  >
                    See its whole gallery on Nexus Mods
                  </a>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {mod.images.length === 0 ? (
                  <div style={{ color: "var(--color-text-muted)" }}>No pictures.</div>
                ) : (
                  mod.images.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt=""
                      loading="lazy"
                      onClick={() => setViewing(src)}
                      style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 10, border: "1px solid var(--color-border)", cursor: "zoom-in" }}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ position: "relative", width: 320, flexShrink: 0, background: "var(--color-surface)", borderRadius: 12, padding: 20, border: "1px solid var(--color-border)", boxSizing: "border-box" }}>
        <button
          className="sidebar-button"
          data-testid="mod-install"
          onClick={() => install(mainFile)}
          style={{ width: "100%", padding: 14, fontSize: 15, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }}
        >
          {installing ? "Installing..." : viaWebsite ? "Install from Nexus Mods" : provider === "workshop" ? "Subscribe in Steam" : `Install into ${detail.name}`}
        </button>
        <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          {viaWebsite
            ? mod.hasKey
              ? `Opens ${mainFile ? "its main file's download" : "its files"} on Nexus Mods: one click on the download button there and the launcher puts it in the right folders.`
              : `Opens it on Nexus Mods. Add your Nexus Mods key in Settings → Mod sites and its download there installs it here.`
            : provider === "workshop"
              ? "Opens its page in Steam. Press Subscribe there and Steam downloads it and keeps it up to date."
              : mainFile
              ? `${mainFile.name}${mainFile.version ? ` ${mainFile.version}` : ""}. Unpacked and put in the right folders.`
              : "Unpacked and put in the right folders."}
        </div>

        {message && (
          <div style={{ ...note(message.tone), marginTop: 14 }} data-testid="mod-message">
            {message.text}
            {message.notes?.map((line) => (
              <div key={line} style={{ fontSize: 12, marginTop: 4 }}>
                • {line}
              </div>
            ))}
          </div>
        )}

        <hr style={{ margin: "20px 0", borderColor: "var(--color-border)" }} />

        <p><b>Downloads</b></p>
        <p>{mod.downloads?.toLocaleString() ?? "Unknown"}</p>
        {mod.endorsements != null && (
          <>
            <p><b>Endorsements</b></p>
            <p>{countText(mod.endorsements)}</p>
          </>
        )}
        {mod.version && (
          <>
            <p><b>Version</b></p>
            <p>{mod.version}</p>
          </>
        )}
        <p><b>Updated</b></p>
        <p>{shortDate(mod.updated) || "Unknown"}</p>
        <p><b>Author</b></p>
        <p>{mod.author || "Unknown"}</p>
        <p><b>Source</b></p>
        <p>{site.name}</p>
        {mod.url && (
          <>
            <p><b>Website</b></p>
            <a href={mod.url} onClick={(event) => { event.preventDefault(); window.gamesAPI.openUrl(mod.url!).catch(() => {}); }} style={{ color: "var(--color-info-text)" }}>
              Open on {site.name}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
