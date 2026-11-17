import { useEffect, useRef, useState } from "react";
import IconButton from "../../components/IconButton";
import { DownloadIcon } from "../../components/Icons";
import Pagination from "../../components/Pagination";
import CollectionsList from "./CollectionsList";
import { countText, errorText, installSummary, MORE_SITES, note, panel, shortDate } from "./shared";
import { SearchField, Select, Tabs } from "../../components/ui";

type Props = {
  detail: GameDetail;
  openMod: (provider: "nexus" | "curseforge", id: string) => void;
  afterInstall: (result: GameInstallResult) => void;
  /* A free Nexus account installs through the website; what the mod needs follows it. */
  openOnNexus: (item: { modId: string; name: string; page: string }) => Promise<void>;
  goLauncherSettings: () => void;
  goMods: () => void;
  openCollection: (slug: string) => void;
};

const PAGE_SIZE = 24;

const SORTS = [
  { id: "popular", label: "Most popular" },
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recently updated" },
  { id: "new", label: "Newest" },
];

const BADGE: Record<string, { label: string; colour: string }> = {
  nexus: { label: "NEXUS MODS", colour: "var(--color-warning-solid)" },
  curseforge: { label: "CURSEFORGE", colour: "var(--color-warning-solid)" },
};

/*
 * Finding mods for a game, laid out as Minecraft's Discover page: Nexus Mods for every
 * game, and CurseForge too for the games it carries (The Sims 4, Stardew Valley).
 * Clicking a card opens the mod's page; the download button installs its main file.
 */
