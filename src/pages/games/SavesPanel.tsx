import { useEffect, useState } from "react";
import { ArchiveRestore } from "lucide-react";
import IconButton from "../../components/IconButton";
import { BinIcon } from "../../components/Icons";
import { errorText, note, panel, shortDate, sizeText, smallButton } from "./shared";

type Props = { detail: GameDetail };

const when = (iso: string) => `${shortDate(iso)}, ${new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

/*
 * The game's saves: where they are, and the copies the launcher made before risky plays
 * (and any made here), each of which can be put back.
 */
export default function SavesPanel({ detail }: Props) {
  const [info, setInfo] = useState<{ dir: string | null; backups: GameSaveBackup[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    window.gamesAPI
      .saves(detail.id)
      .then((found) => active && setInfo(found))
      .catch(() => active && setInfo({ dir: null, backups: [] }));
    return () => {
      active = false;
    };
  }, [detail.id]);

  // A second press is needed within a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function act(key: string, work: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setMessage(null);
    try {
      await work();
      if (done) setMessage({ tone: "good", text: done });
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    }
    setInfo(await window.gamesAPI.saves(detail.id).catch(() => info));
    setBusy(null);
  }

  return (
    <div style={panel} data-testid="saves-panel">
      <div style={{ color: "var(--color-accent-text)", fontWeight: 600, marginBottom: 6 }}>Saves</div>
      <div style={{ color: "var(--color-text-muted)", fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
        Before a risky play (the first after a game update, the first after your mods change, and the first from the launcher) your saves are
        copied here, so a save loaded with a broken mod can be put back. The last 8 copies are kept.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--color-border)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div>Saves folder</div>
          <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 3, wordBreak: "break-all" }}>{info === null ? "Looking..." : info.dir ?? "Not found yet: it appears once the game has saved, or choose it."}</div>
        </div>
        {info?.dir && (
          <button className="sidebar-button" style={smallButton} onClick={() => act("open", () => window.gamesAPI.openSaves(detail.id))}>
            Open
          </button>
        )}
        <button className="sidebar-button" style={smallButton} onClick={() => act("choose", () => window.gamesAPI.chooseSaves(detail.id))}>
          Choose...
        </button>
        {info?.dir && (
          <button
            className="sidebar-button"
            data-testid="backup-now"
            style={{ ...smallButton, background: "var(--color-accent)", color: "var(--color-on-accent)", borderColor: "var(--color-accent-line)" }}
            onClick={() => act("backup", () => window.gamesAPI.backupSaves(detail.id), "Your saves are backed up.")}
          >
            {busy === "backup" ? "Backing up..." : "Back up now"}
          </button>
        )}
      </div>

      {message && <div style={{ ...note(message.tone), marginTop: 8 }}>{message.text}</div>}

      {(info?.backups.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }} data-testid="backups">
          {info!.backups.map((backup) => (
            <div key={backup.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "var(--color-surface-sunken)", borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{when(backup.at)}</div>
                <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                  {backup.reason} • {backup.files} file{backup.files === 1 ? "" : "s"} • {sizeText(backup.size)}
                </div>
              </div>
              <IconButton
                tip={confirming === `restore:${backup.id}` ? "Click again to put these saves back (with the game closed)" : "Put these saves back: what's there now is backed up first"}
                label={`Restore the backup from ${when(backup.at)}`}
                variant={confirming === `restore:${backup.id}` ? "confirming" : busy === `restore:${backup.id}` ? "ready" : ""}
                onClick={() => {
                  if (confirming !== `restore:${backup.id}`) return setConfirming(`restore:${backup.id}`);
                  setConfirming(null);
                  act(`restore:${backup.id}`, () => window.gamesAPI.restoreSaves(detail.id, backup.id), `Put back the saves from ${when(backup.at)}. What was there before is backed up too.`);
                }}
              >
                <ArchiveRestore size={18} />
              </IconButton>
              <IconButton
                tip={confirming === `delete:${backup.id}` ? "Click again to delete this backup" : "Delete this backup"}
                label={`Delete the backup from ${when(backup.at)}`}
                variant={confirming === `delete:${backup.id}` ? "confirming" : ""}
                onClick={() => {
                  if (confirming !== `delete:${backup.id}`) return setConfirming(`delete:${backup.id}`);
                  setConfirming(null);
                  act(`delete:${backup.id}`, () => window.gamesAPI.deleteBackup(detail.id, backup.id));
                }}
              >
                <BinIcon size={18} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
