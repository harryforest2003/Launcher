import { useEffect, useRef, useState } from "react";
import { Clock, Download, Heart, Info } from "lucide-react";
import "../discover.css";
import "./gameDiscover.css";
import Pagination from "../../components/Pagination";
import DiscoverRow from "../DiscoverRow";
import CollectionsList from "./CollectionsList";
import ModlistsPanel from "./ModlistsPanel";
import GameSites from "./GameSites";
import { countText, errorText, installSummary, modSitesFor, shortDate } from "./shared";
import { Badge, Button, EmptyState, Monogram, Notice, SearchField, Select, Skeleton, Tabs } from "../../components/ui";

type Props = {
  detail: GameDetail;
  openMod: (provider: GameModProvider, id: string) => void;
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

function ago(iso: string) {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  if (Number.isNaN(days)) return "";
  if (days < 1) return "Today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

const BADGE: Record<string, { label: string }> = {
  nexus: { label: "Nexus" },
  curseforge: { label: "CurseForge" },
  thunderstore: { label: "Thunderstore" },
  modio: { label: "mod.io" },
  workshop: { label: "Workshop" },
  gamebanana: { label: "GameBanana" },
  factorio: { label: "Factorio" },
  spacedock: { label: "SpaceDock" },
  beatmods: { label: "BeatMods" },
  modworkshop: { label: "ModWorkshop" },
  ficsit: { label: "ficsit.app" },
  vintagestory: { label: "Mod DB" },
  contentdb: { label: "ContentDB" },
  idgames: { label: "idgames" },
};

type Offered = NonNullable<GameSearchPage["sources"]>;

/*
 * Finding mods for a game, laid out as Minecraft's Discover page: Nexus Mods and CurseForge
 * for the games they carry, and Thunderstore, mod.io, the Steam Workshop and the rest for
 * theirs, mixed under "Any site".
 * Clicking a card opens the mod's page; the download button installs its main file.
 */
export default function GameDiscover({ detail, openMod, afterInstall, openOnNexus, goLauncherSettings, goMods, openCollection }: Props) {
  // Single mods, Nexus Mods collections (whole lists of mods), or every website with mods for it.
  const [showing, setShowing] = useState<"mods" | "collections" | "modlists" | "sites">("mods");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  // Games on several sites start with all of them, mixed, as Minecraft's Discover does.
  const [provider, setProvider] = useState<"any" | GameModProvider>("any");
  // The sites with mods for this game, kept when a search fails so another can be picked.
  const [offered, setOffered] = useState<Offered>([]);
  const [sort, setSort] = useState("popular");
  // The last search's answer, and which search it answered: another one is loading until it's in.
  const [loaded, setLoaded] = useState<{ key: string; result: GameSearchPage | null; error: string | null } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "warn" | "info"; text: string } | null>(null);
  const [account, setAccount] = useState<{ name: string; premium: boolean } | null | undefined>(undefined);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
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
      .then((next) => {
        if (!active) return;
        setLoaded({ key: searchKey, result: next, error: null });
        if (next.sources) setOffered(next.sources);
      })
      .catch((err) => active && setLoaded({ key: searchKey, result: null, error: errorText(err) }));
    return () => {
      active = false;
    };
  }, [searchKey, detail.id, provider, debounced, sort, page]);

  const loading = loaded?.key !== searchKey;
  const result = loaded?.result ?? null;
  const loadError = loading ? null : (loaded?.error ?? null);

  const shownPage = useRef(page);
  useEffect(() => {
    // Only when the page number changes: arriving must not scroll the search out of sight.
    if (shownPage.current === page) return;
    shownPage.current = page;
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
        if (result.viaSteam) {
          setMessage({ tone: "info", text: `${mod.name}: ${result.reason ?? "opened in Steam. Press Subscribe there and Steam installs it."}` });
        } else if (result.needsWebsite && mod.provider === "nexus") {
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


  // The same mod listed on both sites is one row with both site chips.
  const mods = (() => {
    const rows: { mod: GameRemoteMod; also: GameRemoteMod["provider"][] }[] = [];
    for (const mod of result?.mods ?? []) {
      const twin = rows.find((row) => (row.mod.provider === mod.provider && row.mod.id === mod.id) || (row.mod.provider !== mod.provider && row.mod.name.trim().toLowerCase() === mod.name.trim().toLowerCase()));
      if (!twin) rows.push({ mod, also: [mod.provider] });
      else if (!twin.also.includes(mod.provider)) twin.also.push(mod.provider);
    }
    return rows;
  })();
  const sourceLabel = (id: string) => offered.find((source) => source.id === id)?.label ?? BADGE[id]?.label ?? id;
  const label = provider === "any" ? "every site" : sourceLabel(provider);
  const showsNexus = Boolean(detail.nexus) && (provider === "any" || provider === "nexus");
  const hasTips = showsNexus && !!account && !account.premium;
  useEffect(() => {
    if (!infoOpen) return;
    const away = (event: MouseEvent) => {
      if (!infoRef.current?.contains(event.target as Node)) setInfoOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInfoOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [infoOpen]);
  const tone = (t: "good" | "bad" | "warn" | "info") => (t === "good" ? "success" : t === "bad" ? "danger" : t === "warn" ? "warning" : "info");

  return (
    <div className="gd-page dc-workspace">
      <div className="dc-bar">
        {showing === "mods" && (
          <div className="dc-bar__row">
            <SearchField wrapperClassName="gd-search" label={`Search ${detail.name} mods`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${detail.name} mods`} />
            <Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort by">
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            {hasTips && (
              <div className="dc-info" ref={infoRef}>
                <Button
                  variant="ghost"
                  aria-label="Notes on installing"
                  title="Notes on installing"
                  aria-expanded={infoOpen}
                  aria-controls="discover-info"
                  icon={<Info size={16} aria-hidden="true" />}
                  onClick={() => setInfoOpen((open) => !open)}
                />
                {infoOpen && (
                  <div id="discover-info" className="dc-info__panel" data-testid="more-sites">
                    {showsNexus && account && !account.premium && (
                      <p title={`Using ${account.name}'s Nexus Mods key. Nexus only lets apps download straight away for Premium accounts, so Install opens the file's download on the website: press the download button there and the launcher installs it by itself.`}>
                        Nexus: Install opens the download on the site; press its button and the launcher finishes.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="dc-bar__row dc-bar__row--tabs">
          <div className={`dc-tabs${detail.nexus ? (detail.modlists ? " dc-tabs--four" : " dc-tabs--three") : ""}`}><Tabs
            label="Discover"
            idBase="discover"
            value={showing}
            onChange={setShowing}
            tabs={[
              { value: "mods", label: "Mods" },
              ...(detail.nexus ? [{ value: "collections" as const, label: "Collections" }] : []),
              ...(detail.modlists ? [{ value: "modlists" as const, label: "Modlists" }] : []),
              { value: "sites", label: "Sites", count: modSitesFor(detail.id, offered).length },
            ]}
          /></div>
          {showing === "mods" && offered.length > 1 && (
            <Select size="sm" wrapperClassName="dc-bar__source" value={provider} onChange={(event) => setProvider(event.target.value as "any" | GameModProvider)} aria-label="Where to search">
              <option value="any">Any site</option>
              {offered.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.ready ? source.label : `${source.label} (add a key)`}
                </option>
              ))}
            </Select>
          )}
          {showing === "mods" && result && (
            <span
              className="dc-bar__count dc-bar__count--keep"
              title={`${result.totals && Object.keys(result.totals).length > 1 ? Object.entries(result.totals).map(([id, count = 0]) => `${countText(count)}${id === "curseforge" && count >= 10000 ? "+" : ""} on ${sourceLabel(id)}`).join(", ") : `${countText(result.total)} on ${label}`}. Page ${page.toLocaleString()} of ${pageCount.toLocaleString()}`}
            >
              {countText(result.total)} mods
            </span>
          )}
        </div>
      </div>
      {showing === "collections" ? (
        <CollectionsList detail={detail} openCollection={openCollection} />
      ) : showing === "modlists" ? (
        <ModlistsPanel detail={detail} />
      ) : showing === "sites" ? (
        <GameSites detail={detail} sources={offered} checking={loading && !offered.length} goMods={goMods} />
      ) : (
      <>

      <div className="dc-notices">
        {showsNexus && account === null && (
          <Notice tone="warning" actions={<Button size="sm" onClick={goLauncherSettings}>Open Settings</Button>}>
            Searching Nexus Mods needs no key, but installing does: add your personal Nexus Mods API key in Settings → API keys.
          </Notice>
        )}
        {message && (
          <Notice tone={tone(message.tone)} data-testid="discover-message">
            {message.text}
          </Notice>
        )}
        {[...(result?.warnings ?? []), ...(loadError ? [loadError] : [])].map((warning) => (
          <Notice key={warning} tone="warning">{warning}</Notice>
        ))}
      </div>

      <div ref={listTop} />

      {loading ? (
        <div className="dc-list" aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="dc-skeleton">
              <Skeleton shape="block" width={48} height={48} />
              <Skeleton lines={2} />
              <Skeleton width={100} />
              <Skeleton width={84} height={32} shape="block" />
            </div>
          ))}
        </div>
      ) : mods.length === 0 ? (
        <EmptyState title={`No mods found${search.trim() ? ` for "${search.trim()}"` : ""}`} body="Try a different search or source." />
      ) : (
        <div className="dc-list">
          {mods.map(({ mod, also }) => (
            <DiscoverRow
              key={`${mod.provider}-${mod.id}`}
              testId="game-discover-card"
              name={mod.name}
              author={mod.author}
              summary={mod.summary}
              onOpen={() => openMod(mod.provider, mod.id)}
              art={mod.picture ? (
                <img src={mod.picture} alt="" loading="lazy" style={{ filter: mod.adult && blurAdult ? "blur(10px)" : undefined }} />
              ) : (
                <Monogram name={mod.name} size={48} />
              )}
              meta={
                <>
                  {/* GameBanana's and BeatMods' lists don't give a count: none is shown rather than 0. */}
                  {mod.downloads > 0 && <span className="dc-stat" title="Downloads"><Download size={12} aria-hidden="true" /><strong>{countText(mod.downloads)}</strong></span>}
                  {mod.endorsements != null && (
                    <span className="dc-stat" title="Endorsements"><Heart size={12} aria-hidden="true" />{countText(mod.endorsements)}</span>
                  )}
                  {mod.updated && (
                    <span className="dc-stat" title={`Updated ${shortDate(mod.updated)}`}><Clock size={12} aria-hidden="true" />{ago(mod.updated)}</span>
                  )}
                  {also.map((provider) => (
                    <Badge key={provider} className="dc-chip" tone={provider === "nexus" ? "accent" : "neutral"}>{BADGE[provider]?.label ?? provider}</Badge>
                  ))}
                  {mod.adult && <Badge className="dc-chip" tone="danger">18+</Badge>}
                </>
              }
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  className="iti__install"
                  icon={<Download size={14} aria-hidden="true" />}
                  aria-label={`Install ${mod.name}`}
                  title={
                    installing === mod.id
                      ? "Installing..."
                      : mod.provider === "nexus" && !account?.premium
                        ? account
                          ? "Opens its main file's download on Nexus Mods: one click there installs it"
                          : "Opens it on Nexus Mods (add your Nexus Mods key to install with the launcher)"
                        : mod.provider === "workshop"
                          ? "Opens it in Steam: press Subscribe there and Steam installs it"
                          : mod.installable === false
                            ? "Its author only allows downloads from their website: opens it"
                            : `Install into ${detail.name}`
                  }
                  disabled={installing !== null}
                  onClick={() => quickInstall(mod)}
                >
                  {installing === mod.id ? "Installing..." : "Install"}
                </Button>
              }
            />
          ))}
        </div>
      )}

      {result && !loading && mods.length > 0 && (
        <div className="dc-bottom">
          <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
        </div>
      )}
      </>
      )}
    </div>
  );
}
