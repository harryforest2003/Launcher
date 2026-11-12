import { useEffect, useRef, useState } from "react";
import IconButton from "../../components/IconButton";
import { DownloadIcon } from "../../components/Icons";
import Pagination from "../../components/Pagination";
import { countText, errorText, installSummary, MORE_SITES, note, panel, shortDate } from "./shared";

type Props = {
  detail: GameDetail;
  openMod: (provider: "nexus" | "curseforge", id: string) => void;
  afterInstall: () => void;
  goLauncherSettings: () => void;
  goMods: () => void;
};

const PAGE_SIZE = 24;

const SORTS = [
  { id: "popular", label: "Most popular" },
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recently updated" },
  { id: "new", label: "Newest" },
];

const BADGE: Record<string, { label: string; colour: string }> = {
  nexus: { label: "NEXUS MODS", colour: "#d97706" },
  curseforge: { label: "CURSEFORGE", colour: "#f97316" },
};

/*
 * Finding mods for a game, laid out as Minecraft's Discover page: Nexus Mods for every
 * game, and CurseForge too for the games it carries (The Sims 4, Stardew Valley).
 * Clicking a card opens the mod's page; the download button installs its main file.
 */
export default function GameDiscover({ detail, openMod, afterInstall, goLauncherSettings, goMods }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [provider, setProvider] = useState<"nexus" | "curseforge">("nexus");
  const [sort, setSort] = useState("popular");
  // The last search's answer, and which search it answered: another one is loading until it's in.
  const [loaded, setLoaded] = useState<{ key: string; result: { total: number; mods: GameRemoteMod[] } | null; error: string | null } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string } | null>(null);
  const [account, setAccount] = useState<{ name: string; premium: boolean } | null | undefined>(undefined);
  const listTop = useRef<HTMLDivElement>(null);

  const filterKey = JSON.stringify([debounced, provider, sort]);
  const [chosenPage, setChosenPage] = useState({ filterKey, page: 1 });
  const page = chosenPage.filterKey === filterKey ? chosenPage.page : 1;

  useEffect(() => {
    window.gamesAPI.nexusAccount().then(setAccount).catch(() => setAccount(null));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const searchKey = JSON.stringify([detail.id, provider, debounced, sort, page]);
  useEffect(() => {
    let active = true;
    window.gamesAPI
      .search(detail.id, { provider, query: debounced, sort, page: page - 1 })
      .then((next) => active && setLoaded({ key: searchKey, result: next, error: null }))
      .catch((err) => active && setLoaded({ key: searchKey, result: null, error: errorText(err) }));
    return () => {
      active = false;
    };
  }, [searchKey, detail.id, provider, debounced, sort, page]);

  const loading = loaded?.key !== searchKey;
  const result = loaded?.result ?? null;
  const loadError = loading ? null : (loaded?.error ?? null);

  useEffect(() => {
    listTop.current?.scrollIntoView({ block: "start" });
  }, [page]);

  // CurseForge lets apps reach its first 10,000 results; Nexus Mods, all of them.
  const pageCount = result ? Math.max(1, Math.ceil((provider === "curseforge" ? Math.min(result.total, 10000) : result.total) / PAGE_SIZE)) : 1;
  const goToPage = (next: number) => setChosenPage({ filterKey, page: next });

  /* The main file straight in when the site allows it; otherwise its page on the website. */
  async function quickInstall(mod: GameRemoteMod) {
    setInstalling(mod.id);
    setMessage(null);
    try {
      if (mod.provider === "nexus" && !account?.premium) {
        // Free accounts download through the website's own button, which hands the file back here.
        await window.gamesAPI.openUrl(`${mod.url}?tab=files`);
        setMessage({
          tone: "info",
          text: account
            ? `Opened ${mod.name} on Nexus Mods. Press "Mod Manager Download" on the file you want and the launcher installs it.`
            : `Opened ${mod.name} on Nexus Mods. Add your Nexus Mods key in Settings → API keys, then press "Mod Manager Download" there and the launcher installs it.`,
        });
      } else {
        let fileId: string | null = null;
        if (mod.provider === "nexus") {
          const details = await window.gamesAPI.details(detail.id, "nexus", mod.id);
          fileId = details.files.find((file) => file.category === "Main")?.id ?? details.files[0]?.id ?? null;
          if (!fileId) throw new Error(`${mod.name} has no files to download.`);
        }
        const result = await window.gamesAPI.installRemote(detail.id, mod.provider, mod.id, fileId, mod.name);
        if (result.needsWebsite !== undefined) {
          const page = result.needsWebsite ?? mod.url;
          if (page) await window.gamesAPI.openUrl(page);
          setMessage({ tone: "info", text: `${result.reason ?? "This one has to be downloaded from its website."} It's open in your browser.` });
        } else if (result.failed) {
          setMessage({ tone: "bad", text: `${result.failed}${result.notes?.length ? ` ${result.notes.join(" ")}` : ""}` });
        } else {
          setMessage({ tone: result.notes?.length ? "warn" : "good", text: `${installSummary(result)}${result.notes?.length ? ` ${result.notes.join(" ")}` : ""}` });
          afterInstall();
        }
      }
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setInstalling(null);
  }

  const dropdownStyle = { padding: "10px 12px", borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", fontSize: 13 };
  const mods = result?.mods ?? [];
  const label = provider === "curseforge" ? "CurseForge" : "Nexus Mods";

  return (
    <div>
      <h1 style={{ color: "#c084fc", marginTop: 0 }}>Discover Mods</h1>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`Search ${label} for ${detail.name} mods...`}
        style={{ width: "100%", padding: 14, borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", boxSizing: "border-box" }}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        {detail.curseforge && (
          <select style={dropdownStyle} value={provider} onChange={(event) => setProvider(event.target.value as "nexus" | "curseforge")} aria-label="Where to search">
            <option value="nexus">Nexus Mods</option>
            <option value="curseforge">CurseForge</option>
          </select>
        )}
        <select style={dropdownStyle} value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort by">
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {MORE_SITES[detail.id] && (
        <div style={{ ...panel, marginTop: 16, padding: 14 }} data-testid="more-sites">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#c084fc", fontWeight: 600, fontSize: 13, marginRight: 4 }}>More sites</span>
            {MORE_SITES[detail.id]!.map((site) => (
              <button
                key={site.url}
                className="sidebar-button"
                data-tip={`${site.about}. Opens in your browser`}
                style={{ padding: "8px 14px", fontSize: 13 }}
                onClick={() => window.gamesAPI.openUrl(site.url).catch((err) => setMessage({ tone: "bad", text: errorText(err) }))}
              >
                {site.name} ↗
              </button>
            ))}
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
            These sites don't let apps list their mods, so they open in your browser. Download what you like there, then{" "}
            <button onClick={goMods} style={{ background: "none", border: "none", padding: 0, color: "#c084fc", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
              Add from Downloads
            </button>{" "}
            installs them all at once.
          </div>
        </div>
      )}

      {provider === "nexus" && account === null && (
        <div style={{ ...note("warn"), marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>
            Searching Nexus Mods needs no key, but installing does: add your personal Nexus Mods API key in Settings → API keys.
          </span>
          <button className="sidebar-button" style={{ padding: "6px 12px", fontSize: 12 }} onClick={goLauncherSettings}>
            Open Settings
          </button>
        </div>
      )}
      {provider === "nexus" && account && !account.premium && (
        <div style={{ ...note("info"), marginTop: 16 }}>
          Signed in to Nexus Mods as {account.name}. Nexus only lets apps download straight away for Premium accounts, so Install opens the mod's
          files on the website: press "Mod Manager Download" there and the launcher installs it by itself.
        </div>
      )}

      {message && (
        <div style={{ ...note(message.tone), marginTop: 16 }} data-testid="discover-message">
          {message.text}
        </div>
      )}
      {loadError && <div style={{ ...note("warn"), marginTop: 16 }}>{loadError}</div>}

      <div ref={listTop} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {result && (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            {result.total.toLocaleString()} on {label} • Page {page.toLocaleString()} of {pageCount.toLocaleString()}
          </div>
        )}
        {result && <Pagination page={page} pageCount={pageCount} disabled={loading} onChange={goToPage} />}
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div>Loading...</div>
        ) : mods.length === 0 ? (
          <div style={{ color: "#9ca3af", padding: 20 }}>No mods found{search.trim() ? ` for "${search.trim()}"` : ""}.</div>
        ) : (
          mods.map((mod) => (
            <div
              key={`${mod.provider}-${mod.id}`}
              className="game-card"
              data-testid="game-discover-card"
              role="button"
              tabIndex={0}
              aria-label={`Open ${mod.name}`}
              onClick={() => openMod(mod.provider, mod.id)}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  openMod(mod.provider, mod.id);
                }
              }}
              style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 100, padding: 12, cursor: "pointer" }}
            >
              {/* PICTURE: Nexus' are wide screenshots, CurseForge's square logos */}
              <div
                style={{
                  width: mod.provider === "nexus" ? 124 : 70,
                  height: 70,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid #6d28d9",
                  flexShrink: 0,
                  background: "#1b1b1b",
                }}
              >
                {mod.picture ? <img src={mod.picture} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
              </div>

              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 600, color: "#c084fc" }}>{mod.name}</div>
                <div style={{ fontSize: 12, color: "#aaa" }}>{mod.summary?.slice(0, 160)}</div>
                <div style={{ fontSize: 11, marginTop: 4, color: "#d4d4d8", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ padding: "1px 6px", borderRadius: 5, background: BADGE[mod.provider].colour, color: "white", fontWeight: 700, fontSize: 10 }}>{BADGE[mod.provider].label}</span>
                  {mod.author && <span>by {mod.author}</span>}
                  <span>↓ {countText(mod.downloads)}</span>
                  {mod.endorsements != null && <span>♥ {countText(mod.endorsements)}</span>}
                  {mod.updated && <span>updated {shortDate(mod.updated)}</span>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0, cursor: "default" }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <IconButton
                  tip={
                    installing === mod.id
                      ? "Installing..."
                      : mod.provider === "nexus" && !account?.premium
                        ? "Open its files on Nexus Mods to download with the launcher"
                        : mod.installable === false
                          ? "Its author only allows downloads from their website: opens it"
                          : `Install into ${detail.name}`
                  }
                  label={`Install ${mod.name}`}
                  variant={installing === mod.id ? "ready" : ""}
                  disabled={installing !== null}
                  onClick={() => quickInstall(mod)}
                >
                  <DownloadIcon size={20} />
                </IconButton>
              </div>
            </div>
          ))
        )}
      </div>

      {result && !loading && mods.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
        </div>
      )}
    </div>
  );
}
