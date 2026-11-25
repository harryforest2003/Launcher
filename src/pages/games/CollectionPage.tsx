import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import { Badge } from "../../components/ui";
import "../../components/modList.css";
import { countText, errorText, note, sizeText, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  slug: string;
};

const STATE: Record<GameCollection["files"][number]["installed"], { label: string; tone: "success" | "warning" | "neutral" }> = {
  same: { label: "Installed", tone: "success" },
  other: { label: "Another version", tone: "warning" },
  no: { label: "", tone: "neutral" },
};

/*
 * A Nexus Mods collection: what's in it, and installing it all through the download queue
 * (the mods already installed at the same version are left out; optional ones are up to you).
 */
export default function CollectionPage({ detail, slug }: Props) {
  const [collection, setCollection] = useState<GameCollection | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);
  const [account, setAccount] = useState<{ name: string; premium: boolean } | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .collection(detail.id, slug)
      .then((found) => {
        if (!active) return;
        setCollection(found);
        setPicked(new Set(found.files.filter((f) => !f.optional && f.installed !== "same").map((f) => f.fileId)));
      })
      .catch((err) => active && setFailed(errorText(err)));
    window.gamesAPI.nexusAccount().then((found) => active && setAccount(found)).catch(() => active && setAccount(null));
    return () => {
      active = false;
    };
  }, [detail.id, slug]);

  const description = useMemo(
    () => sanitizeHtml(marked.parse(collection?.description || collection?.summary || "", { async: false }) as string, { baseUrl: "https://www.nexusmods.com/" }),
    [collection]
  );

  if (failed) return <div style={note("bad")}>{failed}</div>;
  if (!collection || !picked) return <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>;

  const toInstall = collection.files.filter((f) => picked.has(f.fileId));
  const already = collection.files.filter((f) => f.installed === "same").length;

  async function install() {
    setMessage(null);
    try {
      const done = await window.gamesAPI.installCollection(detail.id, slug, toInstall.map((f) => f.fileId));
      setMessage({
        tone: "good",
        text: `Added ${done.added} mod${done.added === 1 ? "" : "s"} to the downloads (the panel in the corner).${
          account?.premium ? " They download one after another." : " Each opens on Nexus Mods in turn: press the download button there and the next one opens."
        }${done.external.length ? ` It also needs ${done.external.map((e) => e.name).join(", ")} from other sites (below).` : ""}`,
      });
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 20, background: "var(--color-surface)", padding: 20, borderRadius: 12, border: "1px solid var(--color-border)", alignItems: "center" }}>
        {collection.picture ? <img src={collection.picture} alt="" style={{ width: 190, height: 110, objectFit: "cover", borderRadius: 16, flexShrink: 0 }} /> : null}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{collection.name}</h1>
          <p style={{ color: "var(--color-text-muted)", marginTop: 6 }}>
            by {collection.author} • {collection.files.length} mods • {sizeText(collection.size)} • ♥ {countText(collection.endorsements)} • ↓ {countText(collection.downloads)} • revision {collection.revision}
          </p>
          <p style={{ marginTop: 10, color: "var(--color-text-secondary)" }}>{collection.summary}</p>
        </div>
      </div>

      <div style={{ ...note("info"), display: "flex", alignItems: "center", gap: 12 }} data-testid="collection-install">
        <span style={{ flex: 1 }}>
          {toInstall.length} of {collection.files.length} mods ticked{already ? ` (${already} already installed)` : ""}.{" "}
          {account?.premium
            ? "With Premium they all download by themselves."
            : account
              ? "On a free Nexus account each one opens on Nexus Mods in turn: one click on the download button there each."
              : "Add your Nexus Mods key in Settings → Mod sites to install them."}
        </span>
        <button
          className="sidebar-button"
          data-testid="collection-install-button"
          style={{ ...smallButton, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)", flexShrink: 0 }}
          onClick={() => toInstall.length && install()}
        >
          Install {toInstall.length} mod{toInstall.length === 1 ? "" : "s"}
        </button>
      </div>
      {message && <div style={note(message.tone)}>{message.text}</div>}

      {collection.external.length > 0 && (
        <div style={note("warn")}>
          It also needs, from other sites:{" "}
          {collection.external.map((e, i) => (
            <span key={e.url}>
              {i > 0 && ", "}
              <a
                href={e.url}
                onClick={(event) => {
                  event.preventDefault();
                  window.open(e.url, "_blank", "noopener");
                }}
                style={{ color: "var(--color-warning-text)" }}
              >
                {e.name}
              </a>
              {e.optional ? " (optional)" : ""}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, color: "var(--color-text-secondary)", lineHeight: 1.7, overflowX: "hidden", wordBreak: "break-word" }}>
          <div
            className="mod-description"
            onClick={(event) => {
              const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
              if (!anchor) return;
              event.preventDefault();
              window.open(anchor.href, "_blank", "noopener");
            }}
            dangerouslySetInnerHTML={{ __html: description }}
          />
          {collection.installationInfo && (
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>
              <b>Installation notes:</b> {collection.installationInfo}
            </div>
          )}
        </div>
        <div className="mlx-table" style={{ width: 380, flexShrink: 0, alignSelf: "flex-start" }} data-testid="collection-files">
          <div className="mlx-head">
            <span style={{ flex: 1 }}>
              Mods in it <span className="mlx-head__count">{collection.files.length}</span>
            </span>
            <button type="button" className="mlx-head__link" onClick={() => setPicked(new Set(collection.files.filter((f) => f.installed !== "same").map((f) => f.fileId)))}>
              Tick all
            </button>
            <button type="button" className="mlx-head__link" onClick={() => setPicked(new Set())}>
              None
            </button>
          </div>
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {collection.files.map((file) => (
              <label key={file.fileId} className="mlx-row mlx-row--pick">
                <input
                  type="checkbox"
                  className="mlx-check"
                  checked={picked.has(file.fileId)}
                  onChange={(event) =>
                    setPicked((now) => {
                      const next = new Set(now);
                      if (event.target.checked) next.add(file.fileId);
                      else next.delete(file.fileId);
                      return next;
                    })
                  }
                />
                <span className="mlx-main">
                  <span className="mlx-title">
                    <span className="mlx-name">{file.name}</span>
                    {file.version && <span className="mlx-ver">{file.version}</span>}
                  </span>
                  {file.optional && <span className="mlx-sub">Optional</span>}
                </span>
                {STATE[file.installed].label && <Badge tone={STATE[file.installed].tone}>{STATE[file.installed].label}</Badge>}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
