import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import ShareCodeBox from "../../components/ShareCodeBox";
import { Button, Notice } from "../../components/ui";
import { errorText } from "./shared";

type Shared = Awaited<ReturnType<typeof window.gamesAPI.readShareCode>>;
type Made = Awaited<ReturnType<typeof window.gamesAPI.shareCode>>;
type Outcome = { done: string[]; website: { name: string; page: string }[]; problems: string[] };

type Props = {
  detail: GameDetail;
  mode: "make" | "paste";
  onClose: () => void;
  reload: () => Promise<void>;
  /* What the pasted mods need that isn't installed, to fetch after. */
  onInstalled: (result: GameInstallResult, before?: string) => void;
};

/*
 * Sharing a game's mod list as a code, and installing from a pasted one. The code names
 * each mod by its site and ID; mods added by hand go by name only, as they can't be fetched.
 */
export default function GameSharePanel({ detail, mode, onClose, reload, onInstalled }: Props) {
  const [made, setMade] = useState<Made | null>(null);
  const [code, setCode] = useState("");
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (mode !== "make") return;
    let current = true;
    window.gamesAPI
      .shareCode(detail.id)
      .then((result) => current && setMade(result))
      .catch((err) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [mode, detail.id]);

  async function read(text: string) {
    setCode(text);
    setShared(null);
    setError(null);
    setOutcome(null);
    if (!text.trim()) return;
    try {
      setShared(await window.gamesAPI.readShareCode(detail.id, text));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function installAll() {
    if (!shared) return;
    const wanted = shared.mods.filter((mod) => !mod.installed);
    const result: Outcome = { done: [], website: [], problems: [] };
    const missing: GameRequirement[] = [];
    for (const [index, mod] of wanted.entries()) {
      setBusy(`${index + 1}/${wanted.length}`);
      try {
        const got = await window.gamesAPI.installRemote(detail.id, mod.provider as GameModProvider, mod.modId, mod.fileId, mod.name);
        if (got.viaSteam) result.website.push({ name: mod.name, page: "" });
        else if (got.needsWebsite !== undefined) result.website.push({ name: mod.name, page: got.needsWebsite ?? "" });
        else if (got.failed) result.problems.push(`${mod.name}: ${got.failed}`);
        else {
          result.done.push(got.mod?.name ?? mod.name);
          for (const entry of got.missing ?? []) if (!missing.some((m) => m.key === entry.key)) missing.push(entry);
        }
      } catch (err) {
        result.problems.push(`${mod.name}: ${errorText(err)}`);
      }
    }
    setBusy(null);
    setOutcome(result);
    setShared(null);
    setCode("");
    await reload();
    if (missing.length) onInstalled({ missing }, `Installed ${result.done.length} of ${wanted.length} shared mods.`);
  }

  const toGet = shared?.mods.filter((mod) => !mod.installed) ?? [];

  return (
    <section className="gm-downloads" data-testid="share-panel">
      <div className="gm-downloads__head">
        <div className="gm-downloads__title">{mode === "make" ? "Share this mod list" : "Install a shared mod list"}</div>
        <Button size="sm" variant="ghost" className="gm-iconbtn" aria-label="Close" icon={<X size={16} aria-hidden="true" />} onClick={onClose} />
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {mode === "make" &&
        (made ? (
          <ShareCodeBox
            code={made.code}
            note={
              `${made.linked} turned-on mod${made.linked === 1 ? "" : "s"} from mod sites.` +
              (made.missing.length ? ` Added by hand, so only their names go along: ${made.missing.join(", ")}.` : "") +
              ` Paste it on ${detail.name}'s Mods page, under More actions, Install a shared list.`
            }
          />
        ) : (
          !error && <p className="gm-downloads__hint">Making the code...</p>
        ))}

      {mode === "paste" && (
        <>
          <p className="gm-downloads__hint">Paste a code from Share this mod list. Nothing installs until you press Install.</p>
          <textarea
            data-testid="game-share-input"
            className="ui-input ui-input--mono"
            aria-label="Shared mod list code"
            placeholder="unity1:..."
            rows={3}
            value={code}
            disabled={Boolean(busy)}
            onChange={(e) => void read(e.target.value)}
            style={{ width: "100%", padding: "var(--space-2) var(--space-3)", fontSize: 12, resize: "vertical" }}
          />
          {shared && (
            <div style={{ marginTop: "var(--space-3)" }} data-testid="game-share-preview">
              <div className="gm-downloads__list">
                {shared.mods.map((mod) => (
                  <div key={`${mod.provider}:${mod.modId}`} style={{ display: "flex", gap: 8, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{mod.name}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>{mod.installed ? "Installed" : mod.provider}</span>
                  </div>
                ))}
              </div>
              {shared.missing.length > 0 && (
                <p className="gm-downloads__hint" style={{ marginTop: "var(--space-2)" }}>
                  Added by hand, so ask whoever shared it: {shared.missing.join(", ")}.
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
                <Button size="sm" variant="primary" data-testid="game-share-install" disabled={!toGet.length || Boolean(busy)} onClick={() => void installAll()}>
                  {busy ? `Installing ${busy}...` : toGet.length ? `Install ${toGet.length}` : "All installed already"}
                </Button>
              </div>
            </div>
          )}
          {outcome && (
            <Notice tone={outcome.problems.length ? (outcome.done.length ? "warning" : "danger") : "success"} data-testid="game-share-outcome">
              Installed {outcome.done.length} mod{outcome.done.length === 1 ? "" : "s"}.
              {outcome.problems.map((line) => (
                <div key={line} className="gm-notice-note">
                  • {line}
                </div>
              ))}
              {outcome.website.length > 0 && (
                <>
                  <div className="gm-notice-note">These need a step on their own page (Steam Workshop ones are open in Steam):</div>
                  {outcome.website.map((entry) => (
                    <div key={entry.name} className="gm-notice-note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      • {entry.name}
                      {entry.page && (
                        <Button size="sm" variant="ghost" icon={<ExternalLink size={13} aria-hidden="true" />} onClick={() => void window.gamesAPI.openUrl(entry.page)}>
                          Open
                        </Button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </Notice>
          )}
        </>
      )}
    </section>
  );
}
