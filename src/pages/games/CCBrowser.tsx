import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, FolderOpen, RefreshCw, Sofa, Shirt, Sparkles, Box } from "lucide-react";
import { Button, EmptyState, Notice, SearchField, Select, Skeleton } from "../../components/ui";
import "./gameDiscover.css";
import IconButton from "../../components/IconButton";
import Toggle from "../../components/Toggle";
import { BinIcon } from "../../components/Icons";
import { errorText, sizeText } from "./shared";

type Props = {
  detail: GameDetail;
  /* After something's turned on or off, or deleted, the Mods page is refreshed too. */
  reload: () => Promise<void>;
};

type Category = GameCC["category"];
const CATEGORIES: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "Create a Sim", label: "Create a Sim" },
  { id: "Build/Buy", label: "Build/Buy" },
  { id: "Gameplay", label: "Gameplay" },
  { id: "Script", label: "Scripts" },
  { id: "Other", label: "Other" },
];
const ICONS: Record<Category, typeof Shirt> = { "Create a Sim": Shirt, "Build/Buy": Sofa, Gameplay: Sparkles, Script: FileCode2, Other: Box };
const PAGE = 120;

/* Pictures already made, by rel path (null: there isn't one). They last while the launcher's open. */
const madePictures = new Map<string, string | null>();

/* The game's pictures are JPEGs with their transparency kept apart, as a greyscale PNG: put back together. */
function withAlpha(src: string, alpha: string | null): Promise<string> {
  if (!alpha) return Promise.resolve(src);
  const load = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  return Promise.all([load(src), load(alpha)])
    .then(([colour, mask]) => {
      const canvas = document.createElement("canvas");
      canvas.width = colour.naturalWidth;
      canvas.height = colour.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return src;
      ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
      const maskData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(colour, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) image.data[i + 3] = maskData[i];
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    })
    .catch(() => src);
}

/*
 * Asks for pictures in batches as cards come into view: each card calls want(rel) and is
 * told when its picture's ready.
 */
function usePictures() {
  const [, setVersion] = useState(0);
  const waiting = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  const flush = () => {
    timer.current = null;
    const rels = [...waiting.current].slice(0, 40);
    rels.forEach((rel) => waiting.current.delete(rel));
    if (!rels.length) return;
    window.gamesAPI
      .ccPictures(rels)
      .then(async (found) => {
        await Promise.all(
          rels.map(async (rel) => {
            const picture = found[rel];
            madePictures.set(rel, picture ? await withAlpha(picture.src, picture.alpha) : null);
          })
        );
      })
      .catch(() => rels.forEach((rel) => madePictures.set(rel, null)))
      .finally(() => {
        setVersion((v) => v + 1);
        if (waiting.current.size) timer.current = window.setTimeout(flush, 0);
      });
  };

  const want = (rel: string) => {
    if (madePictures.has(rel) || waiting.current.has(rel)) return;
    waiting.current.add(rel);
    if (timer.current === null) timer.current = window.setTimeout(flush, 60);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );
  return want;
}

function Card({ item, want, busy, confirming, onToggle, onReveal, onDelete }: {
  item: GameCC;
  want: (rel: string) => void;
  busy: boolean;
  confirming: boolean;
  onToggle: (on: boolean) => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const picture = madePictures.get(item.rel);
  const Icon = ICONS[item.category];

  useEffect(() => {
    if (!item.picture || madePictures.has(item.rel) || !ref.current) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          want(item.rel);
          seen.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    seen.observe(ref.current);
    return () => seen.disconnect();
  }, [item.rel, item.picture, want]);

  return (
    <div ref={ref} data-testid="cc-card" className="cc-card" title={item.rel} data-off={item.enabled ? undefined : ""}>
      <div className="cc-picture" style={{ boxShadow: item.broken ? "inset 0 0 0 1px var(--color-danger-border)" : undefined }}>
        {picture ? (
          <img src={picture} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} draggable={false} />
        ) : (
          <Icon size={46} color="var(--color-text-muted)" strokeWidth={1.5} style={{ opacity: item.picture && picture === undefined ? 0.4 : 1 }} />
        )}
        {!item.enabled && <span className="cc-badge">Off</span>}
        {item.broken && <span className="cc-badge" style={{ background: "var(--color-danger-solid)" }}>Damaged</span>}
        <div className="cc-actions">
          <Toggle on={item.enabled} label={item.enabled ? `Turn off ${item.name}` : `Turn on ${item.name}`} disabled={busy} onChange={onToggle} />
          <IconButton tip="Show it in its folder" label={`Show ${item.name} in its folder`} onClick={onReveal} style={{ width: 30, height: 30 }}>
            <FolderOpen size={15} />
          </IconButton>
          <IconButton
            tip={confirming ? "Click again to delete it" : item.owner ? `Delete ${item.owner} (all of its files)` : "Delete this file"}
            label={`Delete ${item.name}`}
            variant={confirming ? "confirming" : ""}
            disabled={busy}
            onClick={onDelete}
            style={{ width: 30, height: 30 }}
          >
            <BinIcon size={14} />
          </IconButton>
        </div>
      </div>
      <div className="cc-name">{item.name}</div>
      <div className="cc-sub">
        {item.items > 1 ? `${item.items} items` : item.category} • {sizeText(item.size)}
      </div>
    </div>
  );
}