export default function GameDiscover({ detail, openMod, afterInstall, openOnNexus, goLauncherSettings, goMods, openCollection }: Props) {
  // Single mods, or Nexus Mods collections (whole lists of mods).
  const [showing, setShowing] = useState<"mods" | "collections">("mods");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  // Games on both sites start with both, mixed, as Minecraft's Discover does.
  const [provider, setProvider] = useState<"any" | "nexus" | "curseforge">(detail.curseforge ? "any" : "nexus");
  const [sort, setSort] = useState("popular");
  // The last search's answer, and which search it answered: another one is loading until it's in.
  const [loaded, setLoaded] = useState<{ key: string; result: GameSearchPage | null; error: string | null } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string } | null>(null);
  const [account, setAccount] = useState<{ name: string; premium: boolean } | null | undefined>(undefined);
  const listTop = useRef<HTMLDivElement>(null);

  const filterKey = JSON.stringify([debounced, provider, sort]);
  const [chosenPage, setChosenPage] = useState({ filterKey, page: 1 });
  const page = chosenPage.filterKey === filterKey ? chosenPage.page : 1;

  // Adult mods' pictures are blurred when the account's Nexus preferences say so.
  const [blurAdult, setBlurAdult] = useState(true);

  useEffect(() => {
    window.gamesAPI.nexusAccount().then(setAccount).catch(() => setAccount(null));
    window.gamesAPI
      .adultStatus()
      .then((status) => setBlurAdult(status.blur))
      .catch(() => {});
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
  // CurseForge lets apps reach its first 10,000 results; Nexus Mods, all of them.
  const pageCount = result ? (result.pageCount ?? Math.max(1, Math.ceil((provider === "curseforge" ? Math.min(result.total, 10000) : result.total) / PAGE_SIZE))) : 1;
  const goToPage = (next: number) => setChosenPage({ filterKey, page: next });

  /* The main file straight in when the site allows it; otherwise its page on the website. */
  async function quickInstall(mod: GameRemoteMod) {
    setInstalling(mod.id);
    setMessage(null);
    try {
      if (mod.provider === "nexus" && !account?.premium) {
        // Free accounts download through the website's own button, which hands the file back
        // here: straight to the main file's download, so that's the one click left.
        if (account) {
          const details = await window.gamesAPI.details(detail.id, "nexus", mod.id);
          const main = details.files.find((file) => file.category === "Main") ?? details.files[0];
          await openOnNexus({ modId: mod.id, name: mod.name, page: main ? `${mod.url}?tab=files&file_id=${main.id}&nmm=1` : `${mod.url}?tab=files` });
        } else {
          await window.gamesAPI.openUrl(`${mod.url}?tab=files`);
          setMessage({ tone: "info", text: `Opened ${mod.name} on Nexus Mods. To install with the launcher, add your Nexus Mods key in Settings → API keys first.` });
        }
      } else {
        let fileId: string | null = null;
        if (mod.provider === "nexus") {
          const details = await window.gamesAPI.details(detail.id, "nexus", mod.id);
          fileId = details.files.find((file) => file.category === "Main")?.id ?? details.files[0]?.id ?? null;
          if (!fileId) throw new Error(`${mod.name} has no files to download.`);
        }
        const result = await window.gamesAPI.installRemote(detail.id, mod.provider, mod.id, fileId, mod.name);
        if (result.needsWebsite && mod.provider === "nexus") {
          await openOnNexus({ modId: mod.id, name: mod.name, page: result.needsWebsite });
        } else if (result.needsWebsite !== undefined) {
          const page = result.needsWebsite ?? mod.url;
          if (page) await window.gamesAPI.openUrl(page);
          setMessage({ tone: "info", text: `${result.reason ?? "This one has to be downloaded from its website."} It's open in your browser.` });
        } else if (result.failed) {
          setMessage({ tone: "bad", text: `${result.failed}${result.notes?.length ? ` ${result.notes.join(" ")}` : ""}` });
        } else {
          setMessage({ tone: result.notes?.length ? "warn" : "good", text: `${installSummary(result)}${result.notes?.length ? ` ${result.notes.join(" ")}` : ""}` });
          afterInstall(result);
        }
      }
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setInstalling(null);
  }


  const mods = result?.mods ?? [];
  const label = provider === "curseforge" ? "CurseForge" : provider === "nexus" ? "Nexus Mods" : "Nexus Mods and CurseForge";
  const showsNexus = provider !== "curseforge";

  return (
    <div>
      <header className="page-header"><h1 className="page-title">Discover Mods</h1></header>
      {detail.nexus && (
        <div style={{ marginBottom: 12 }}>
          <Tabs
            label="Discover"
            idBase="discover"
            value={showing}
            onChange={setShowing}
            tabs={[
              { value: "mods", label: "Mods" },
              { value: "collections", label: "Collections" },
            ]}
          />
        </div>
      )}
      {showing === "collections" ? (
        <CollectionsList detail={detail} openCollection={openCollection} />
      ) : (
      <>

      <SearchField label={`Search ${detail.name} mods`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label} for ${detail.name} mods…`} />

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        {detail.curseforge && (
          <Select value={provider} onChange={(event) => setProvider(event.target.value as "any" | "nexus" | "curseforge")} aria-label="Where to search">
            <option value="any">Any source</option>
            <option value="nexus">Nexus Mods</option>
            <option value="curseforge">CurseForge</option>
          </Select>
        )}
        <Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort by">
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {MORE_SITES[detail.id] && (
        <div style={{ ...panel, marginTop: 16, padding: 14 }} data-testid="more-sites">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--color-accent-text)", fontWeight: 600, fontSize: 13, marginRight: 4 }}>More sites</span>
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
          <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
            These sites don't let apps list their mods, so they open in your browser. Download what you like there, then{" "}
            <button onClick={goMods} style={{ background: "none", border: "none", padding: 0, color: "var(--color-accent-text)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
              Add from Downloads
            </button>{" "}
            installs them all at once.
          </div>
        </div>
      )}

      {showsNexus && account === null && (
        <div style={{ ...note("warn"), marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>
            Searching Nexus Mods needs no key, but installing does: add your personal Nexus Mods API key in Settings → API keys.
          </span>
          <button className="sidebar-button" style={{ padding: "6px 12px", fontSize: 12 }} onClick={goLauncherSettings}>
            Open Settings
          </button>
        </div>
      )}
      {showsNexus && account && !account.premium && (
        <div style={{ ...note("info"), marginTop: 16 }}>
          Using {account.name}'s Nexus Mods key. Nexus only lets apps download straight away for Premium accounts, so Install opens the file's
          download on the website: press the download button there and the launcher installs it by itself.
        </div>
      )}

      {message && (
        <div style={{ ...note(message.tone), marginTop: 16 }} data-testid="discover-message">
          {message.text}
        </div>
      )}
      {[...(result?.warnings ?? []), ...(loadError ? [loadError] : [])].map((warning) => (
        <div key={warning} style={{ ...note("warn"), marginTop: 16 }}>
          {warning}
        </div>
      ))}

      <div ref={listTop} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {result && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {result.totals && Object.keys(result.totals).length > 1
              ? `${(result.totals.nexus ?? 0).toLocaleString()} on Nexus Mods • ${(result.totals.curseforge ?? 0).toLocaleString()}${(result.totals.curseforge ?? 0) >= 10000 ? "+" : ""} on CurseForge`
              : `${result.total.toLocaleString()} on ${label}`}
            {` • Page ${page.toLocaleString()} of ${pageCount.toLocaleString()}`}
          </div>
        )}
        {result && <Pagination page={page} pageCount={pageCount} disabled={loading} onChange={goToPage} />}
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div>Loading...</div>
        ) : mods.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)", padding: 20 }}>No mods found{search.trim() ? ` for "${search.trim()}"` : ""}.</div>
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
                  border: "1px solid var(--color-border)",
                  flexShrink: 0,
                  background: "var(--color-surface-sunken)",
                }}
              >
                {mod.picture ? (
                  <img src={mod.picture} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", filter: mod.adult && blurAdult ? "blur(10px)" : undefined }} />
                ) : null}
              </div>

              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 600, color: "var(--color-accent-text)" }}>{mod.name}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{mod.summary?.slice(0, 160)}</div>
                <div style={{ fontSize: 11, marginTop: 4, color: "var(--color-text-secondary)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ padding: "1px 6px", borderRadius: 5, background: BADGE[mod.provider].colour, color: "var(--color-on-warning)", fontWeight: 700, fontSize: 10 }}>{BADGE[mod.provider].label}</span>
                  {mod.adult && <span style={{ padding: "1px 6px", borderRadius: 5, border: "1px solid var(--color-danger-border)", color: "var(--color-danger-text)", fontWeight: 700, fontSize: 10 }}>18+</span>}
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
                        ? account
                          ? "Opens its main file's download on Nexus Mods: one click there installs it"
                          : "Opens it on Nexus Mods (add your Nexus Mods key to install with the launcher)"
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
      </>
      )}
    </div>
  );
}
