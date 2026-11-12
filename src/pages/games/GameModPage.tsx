import { useEffect, useMemo, useState } from "react";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import { countText, errorText, installSummary, note, shortDate, sizeText } from "./shared";

type Props = {
  detail: GameDetail;
  provider: "nexus" | "curseforge";
  modId: string;
  afterInstall: (result: GameInstallResult) => void;
  /* A free Nexus account installs through the website; what the mod needs follows it. */
  openOnNexus: (item: { modId: string; name: string; page: string }) => Promise<void>;
  goLauncherSettings: () => void;
};

const SITE = { nexus: "https://www.nexusmods.com/", curseforge: "https://www.curseforge.com/" };
const BADGE = { nexus: { label: "NEXUS MODS", colour: "#d97706" }, curseforge: { label: "CURSEFORGE", colour: "#f97316" } };

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

  const body = useMemo(() => sanitizeHtml(mod?.html || mod?.summary || "No description", { baseUrl: SITE[provider] }), [mod, provider]);

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
          : `Opened on Nexus Mods. To install with the launcher, add your Nexus Mods API key in Settings → API keys, then press "Mod Manager Download" there.`,
      });
      return;
    }
    setInstalling(file?.id ?? "main");
    try {
      const result = await window.gamesAPI.installRemote(detail.id, provider, mod.id, file?.id ?? null, mod.name);
      if (result.needsWebsite && provider === "nexus") {
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
  if (!mod) return <div style={{ color: "#9ca3af" }}>Loading...</div>;

  const tabButton = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className="sidebar-button" style={tab === id ? { background: "#6d28d9" } : undefined}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {viewing && (
        <div
          onClick={() => setViewing(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0, 0, 0, 0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 30, cursor: "zoom-out" }}
        >
          <img src={viewing} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
        </div>
      )}
      {/* LEFT */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 20, background: "#151515", padding: 20, borderRadius: 12, border: "1px solid #6d28d9", alignItems: "center" }}>
          {mod.picture ? <img src={mod.picture} alt="" style={{ width: provider === "nexus" ? 190 : 110, height: 110, objectFit: "cover", borderRadius: 16, flexShrink: 0 }} /> : null}
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, color: "#c084fc", fontSize: 30 }}>{mod.name}</h1>
            <p style={{ color: "#888", marginTop: 6 }}>{mod.author}</p>
            <span style={{ display: "inline-block", marginTop: 10, padding: "4px 10px", borderRadius: 8, background: BADGE[provider].colour, fontSize: 12, fontWeight: 700 }}>{BADGE[provider].label}</span>
            <p style={{ marginTop: 14, color: "#bbb" }}>{mod.summary}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          {tabButton("desc", "Description")}
          {tabButton("files", "Files")}
          {tabButton("gallery", "Gallery")}
        </div>

        <div style={{ marginTop: 20 }}>
          {tab === "desc" && (
            <div style={{ color: "#ddd", lineHeight: 1.7, overflowX: "hidden", wordBreak: "break-word" }}>
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
                  <div key={file.id} style={{ background: "#1b1b1b", padding: 12, borderRadius: 10, border: "1px solid #333", display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ color: "#c084fc", margin: 0 }}>{file.name}</h4>
                      <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
                        {[file.category, file.version && `version ${file.version}`, sizeText(file.size), shortDate(file.date)].filter(Boolean).join(" • ")}
                      </div>
                      {file.description && <div style={{ color: "#aaa", fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{file.description}</div>}
                    </div>
                    <button
                      className="sidebar-button"
                      style={{ padding: "8px 14px", flexShrink: 0, ...(file.category === "Main" || file.category === "File" ? { background: "#7c3aed", borderColor: "#a78bfa" } : {}) }}
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
                <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12 }}>
                  Nexus Mods only shares a mod's main picture and the ones in its description with apps.{" "}
                  <a
                    href={`${mod.url}?tab=images`}
                    onClick={(event) => {
                      event.preventDefault();
                      window.gamesAPI.openUrl(`${mod.url}?tab=images`).catch(() => {});
                    }}
                    style={{ color: "#8ab4ff" }}
                  >
                    See its whole gallery on Nexus Mods
                  </a>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {mod.images.length === 0 ? (
                  <div style={{ color: "#9ca3af" }}>No pictures.</div>
                ) : (
                  mod.images.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt=""
                      loading="lazy"
                      onClick={() => setViewing(src)}
                      style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 10, border: "1px solid #333", cursor: "zoom-in" }}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ position: "relative", width: 320, flexShrink: 0, background: "rgba(21, 21, 21, 0.85)", borderRadius: 12, padding: 20, border: "1px solid #333", boxSizing: "border-box" }}>
        <button
          className="sidebar-button"
          data-testid="mod-install"
          onClick={() => install(mainFile)}
          style={{ width: "100%", padding: 14, fontSize: 15, background: "#7c3aed", borderColor: "#a78bfa" }}
        >
          {installing ? "Installing..." : viaWebsite ? "Install from Nexus Mods" : `Install into ${detail.name}`}
        </button>
        <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          {viaWebsite
            ? mod.hasKey
              ? `Opens ${mainFile ? "its main file's download" : "its files"} on Nexus Mods: one click on the download button there and the launcher puts it in the right folders.`
              : `Opens it on Nexus Mods. Add your Nexus Mods key in Settings → API keys and its download there installs it here.`
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

        <hr style={{ margin: "20px 0", borderColor: "#333" }} />

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
        <p>{provider === "nexus" ? "Nexus Mods" : "CurseForge"}</p>
        {mod.url && (
          <>
            <p><b>Website</b></p>
            <a href={mod.url} onClick={(event) => { event.preventDefault(); window.gamesAPI.openUrl(mod.url!).catch(() => {}); }} style={{ color: "#8ab4ff" }}>
              Open on {provider === "nexus" ? "Nexus Mods" : "CurseForge"}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
