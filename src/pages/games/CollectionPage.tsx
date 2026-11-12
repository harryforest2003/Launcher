import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import { countText, errorText, note, sizeText, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  slug: string;
};

const STATE: Record<GameCollection["files"][number]["installed"], { label: string; colour: string }> = {
  same: { label: "Installed", colour: "#86efac" },
  other: { label: "Another version installed", colour: "#fcd34d" },
  no: { label: "", colour: "" },
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
  if (!collection || !picked) return <div style={{ color: "#9ca3af" }}>Loading...</div>;

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
      <div style={{ display: "flex", gap: 20, background: "#151515", padding: 20, borderRadius: 12, border: "1px solid #6d28d9", alignItems: "center" }}>
        {collection.picture ? <img src={collection.picture} alt="" style={{ width: 190, height: 110, objectFit: "cover", borderRadius: 16, flexShrink: 0 }} /> : null}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, color: "#c084fc", fontSize: 28 }}>{collection.name}</h1>
          <p style={{ color: "#888", marginTop: 6 }}>
            by {collection.author} • {collection.files.length} mods • {sizeText(collection.size)} • ♥ {countText(collection.endorsements)} • ↓ {countText(collection.downloads)} • revision {collection.revision}
          </p>
          <p style={{ marginTop: 10, color: "#bbb" }}>{collection.summary}</p>
        </div>
      </div>

      <div style={{ ...note("info"), display: "flex", alignItems: "center", gap: 12 }} data-testid="collection-install">
        <span style={{ flex: 1 }}>
          {toInstall.length} of {collection.files.length} mods ticked{already ? ` (${already} already installed)` : ""}.{" "}
          {account?.premium
            ? "With Premium they all download by themselves."
            : account
              ? "On a free Nexus account each one opens on Nexus Mods in turn: one click on the download button there each."
              : "Add your Nexus Mods key in Settings → API keys to install them."}
        </span>
        <button
          className="sidebar-button"
          data-testid="collection-install-button"
          style={{ ...smallButton, background: "#7c3aed", borderColor: "#a78bfa", flexShrink: 0 }}
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
                style={{ color: "#fde68a" }}
              >
                {e.name}
              </a>
              {e.optional ? " (optional)" : ""}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, color: "#ddd", lineHeight: 1.7, overflowX: "hidden", wordBreak: "break-word" }}>
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
            <div style={{ marginTop: 12, fontSize: 13, color: "#d4d4d8", whiteSpace: "pre-wrap" }}>
              <b>Installation notes:</b> {collection.installationInfo}
            </div>
          )}
        </div>
        <div style={{ width: 380, flexShrink: 0, background: "rgba(21, 21, 21, 0.85)", borderRadius: 12, padding: 14, border: "1px solid #333" }} data-testid="collection-files">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <b style={{ flex: 1 }}>Mods in it</b>
            <button
              onClick={() => setPicked(new Set(collection.files.filter((f) => f.installed !== "same").map((f) => f.fileId)))}
              style={{ background: "none", border: "none", color: "#c084fc", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
            >
              Tick all
            </button>
            <button onClick={() => setPicked(new Set())} style={{ background: "none", border: "none", color: "#c084fc", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
              None
            </button>
          </div>
          <div style={{ maxHeight: 520, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {collection.files.map((file) => (
              <label key={file.fileId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={picked.has(file.fileId)}
                  onChange={(event) =>
                    setPicked((now) => {
                      const next = new Set(now);
                      if (event.target.checked) next.add(file.fileId);
                      else next.delete(file.fileId);
                      return next;
                    })
                  }
                  style={{ width: 14, height: 14, accentColor: "#7c3aed", flexShrink: 0 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {file.name}
                  <span style={{ color: "#6b7280" }}>
                    {file.version ? ` ${file.version}` : ""}
                    {file.optional ? " • optional" : ""}
                  </span>
                </span>
                {STATE[file.installed].label && <span style={{ color: STATE[file.installed].colour, flexShrink: 0 }}>{STATE[file.installed].label}</span>}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