/* The Sims 4's custom content and script mods as pictures: what each is, turning it on or off, and deleting it. */
export default function CCBrowser({ detail, reload }: Props) {
  const [items, setItems] = useState<GameCC[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [showing, setShowing] = useState<"all" | "on" | "off">("all");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const want = usePictures();

  const load = () =>
    window.gamesAPI
      .ccList()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, [detail.id]);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await Promise.all([load(), reload()]);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(null);
  }

  const counts = useMemo(() => {
    const out: Partial<Record<Category | "all", number>> = { all: items?.length ?? 0 };
    for (const item of items ?? []) out[item.category] = (out[item.category] ?? 0) + 1;
    return out;
  }, [items]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (showing === "all" || (showing === "on") === item.enabled) &&
        words.every((word) => `${item.name} ${item.folder} ${item.owner ?? ""}`.toLowerCase().includes(word))
    );
  }, [items, query, category, showing]);

  const offCount = (items ?? []).filter((item) => !item.enabled).length;
  const totalSize = (items ?? []).reduce((sum, item) => sum + item.size, 0);
  const activeCategory = counts[category] ? category : "all";

  if (!detail.docsDir) {
    return <Notice tone="warning">The Sims 4's Documents folder hasn't been found, so its CC can't be shown. Choose it in Settings.</Notice>;
  }

  return (
    <div className="cc-page" data-testid="cc-browser">
      <header className="page-header">
        <h1 className="page-title">CC</h1>
        <p className="page-subtitle">
          {items ? `${items.length} file${items.length === 1 ? "" : "s"} • ${sizeText(totalSize)}${offCount ? ` • ${offCount} off` : ""}` : "Looking through your Mods folder..."}
        </p>
      </header>

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="cc-toolbar">
        <div className="cc-search">
          <SearchField
            label="Search your CC"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search your CC..."
          />
        </div>
        {offCount > 0 && (
          <Select value={showing} onChange={(event) => setShowing(event.target.value as "all" | "on" | "off")} aria-label="On or off">
            <option value="all">On and off</option>
            <option value="on">Only on</option>
            <option value="off">Only off</option>
          </Select>
        )}
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} aria-hidden="true" />}
          aria-label="Refresh"
          title="Look through the Mods folder again"
          disabled={busy === "refresh"}
          onClick={() => act("refresh", async () => {})}
        >
          Refresh
        </Button>
      </div>

      <div className="cc-chips" role="group" aria-label="Kind of content">
        {CATEGORIES.filter((option) => option.id === "all" || counts[option.id]).map((option) => (
          <button
            key={option.id}
            type="button"
            className="cc-chip"
            aria-pressed={activeCategory === option.id}
            onClick={() => {
              setCategory(option.id);
              setLimit(PAGE);
            }}
          >
            {option.label} <span>{counts[option.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading && !items ? (
        <div className="cc-grid" aria-busy="true" aria-label="Reading your CC (the first time takes a little while)">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="cc-card"><Skeleton shape="block" height={150} /><Skeleton lines={2} /></div>
          ))}
        </div>
      ) : !shown.length ? (
        <EmptyState title={items?.length ? "Nothing matches" : "No CC yet"} body={items?.length ? "Try a different search or kind." : "There's no CC or script mods in your Mods folder yet."} />
      ) : (
        <div className="cc-grid">
          {shown.slice(0, limit).map((item) => (
            <Card
              key={item.rel}
              item={item}
              want={want}
              busy={busy === item.key}
              confirming={confirming === item.rel}
              onToggle={(on) => act(item.key, () => window.gamesAPI.setEnabled(detail.id, item.key, on))}
              onReveal={() => window.gamesAPI.ccReveal(item.rel).catch((err) => setError(errorText(err)))}
              onDelete={() => {
                if (confirming !== item.rel) return setConfirming(item.rel);
                setConfirming(null);
                act(item.key, () => window.gamesAPI.remove(detail.id, item.key));
              }}
            />
          ))}
        </div>
      )}
      {shown.length > limit && (
        <Button style={{ alignSelf: "center" }} onClick={() => setLimit((now) => now + PAGE)}>
          Show more ({shown.length - limit} left)
        </Button>
      )}
    </div>
  );
}
