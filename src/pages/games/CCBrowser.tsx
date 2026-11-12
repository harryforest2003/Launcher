import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, FolderOpen, Image as ImageIcon, Sofa, Shirt, Sparkles, Box } from "lucide-react";
import IconButton from "../../components/IconButton";
import Toggle from "../../components/Toggle";
import { BinIcon, RefreshIcon } from "../../components/Icons";
import { errorText, note, sizeText } from "./shared";

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
    <div ref={ref} data-testid="cc-card" className="cc-card" title={item.rel} style={{ opacity: item.enabled ? 1 : 0.55 }}>
      <div className="cc-picture" style={{ borderColor: item.broken ? "#b91c1c" : undefined }}>
        {picture ? (
          <img src={picture} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} draggable={false} />
        ) : (
          <Icon size={46} color="#8b8b99" strokeWidth={1.5} style={{ opacity: item.picture && picture === undefined ? 0.4 : 1 }} />
        )}
        {!item.enabled && <span className="cc-badge">Off</span>}
        {item.broken && <span className="cc-badge" style={{ background: "#7f1d1d" }}>Damaged</span>}
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

/* Tiles like the instance library's: a picture, its name and one line; the buttons show on hover. */
const CARD_CSS = `
.cc-card { background: #1f1f24; border: 1px solid #2c2c33; border-radius: 18px; padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 4px; min-width: 0; transition: border-color 0.15s; }
.cc-card:hover, .cc-card:focus-within { border-color: #6d28d9; }
.cc-picture { position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: #2c2c35; border: 1px solid #383842; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
.cc-name { font-weight: 700; font-size: 15px; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-sub { font-size: 13px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-badge { position: absolute; top: 8px; left: 8px; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.7); color: #e4e4e7; }
.cc-actions { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 12px; background: rgba(18, 18, 22, 0.88); opacity: 0; transform: translateY(4px); transition: opacity 0.15s, transform 0.15s; }
.cc-actions > :first-child { margin-right: auto; }
.cc-card:hover .cc-actions, .cc-card:focus-within .cc-actions { opacity: 1; transform: none; }
`;

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
    return <div style={note("warn")}>The Sims 4's Documents folder hasn't been found, so its CC can't be shown. Choose it in Settings.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="cc-browser">
      <style>{CARD_CSS}</style>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, color: "#e9d5ff" }}>CC</h2>
          <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 4 }}>
            {items ? `${items.length} file${items.length === 1 ? "" : "s"} • ${sizeText(totalSize)}${offCount ? ` • ${offCount} off` : ""}` : "Looking through your Mods folder..."}
          </div>
        </div>
        <IconButton tip="Look through the Mods folder again" label="Refresh" onClick={() => act("refresh", async () => {})}>
          <RefreshIcon size={18} />
        </IconButton>
      </div>

      {error && <div style={note("bad")}>{error}</div>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search your CC..."
          style={{ flex: "1 1 220px", padding: 12, borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9" }}
        />
        {CATEGORIES.filter((option) => option.id === "all" || counts[option.id]).map((option) => (
          <button
            key={option.id}
            className="sidebar-button"
            onClick={() => {
              setCategory(option.id);
              setLimit(PAGE);
            }}
            style={{ fontSize: 12, padding: "8px 12px", opacity: activeCategory === option.id ? 1 : 0.6, ...(activeCategory === option.id ? { background: "#6d28d9" } : {}) }}
          >
            {option.label} ({counts[option.id] ?? 0})
          </button>
        ))}
        {offCount > 0 && (
          <select
            value={showing}
            onChange={(event) => setShowing(event.target.value as "all" | "on" | "off")}
            aria-label="On or off"
            style={{ padding: "8px 10px", borderRadius: 10, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", fontSize: 12 }}
          >
            <option value="all">On and off</option>
            <option value="on">Only on</option>
            <option value="off">Only off</option>
          </select>
        )}
      </div>

      {loading && !items ? (
        <div style={{ color: "#9ca3af", display: "flex", alignItems: "center", gap: 8 }}>
          <ImageIcon size={16} /> Reading your CC (the first time takes a little while)...
        </div>
      ) : !shown.length ? (
        <div style={{ color: "#9ca3af", fontSize: 14 }}>{items?.length ? "Nothing matches." : "There's no CC or script mods in your Mods folder yet."}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 18 }}>
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
        <button className="sidebar-button" style={{ alignSelf: "center", padding: "10px 18px" }} onClick={() => setLimit((now) => now + PAGE)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}
