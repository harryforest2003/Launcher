import BackgroundLogo from "../components/BackgroundLogo";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock, Download, ExternalLink, Heart } from "lucide-react";
import { Badge, Button, EmptyState, Monogram, Notice, ProgressBar, Skeleton, Tabs } from "../components/ui";
import "./discover.css";
import InstallToInstance from "../components/InstallToInstance";
import Sidebar from "../components/MCSidebar";
import PackContentsList from "../components/PackContentsList";
import PackVersionPicker from "../components/PackVersionPicker";
import { CHANNEL, channelOf, type PackVersion } from "../components/packVersions";
import { useModpackInstall } from "../components/useModpackInstall";
import { countChannels, useChannelFilter } from "../components/versionChannels";
import ChannelFilterBar from "../components/ChannelFilterBar";
import { descriptionHtml } from "../utils/projectDescription";
import { projectFromLink } from "../utils/projectLinks";

type Common = {
  source: "modrinth" | "curseforge";
  projectId: string;
  openProject: (source: "modrinth" | "curseforge", id: string) => void;
  onBack: () => void;
};

/** A screen of its own, with the launcher's sidebar. */
type Routed = Common & {
  embedded?: false;
  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

/** Inside another page (an instance's), with a back button in place of the sidebar. */
type Embedded = Common & {
  embedded: true;
  backLabel: string;
  /** The instance it was opened from: offered first when adding, and told when added to. */
  instanceName?: string;
  onInstalled?: (instanceName: string) => void;
};

type Props = Routed | Embedded;

const date = (value?: string) => (value ? new Date(value).toLocaleDateString() : "Unknown");

type Section = "desc" | "mods" | "versions" | "gallery";

type Version = {
  id: string; name?: string; version_number?: string; version_type?: string;
  game_versions?: string[]; loaders?: string[]; downloads?: number; date_published?: string;
};
type Project = {
  id?: string | number; title?: string; description?: string; body?: string; icon?: string | null;
  authors?: string[]; type: string; downloads?: number; followers?: number; created?: string; updated?: string;
  minecraftVersions?: string[]; loaders?: string[]; installable?: boolean; url?: string; website?: string;
  gallery?: (string | { url?: string; thumbnailUrl?: string })[]; versions?: Version[];
};

const TYPE_LABELS: Record<string, string> = {
  mod: "Mod",
  modpack: "Modpack",
  shader: "Shader",
  datapack: "Data Pack",
  resourcepack: "Resource Pack",
};

function ModDescription(props: Props) {
  const { source, projectId, openProject, onBack } = props;
  const [mod, setMod] = useState<Project | null>(null);
  const [tab, setTab] = useState<Section>("desc");
  const [pickingVersion, setPickingVersion] = useState(false);
  const pack = useModpackInstall();

  const [versions, setVersions] = useState<Version[]>([]);
  const [failed, setFailed] = useState(false);
  // Why it failed, when the launcher knows (CurseForge busy, say).
  const [failReason, setFailReason] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      // Following a link reuses this page, so the last project has to go first.
      setMod(null);
      setFailed(false);
      setFailReason(null);
      setTab("desc");

      let reason: string | null = null;
      const project = await window.launcherAPI.getProject(source, projectId).catch((err: unknown) => {
        reason = String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        return null;
      });
      if (!active) return;

      setFailed(!project);
      setFailReason(reason);
      setMod(project);
      setVersions(project?.versions || []);
    }

    load();

    return () => {
      active = false;
    };
  }, [source, projectId]);

  /*
   * Links to other projects stay in the launcher. Everything else carries on to the
   * system browser, as does a project link that turns out not to lead anywhere here.
   */
  async function followLink(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
    const link = anchor && projectFromLink(anchor.href);
    if (!anchor || !link) return;

    event.preventDefault();

    const found = await window.launcherAPI.resolveProjectLink(link).catch(() => null);

    if (!found) {
      window.modAPI.openUrl(anchor.href).catch(() => {});
    } else if (found.source === source && String(found.id) === String(mod?.id)) {
      setTab(link.section);
    } else {
      openProject(found.source, found.id);
    }
  }

  const body = useMemo(
    () => descriptionHtml(source, mod?.body || mod?.description || "No description"),
    [source, mod]
  );

  const shell = (children: React.ReactNode) =>
    props.embedded ? (
      <div className="pd-page pd-page--embedded">
        <Button
          variant="ghost"
          size="sm"
          className="pd-back"
          icon={<ArrowLeft size={16} aria-hidden="true" />}
          onClick={onBack}
          data-testid="project-back"
        >
          {props.backLabel}
        </Button>
        {children}
      </div>
    ) : (
      <div className="app-screen">
        <Sidebar
          currentPage="discover"
          goHome={props.goHome}
          goMinecraft={props.goMinecraft}
          goDiscover={props.goDiscover}
          goLibrary={props.goLibrary}
          goSkinSelector={props.goSkinSelector}
          goSettings={props.goSettings}
          showBack
          onBack={onBack}
        />
        <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", display: "flex" }}>
          <BackgroundLogo />
          <div className="pd-page">{children}</div>
        </div>
      </div>
    );

  if (failed) {
    return shell(
      <Notice tone="danger" actions={<Button size="sm" onClick={onBack}>Back</Button>}>
        {failReason ?? "This project could not be loaded. Check your connection."}
      </Notice>
    );
  }

  if (!mod) {
    return shell(
      <div className="pd-loading" aria-busy="true" aria-label="Loading project">
        <Skeleton shape="block" height={132} />
        <Skeleton lines={5} />
      </div>
    );
  }

  const siteName = source === "curseforge" ? "CurseForge" : "Modrinth";
  const gameVersions: string[] = mod.minecraftVersions ?? [];
  const recent = gameVersions.slice(-8).reverse();
  const loaders: string[] = mod.loaders ?? [];
  const website = mod.website || mod.url;
  const isPack = mod.type === "modpack";
  const packName = mod.title ?? "Modpack";

  function installPack(version: PackVersion) {
    setPickingVersion(false);
    pack.install({ source, projectId, name: packName, icon: mod?.icon }, version);
  }

  return shell(
    <>
      {/* HERO */}
      <header className="pd-hero">
        <div className="pd-icon">
          {mod.icon ? <img src={mod.icon} alt="" /> : <Monogram name={mod.title ?? "Project"} size={72} />}
        </div>

        <div className="pd-titles">
          <div className="pd-titleline">
            <h1 className="pd-title">{mod.title}</h1>
            <Badge tone="accent">{siteName}</Badge>
            <Badge>{TYPE_LABELS[mod.type] ?? mod.type}</Badge>
          </div>
          {!!mod.authors?.length && <div className="pd-by">by <strong>{mod.authors.join(", ")}</strong></div>}
          <p className="pd-summary">{mod.description}</p>
          <div className="pd-stats">
            <span className="pd-stat"><Download size={14} aria-hidden="true" /><strong>{(mod.downloads ?? 0).toLocaleString()}</strong> downloads</span>
            {mod.followers != null && <span className="pd-stat"><Heart size={14} aria-hidden="true" /><strong>{Number(mod.followers).toLocaleString()}</strong> followers</span>}
            {mod.updated && <span className="pd-stat"><Clock size={14} aria-hidden="true" />Updated {date(mod.updated)}</span>}
          </div>
        </div>

        <div className="pd-hero__action">
          {isPack ? (
            mod.installable === false ? (
              website && (
                <Button variant="secondary" onClick={() => window.modAPI.openUrl(website).catch(() => {})}>
                  Open on {siteName} <ExternalLink size={14} aria-hidden="true" />
                </Button>
              )
            ) : (
              <Button
                variant="primary"
                icon={<Download size={16} aria-hidden="true" />}
                data-testid="pack-install"
                disabled={!!pack.installing || !versions.length}
                onClick={() => setPickingVersion(true)}
              >
                {pack.installing ? "Installing..." : "Install"}
              </Button>
            )
          ) : (
            <InstallToInstance
              source={source}
              projectId={projectId}
              name={mod.title ?? ""}
              icon={mod.icon}
              type={mod.type}
              installable={mod.installable !== false}
              url={mod.url}
              emphasis="solid"
              preferInstance={props.embedded ? props.instanceName : undefined}
              onInstalled={props.embedded ? props.onInstalled : undefined}
            />
          )}
        </div>
      </header>

      {isPack && (pack.error || pack.result || (pack.installing && pack.progress)) && (
        <div className="pd-notices">
          {pack.error && <Notice tone="danger" style={{ whiteSpace: "pre-wrap" }}>{pack.error}</Notice>}
          {pack.result && <Notice tone="success">{pack.result}</Notice>}
          {pack.installing && pack.progress && (
            <Notice tone="info">
              <div>{pack.progress.detail ?? pack.progress.stage} ({pack.progress.percent}%)</div>
              <ProgressBar value={pack.progress.percent / 100} label="Modpack install progress" />
            </Notice>
          )}
        </div>
      )}

      {pickingVersion && (
        <PackVersionPicker
          source={source}
          projectId={projectId}
          name={packName}
          icon={mod.icon}
          versions={versions}
          onPick={installPack}
          onClose={() => setPickingVersion(false)}
        />
      )}

      <div className="pd-body">
        <section className="pd-main">
          <Tabs
            label="Project sections"
            idBase="project"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "desc", label: "Description" },
              ...(isPack ? [{ value: "mods" as Section, label: "Mods" }] : []),
              { value: "versions", label: "Versions", count: versions.length || undefined },
              { value: "gallery", label: "Gallery", count: mod.gallery?.length || undefined },
            ]}
          />

          <div className="pd-panel" role="tabpanel" id={`project-panel-${tab}`}>
            {tab === "desc" && (
              <div className="pd-desc">
                <div className="mod-description" onClick={followLink} dangerouslySetInnerHTML={{ __html: body }} />
              </div>
            )}

            {tab === "mods" && isPack && (
              <PackContentsList source={source} projectId={projectId} versions={versions} openProject={openProject} />
            )}

            {tab === "versions" &&
              (versions.length === 0 ? (
                <EmptyState size="compact" title="No versions listed" body="Open the project's site to see its files." />
              ) : (
                <VersionsTable versions={versions} />
              ))}

            {tab === "gallery" &&
              ((mod.gallery ?? []).length === 0 ? (
                <EmptyState size="compact" title="No pictures yet" />
              ) : (
                <div className="pd-gallery">
                  {(mod.gallery ?? []).map((img, i) => (
                    <img key={i} className="pd-full" loading="lazy" alt="" src={typeof img === "string" ? img : img.thumbnailUrl || img.url} />
                  ))}
                </div>
              ))}
          </div>
        </section>

        {/* SIDE */}
        <aside className="pd-side">
          <div>
            <h2>Compatibility</h2>
            <p className="pd-label">Minecraft versions</p>
            <div className="pd-chips">
              {recent.length ? recent.map((v) => <Badge key={v}>{v}</Badge>) : <span className="pd-label">Unknown</span>}
            </div>
            {gameVersions.length > recent.length && (
              <details>
                <summary className="pd-label" style={{ cursor: "pointer", marginTop: "var(--space-2)" }}>
                  Show all {gameVersions.length}
                </summary>
                <p className="pd-allversions">{gameVersions.join(", ")}</p>
              </details>
            )}
            <p className="pd-label" style={{ marginTop: "var(--space-3)" }}>Loaders</p>
            <div className="pd-chips">
              {mod.type === "mod" || mod.type === "modpack"
                ? loaders.length ? loaders.map((l) => <Badge key={l} tone="accent">{l}</Badge>) : <span className="pd-label">Unknown</span>
                : <span className="pd-label">None needed</span>}
            </div>
          </div>

          <div>
            <h2>Details</h2>
            <dl className="pd-facts">
              <dt>Downloads</dt><dd>{mod.downloads?.toLocaleString() ?? "Unknown"}</dd>
              <dt>Followers</dt><dd>{mod.followers?.toLocaleString?.() ?? "Unknown"}</dd>
              <dt>Created</dt><dd>{date(mod.created)}</dd>
              <dt>Updated</dt><dd>{date(mod.updated)}</dd>
              <dt>Source</dt><dd>{siteName}</dd>
              <dt>Website</dt>
              <dd>
                <a href={website || "#"} target="_blank" rel="noreferrer">
                  Open project <ExternalLink size={13} aria-hidden="true" />
                </a>
              </dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}

