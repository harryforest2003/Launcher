import { useEffect, useState } from "react";
import { Clock, Download, ExternalLink } from "lucide-react";
import { Badge, Button, EmptyState, Monogram, Notice, Skeleton } from "../components/ui";
import PackVersionPicker from "../components/PackVersionPicker";
import type { PackVersion } from "../components/packVersions";
import Pagination from "../components/Pagination";
import DiscoverRow from "./DiscoverRow";
import { PLATFORM_NAMES } from "./platformSites";

const LOADERS: Record<string, string> = { forge: "Forge", neoforge: "NeoForge", fabric: "Fabric", quilt: "Quilt", "legacy-fabric": "Legacy Fabric", babric: "Babric", liteloader: "LiteLoader" };

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const plain = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function ago(iso: string) {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  if (Number.isNaN(days)) return "";
  if (days < 1) return "Today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}

type Props = {
  platform: PlatformPackSite;
  query: string;
  /** The Loader and Minecraft version filters, when set. */
  loader?: string;
  mcVersion?: string;
  /** The id of the pack installing, if any. */
  installing: string | null;
  onInstall: (item: PlatformPackItem, version: PackVersion) => void;
};

type RowProps = { item: PlatformPackItem; installing: string | null; onInstall: (item: PlatformPackItem) => void };

/* One FTB, Technic or ATLauncher pack in a Discover list. Install asks which version first. */
export function PlatformPackRow({ item, installing, onInstall }: RowProps) {
  const site = PLATFORM_NAMES[item.source];
  const open = () => item.url && window.modAPI.openUrl(item.url).catch(() => {});
  return (
    <DiscoverRow
      testId="platform-pack"
      name={item.name}
      author={item.author}
      summary={item.summary}
      onOpen={open}
      art={item.icon ? <img src={item.icon} alt="" loading="lazy" /> : <Monogram name={item.name} size={48} />}
      meta={
        <>
          {item.downloads > 0 && (
            <span className="dc-stat" title={`${item.downloads.toLocaleString()} installs`}>
              <Download size={12} aria-hidden="true" />
              <strong>{compact(item.downloads)}</strong>
            </span>
          )}
          {item.date && (
            <span className="dc-stat" title={new Date(item.date).toLocaleDateString()}>
              <Clock size={12} aria-hidden="true" />
              {ago(item.date)}
            </span>
          )}
          <Badge className="dc-chip">Modpack</Badge>
          <Badge className="dc-chip">{site}</Badge>
          {item.loader && <span className="dc-tag">{LOADERS[item.loader] ?? item.loader}</span>}
          {item.mcVersion && <span className="dc-tag">{item.mcVersion}</span>}
        </>
      }
      action={
        item.installable ? (
          <Button
            className="iti__install"
            icon={<Download size={14} aria-hidden="true" />}
            disabled={!!installing}
            onClick={() => onInstall(item)}
            title="Creates a new instance with this pack's Minecraft version, loader and mods"
          >
            {installing === item.id ? "Installing..." : "Install"}
          </Button>
        ) : (
          <Button variant="secondary" icon={<ExternalLink size={14} aria-hidden="true" />} title={`This pack has no download on ${site}`} onClick={open}>
            Open site
          </Button>
        )
      }
    />
  );
}

/*
 * Modpacks from Feed The Beast, Technic or ATLauncher, when Discover's Source filter is set
 * to one of them. Each installs as a new instance, from a chosen version, like a Modrinth or
 * CurseForge pack. The Minecraft version filter applies; the loader one only on FTB, since
 * Technic and ATLauncher don't list a pack's loader.
 */
export default function PlatformPacks({ platform, query, loader, mcVersion, installing, onInstall }: Props) {
  const [chosenPage, setChosenPage] = useState({ key: "", page: 1 });
  const key = JSON.stringify([platform, query, loader ?? "", mcVersion ?? ""]);
  const page = chosenPage.key === key ? chosenPage.page : 1;
  const [result, setResult] = useState<PlatformPackPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [picking, setPicking] = useState<PlatformPackItem | null>(null);
  const requestKey = `${key}:${page}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let current = true;
    window.instanceAPI
      .searchPlatformPacks(platform, { query, page, loader, mcVersion })
      .then((next) => {
        if (!current) return;
        setResult(next);
        setError(null);
      })
      .catch((err) => {
        if (!current) return;
        setResult(null);
        setError(plain(err));
      })
      .finally(() => current && setLoadedKey(requestKey));
    return () => {
      current = false;
    };
  }, [platform, query, page, loader, mcVersion, requestKey]);

  const items = result?.items ?? [];
  const site = PLATFORM_NAMES[platform];

  return (
    <>
      {error && <Notice tone="warning">{`${site}: ${error}`}</Notice>}

      {picking && (
        <PackVersionPicker
          source={picking.source}
          projectId={picking.id}
          name={picking.name}
          icon={picking.icon}
          onPick={(version) => {
            setPicking(null);
            onInstall(picking, version);
          }}
          onClose={() => setPicking(null)}
        />
      )}

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
      ) : items.length === 0 ? (
        <EmptyState
          title={`No ${site} modpacks found${query ? ` for "${query}"` : ""}`}
          body={result?.loaderUnknown ? `${site} doesn't say which loader a pack uses, so the Loader filter leaves nothing.` : loader || mcVersion ? "Try clearing the filters." : "Try a different search."}
        />
      ) : (
        <div className="dc-list">
          {items.map((item) => (
            <PlatformPackRow key={`${item.source}-${item.id}`} item={item} installing={installing} onInstall={setPicking} />
          ))}
        </div>
      )}

      {result && !loading && items.length > 0 && result.pageCount > 1 && (
        <div className="dc-bottom">
          <Pagination page={result.page} pageCount={result.pageCount} onChange={(next) => setChosenPage({ key, page: next })} />
        </div>
      )}
    </>
  );
}
