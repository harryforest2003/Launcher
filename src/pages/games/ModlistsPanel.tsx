import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FolderOpen, Play, RefreshCw } from "lucide-react";
import "./modlists.css";
import { errorText, shortDate, sizeText } from "./shared";
import { Badge, Button, EmptyState, Notice, ProgressBar, SearchField, Skeleton } from "../../components/ui";

type Props = { detail: GameDetail };
type Message = { tone: "success" | "warning" | "danger"; text: string; notes?: string[] };

const KIND_LABEL: Record<WabbajackArchiveKind, string> = { nexus: "Nexus Mods", http: "Websites", cdn: "Wabbajack", game: "Your game", manual: "By hand" };
const STAGE: Record<string, string> = { fetching: "Getting the list", downloading: "Downloading archives", installing: "Installing", nexus: "Downloading from Nexus Mods" };
const SHOWN = 40;

/*
 * Wabbajack modlists for a game: whole, tested setups of hundreds of mods, built into their
 * own Mod Organizer 2 folder from archives downloaded here. Lists that also build BSA
 * archives or resize textures need the Wabbajack app, and say so.
 */
export default function ModlistsPanel({ detail }: Props) {
  const [data, setData] = useState<{ gallery: WabbajackListing[]; mine: WabbajackMine[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [plan, setPlan] = useState<WabbajackPlan | null>(null);
  const [progress, setProgress] = useState<Record<string, WabbajackProgress>>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [working, setWorking] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(() => {
    window.gamesAPI
      .modlists(detail.id)
      .then((next) => {
        setData(next);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorText(err)));
  }, [detail.id]);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .modlists(detail.id)
      .then((next) => active && setData(next))
      .catch((err) => active && setLoadError(errorText(err)));
    return () => {
      active = false;
    };
  }, [detail.id]);

  useEffect(
    () =>
      window.gamesAPI.onModlist((payload) => {
        setProgress((now) => ({ ...now, [payload.key]: payload }));
        if (payload.error) setMessage({ tone: "danger", text: payload.error });
        else if (payload.changed && payload.detail) setMessage({ tone: "success", text: payload.detail });
        if (payload.changed && payload.key === open) window.gamesAPI.modlistPlan(payload.key).then(setPlan).catch(() => {});
      }),
    [open]
  );

  const listing = useMemo(() => data?.gallery.find((entry) => entry.key === open) ?? null, [data, open]);
  const mine = useMemo(() => data?.mine.find((entry) => entry.key === open) ?? null, [data, open]);

  const show = (key: string, fetched: boolean) => {
    setOpen(key);
    setPlan(null);
    setMessage(null);
    setShowAll(false);
    if (fetched) window.gamesAPI.modlistPlan(key).then(setPlan).catch((err) => setMessage({ tone: "danger", text: errorText(err) }));
  };

  async function act(work: () => Promise<WabbajackPlan | null | void>, done?: (next: WabbajackPlan) => Message | null) {
    setWorking(true);
    setMessage(null);
    try {
      const next = await work();
      if (next) {
        setPlan(next);
        setOpen(next.key);
        const said = done?.(next);
        if (said) setMessage(said);
      }
      reload();
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err) });
    } finally {
      setWorking(false);
    }
  }

  const link = (which: "readme" | "website" | "wabbajack") => window.gamesAPI.modlistLink(detail.id, open, which).catch((err) => setMessage({ tone: "danger", text: errorText(err) }));

  if (open) {
    const now = progress[open];
    const busy = Boolean(now && now.stage !== "idle") || Boolean(plan?.busy);
    const title = plan?.title ?? listing?.title ?? mine?.title ?? "Modlist";
    const missing = plan?.archives.filter((a) => !a.have && a.kind !== "game") ?? [];
    const kinds = plan ? (Object.keys(KIND_LABEL) as WabbajackArchiveKind[]).map((kind) => ({ kind, all: plan.archives.filter((a) => a.kind === kind) })).filter((k) => k.all.length) : [];
    const blocked = plan ? plan.unsupported.length > 0 || plan.problems.length > 0 || plan.missing.count > 0 || Boolean(plan.dirProblem) : true;
    const canAuto = plan ? missing.some((a) => a.kind === "http" || a.kind === "cdn" || a.kind === "nexus") : false;
    return (
      <div className="ml" data-testid="modlist">
        <div className="ml-head">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => setOpen(null)}>
            All modlists
          </Button>
        </div>
        <div className="ml-hero">
          <div className="ml-hero__image">{listing?.image ? <img src={listing.image} alt="" /> : null}</div>
          <div className="ml-hero__text">
            <h2 className="ml-title">{title}</h2>
            <div className="ml-meta">
              {(plan?.author || listing?.author) && <span>by {plan?.author || listing?.author}</span>}
              {(plan?.version ?? listing?.version) && <span>v{plan?.version ?? listing?.version}</span>}
              {listing?.official && <Badge tone="accent">Official</Badge>}
              {plan?.installed && <Badge tone="success">Installed{plan.installed.version ? ` v${plan.installed.version}` : ""}</Badge>}
              {plan?.installed && plan.version && plan.installed.version !== plan.version && <Badge tone="warning">Update to v{plan.version}</Badge>}
            </div>
            <p className="ml-about">{(plan?.description || listing?.description || "").slice(0, 600)}</p>
            <div className="ml-actions">
              {(listing?.readme || plan?.readme) && (
                <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => link("readme")}>
                  Readme
                </Button>
              )}
              {(listing?.website || plan?.website) && (
                <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => link("website")}>
                  Website
                </Button>
              )}
            </div>
          </div>
        </div>

        {message && (
          <Notice tone={message.tone} data-testid="modlist-message">
            {message.text}
            {message.notes?.length ? (
              <ul className="ml-notes">
                {message.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </Notice>
        )}

        {busy && now && (
          <div className="ml-progress">
            <ProgressBar label={STAGE[now.stage] ?? "Working"} value={now.total ? (now.done ?? 0) / now.total : undefined} showValue={Boolean(now.total)} />
            <div className="ml-progress__row">
              <span>
                {STAGE[now.stage] ?? "Working"}
                {now.detail ? ` · ${now.detail}` : ""}
                {now.total ? ` · ${sizeText(now.done ?? 0)} of ${sizeText(now.total)}` : ""}
              </span>
              {now.stage !== "nexus" && (
                <Button size="sm" variant="ghost" onClick={() => window.gamesAPI.modlistCancel(open)}>
                  Stop
                </Button>
              )}
            </div>
          </div>
        )}

        {!plan ? (
          listing ? (
            <div className="ml-box">
              <div className="ml-sizes">
                <span>{listing.size.count != null ? `${listing.size.count.toLocaleString()} archives` : ""}</span>
                {listing.size.archives != null && <span>{sizeText(listing.size.archives)} to download</span>}
                {listing.size.installed != null && <span>{sizeText(listing.size.installed)} installed</span>}
              </div>
              <Button variant="primary" icon={<Download size={14} />} disabled={working || busy} onClick={() => act(() => window.gamesAPI.modlistGet(detail.id, listing.key))}>
                Get the list{listing.size.list ? ` (${sizeText(listing.size.list)})` : ""}
              </Button>
              <p className="ml-hint">This gets the list itself: what it needs is shown next, before anything big is downloaded.</p>
            </div>
          ) : (
            <Skeleton shape="block" height={120} />
          )
        ) : (
          <>
            {plan.unsupported.length > 0 && (
              <Notice tone="warning" actions={<Button size="sm" onClick={() => link("wabbajack")}>Wabbajack's site</Button>}>
                This list {plan.unsupported.map((u) => u.why).join(" and ")}, which only the Wabbajack app does (it runs on Windows). Its archives can still be downloaded here.
              </Notice>
            )}
            {plan.problems.map((problem) => (
              <Notice key={problem} tone="warning">
                {problem}
              </Notice>
            ))}

            <div className="ml-box">
              <h3 className="ml-h">Archives</h3>
              <div className="ml-sizes">
                <span>
                  {(plan.archives.length - missing.length).toLocaleString()} of {plan.archives.length.toLocaleString()} here
                </span>
                {plan.missing.count > 0 && <span>{sizeText(plan.missing.size)} still to download</span>}
                <span>{sizeText(plan.installSize)} installed</span>
                <span>{plan.files.toLocaleString()} files</span>
              </div>
              <div className="ml-kinds">
                {kinds.map(({ kind, all }) => (
                  <span key={kind} className="ml-kind">
                    {KIND_LABEL[kind]}: {all.filter((a) => a.have).length}/{all.length}
                  </span>
                ))}
              </div>
              <div className="ml-actions">
                {canAuto && (
                  <Button
                    variant={plan.missing.count ? "primary" : "secondary"}
                    icon={<Download size={14} />}
                    disabled={working || busy}
                    onClick={() =>
                      act(
                        () => window.gamesAPI.modlistDownload(plan.key),
                        (next) =>
                          next.failed?.length
                            ? { tone: "warning", text: `${next.failed.length} didn't download.`, notes: next.failed }
                            : next.nexusByHand
                              ? { tone: "warning", text: "Nexus Mods only lets apps download straight away for Premium accounts: open each Nexus file below and press its download button; the launcher picks it up." }
                              : { tone: "success", text: next.missing.count ? `${next.missing.count} still to get by hand.` : "Everything's downloaded." }
                      )
                    }
                  >
                    Download what can be
                  </Button>
                )}
                <Button icon={<RefreshCw size={14} />} disabled={working || busy} onClick={() => act(() => window.gamesAPI.modlistPlan(plan.key))}>
                  Check again
                </Button>
              </div>
              {missing.length > 0 && (
                <>
                  <p className="ml-hint">Files downloaded by hand can go in your Downloads folder: Check again finds them.</p>
                  <ul className="ml-missing" data-testid="modlist-missing">
                    {(showAll ? missing : missing.slice(0, SHOWN)).map((a) => (
                      <li key={a.hash}>
                        <span className="ml-missing__name" title={a.prompt ?? a.name}>
                          {a.name}
                        </span>
                        <span className="ml-missing__size">{sizeText(a.size)}</span>
                        <span className="ml-missing__from">{a.label}</span>
                        {a.page ? (
                          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => window.gamesAPI.modlistOpenArchive(plan.key, a.hash).catch((err) => setMessage({ tone: "danger", text: errorText(err) }))}>
                            Open
                          </Button>
                        ) : (
                          <span className="ml-missing__from">No page</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {missing.length > SHOWN && !showAll && (
                    <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                      Show all {missing.length.toLocaleString()}
                    </Button>
                  )}
                </>
              )}
            </div>

            <div className="ml-box">
              <h3 className="ml-h">Install</h3>
              <div className="ml-dir">
                <code title={plan.dir}>{plan.dir}</code>
                <Button size="sm" disabled={working || busy} onClick={() => act(() => window.gamesAPI.modlistChooseDir(plan.key))}>
                  Change...
                </Button>
              </div>
              {plan.dirProblem && <Notice tone="warning">{plan.dirProblem}</Notice>}
              <p className="ml-hint">The list gets its own Mod Organizer 2 in this folder; play through it. The game's own folder isn't changed.</p>
              <div className="ml-actions">
                <Button
                  variant="primary"
                  disabled={working || busy || blocked}
                  onClick={() => act(() => window.gamesAPI.modlistInstall(plan.key), (next) => ({ tone: "success", text: `${next.title} is installed: open Mod Organizer to play it.` }))}
                  title={blocked ? "Get every archive (and sort what's said above) first." : undefined}
                >
                  {plan.installed ? (plan.installed.version !== plan.version ? "Update" : "Install again") : "Install"}
                </Button>
                {plan.installed && (
                  <>
                    <Button icon={<Play size={14} />} disabled={busy} onClick={() => window.gamesAPI.modlistRun(plan.key).catch((err) => setMessage({ tone: "danger", text: errorText(err) }))}>
                      Open Mod Organizer
                    </Button>
                    <Button icon={<FolderOpen size={14} />} onClick={() => window.gamesAPI.modlistOpenFolder(plan.key).catch((err) => setMessage({ tone: "danger", text: errorText(err) }))}>
                      Open folder
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  disabled={working || busy}
                  onClick={() =>
                    act(async () => {
                      await window.gamesAPI.modlistForget(plan.key);
                      setOpen(null);
                      setPlan(null);
                    })
                  }
                >
                  Forget list
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  const needle = search.trim().toLowerCase();
  const shown = (data?.gallery ?? []).filter((entry) => !needle || `${entry.title} ${entry.author} ${entry.tags.join(" ")}`.toLowerCase().includes(needle));
  const extra = (data?.mine ?? []).filter((entry) => !data?.gallery.some((g) => g.key === entry.key));
  return (
    <div className="ml" data-testid="modlists">
      <div className="ml-bar">
        <SearchField label="Search modlists" placeholder={`Search ${detail.name} modlists...`} value={search} onChange={(event) => setSearch(event.target.value)} wrapperClassName="ml-bar__search" />
        <Button onClick={() => act(() => window.gamesAPI.modlistOpenFile(detail.id))} disabled={working}>
          Open a .wabbajack file...
        </Button>
      </div>
      <p className="ml-hint">Wabbajack modlists are whole setups of mods, tested together. Each installs into its own Mod Organizer 2, beside the game.</p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {loadError && <Notice tone="warning">{loadError}</Notice>}
      {extra.length > 0 && (
        <div className="ml-list">
          {extra.map((entry) => (
            <button key={entry.key} type="button" className="game-card ml-card" onClick={() => show(entry.key, true)}>
              <div className="ml-card__image" />
              <div className="ml-card__text">
                <div className="ml-card__title">{entry.title}</div>
                <div className="ml-card__meta">
                  <span>From a file</span>
                  {entry.version && <span>v{entry.version}</span>}
                  {entry.installed && <Badge tone="success">Installed</Badge>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {!data && !loadError ? (
        <div className="ml-list">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="block" height={94} />
          ))}
        </div>
      ) : data && !shown.length ? (
        <EmptyState title={needle ? `No modlists match "${search.trim()}"` : `No Wabbajack modlists for ${detail.name}`} body={needle ? "Try another word." : "Wabbajack's gallery has none for this game right now. A .wabbajack file from elsewhere can still be opened."} size="compact" />
      ) : (
        <div className="ml-list">
          {shown.map((entry) => (
            <button key={entry.key} type="button" className="game-card ml-card" data-testid="modlist-card" onClick={() => show(entry.key, Boolean(entry.here?.fetched))}>
              <div className="ml-card__image">{entry.image ? <img src={entry.image} alt="" loading="lazy" /> : null}</div>
              <div className="ml-card__text">
                <div className="ml-card__title">{entry.title}</div>
                <div className="ml-card__about">{entry.description.slice(0, 180)}</div>
                <div className="ml-card__meta">
                  {entry.official && <Badge tone="accent">Official</Badge>}
                  {entry.here?.installed && <Badge tone="success">Installed</Badge>}
                  {entry.author && <span>by {entry.author}</span>}
                  {entry.version && <span>v{entry.version}</span>}
                  {entry.size.count != null && <span>{entry.size.count.toLocaleString()} archives</span>}
                  {entry.size.archives != null && <span>{sizeText(entry.size.archives)} download</span>}
                  {entry.size.installed != null && <span>{sizeText(entry.size.installed)} installed</span>}
                  {entry.updated && <span>updated {shortDate(entry.updated)}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