export default ModDescription;

/* Every version of a project, narrowed to full releases, betas or alphas if wanted. */
function VersionsTable({ versions }: { versions: Version[] }) {
  const counts = useMemo(() => countChannels(versions.map(channelOf)), [versions]);
  const { filter, wanted, setFilter } = useChannelFilter(counts);
  const shown = filter === "all" ? versions : versions.filter((v) => channelOf(v) === filter);

  return (
    <div className="pd-versions">
      <ChannelFilterBar counts={counts} value={filter} wanted={wanted} onChange={setFilter} />
      <table className="pd-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Type</th>
            <th>Game version</th>
            <th>Loaders</th>
            <th className="pd-num">Downloads</th>
            <th className="pd-num">Published</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => (
            <tr key={v.id}>
              <td><span className="pd-vname">{v.name || v.version_number}</span></td>
              <td>
                <span title={CHANNEL[channelOf(v)].hint}>
                  <Badge tone={CHANNEL[channelOf(v)].tone}>{CHANNEL[channelOf(v)].label}</Badge>
                </span>
              </td>
              <td>{v.game_versions?.slice(-3).join(", ")}</td>
              <td>{v.loaders?.join(", ")}</td>
              <td className="pd-num">{v.downloads?.toLocaleString() ?? "N/A"}</td>
              <td className="pd-num">{date(v.date_published)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
