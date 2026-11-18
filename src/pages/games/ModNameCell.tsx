import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileCode, Folder, Package, Palette, Plug } from "lucide-react";

type Info = { picture: string | null; author: string } | null;

/* Per session: what each site said about a mod (null when it couldn't say). */
const cache = new Map<string, Info>();
const pending = new Map<string, Promise<Info>>();

function lookup(gameId: GameId, provider: "nexus" | "curseforge", modId: string): Promise<Info> {
  const key = `${gameId}:${provider}:${modId}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  let wait = pending.get(key);
  if (!wait) {
    wait = window.gamesAPI
      .details(gameId, provider, modId)
      .then((found): Info => ({ picture: found.picture || null, author: found.author || "" }))
      .catch((): Info => null)
      .then((info) => {
        cache.set(key, info);
        pending.delete(key);
        return info;
      });
    pending.set(key, wait);
  }
  return wait;
}

const PROVIDERS: Record<string, string> = { nexus: "Nexus Mods", curseforge: "CurseForge", file: "From a file", hand: "Added by hand" };

/* A kind icon for a mod that has no picture: what sort of thing it is, not its initials. */
function KindIcon({ mod }: { mod: GameMod }) {
  const props = { size: 18, "aria-hidden": true } as const;
  if (mod.kind === "plugin") return <Plug {...props} />;
  if (mod.hooks) return <FileCode {...props} />;
  if (mod.kind === "folder") return <Folder {...props} />;
  if (mod.areas.some((a) => /tuning|tray|cc|package/i.test(a.area))) return <Palette {...props} />;
  return <Package {...props} />;
}

type Props = { gameId: GameId; mod: GameMod; extra?: string; badge?: ReactNode };

/* What sort of thing it is, in plain words. */
function kindLabel(mod: GameMod): string {
  if (mod.kind === "plugin") return "Plugin";
  if (mod.hooks) return "Script mod";
  if (mod.kind === "folder") return "Folder";
  if (mod.areas.some((a) => /tray/i.test(a.area))) return "Tray item";
  return "Package";
}

/* The name cell: picture, title, and a line with the author and where it came from. */
export default function ModNameCell({ gameId, mod, extra, badge }: Props) {
  const box = useRef<HTMLSpanElement>(null);
  const provider = mod.source?.provider;
  const modId = mod.source?.modId;
  const remote = mod.managed && modId && (provider === "nexus" || provider === "curseforge") ? { provider: provider as "nexus" | "curseforge", modId } : null;
  const key = remote ? `${gameId}:${remote.provider}:${remote.modId}` : "";
  const [loaded, setLoaded] = useState<{ key: string; info: Info } | null>(null);
  const [broken, setBroken] = useState(false);
  const info = loaded && loaded.key === key ? loaded.info : key && cache.has(key) ? (cache.get(key) ?? null) : null;

  // Only rows that scroll into view ask the site.
  useEffect(() => {
    if (!remote || !box.current) return;
    let alive = true;
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      lookup(gameId, remote.provider, remote.modId).then((found) => alive && setLoaded({ key, info: found }));
    });
    watch.observe(box.current);
    return () => {
      alive = false;
      watch.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, gameId]);

  const place = mod.managed ? (PROVIDERS[provider ?? "file"] ?? provider ?? "") : `In ${mod.where ?? "the game's folders"}`;
  const files = mod.fileCount > 0 ? `${mod.fileCount} file${mod.fileCount === 1 ? "" : "s"}` : "";
  const subline = [kindLabel(mod), files, mod.managed ? place : mod.where ? `In ${mod.where}` : "", info?.author ? `by ${info.author}` : "", extra ?? ""].filter(Boolean).join(" · ");
  const line = [info?.author ? `by ${info.author}` : "", place, extra ?? ""].filter(Boolean).join(" • ");
  const detail = [line, ...mod.areas.map((a) => `${a.count} in ${a.area}`), mod.plugins.length ? `Plugins: ${mod.plugins.join(", ")}` : "", mod.installedAt ? `Installed ${mod.installedAt.slice(0, 10)}` : "", ...mod.notes]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <span ref={box} className="gm-tile" aria-hidden="true">
        {info?.picture && !broken ? (
          <img src={info.picture} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <KindIcon mod={mod} />
        )}
      </span>
      <div className="gm-name" title={detail}>
        <div className="gm-name__title">
          <span className="gm-name__text">{mod.name}</span>
          {mod.version && <span className="gm-name__ver">v{mod.version.replace(/^v/i, "")}</span>}
        </div>
        <div className="gm-name__sub">
          {badge}
          <span className="gm-name__subtext">{subline}</span>
        </div>
      </div>
    </>
  );
}
