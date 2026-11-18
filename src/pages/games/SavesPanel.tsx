import { useEffect, useState } from "react";
import { ArchiveRestore, FolderOpen, Save } from "lucide-react";
import Button from "../../components/ui/Button";
import IconButton from "../../components/IconButton";
import { BinIcon } from "../../components/Icons";
import { errorText, note, shortDate, sizeText } from "./shared";

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
    <section className="ui-panel set-panel" data-testid="saves-panel">
      <div className="set-panel-head">
        <div>
          <h2 className="set-panel-title">
            <Save size={18} aria-hidden="true" />
            Saves
          </h2>
          <p className="set-lead">
            Before a risky play (the first after a game update, the first after your mods change, and the first from the launcher) your saves are
            copied here, so a save loaded with a broken mod can be put back. The last 8 copies are kept.
          </p>
        </div>
      </div>

      <div className="set-switch-row">
        <div>
          <h3 className="set-row-name">Saves folder</h3>
          <p className="set-help set-path">{info === null ? "Looking..." : info.dir ?? "Not found yet: it appears once the game has saved, or choose it."}</p>
        </div>
        <div className="set-actions">
          {info?.dir && (
            <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => act("open", () => window.gamesAPI.openSaves(detail.id))}>
              Open
            </Button>
          )}
          <Button size="sm" onClick={() => act("choose", () => window.gamesAPI.chooseSaves(detail.id))}>
            Choose...
          </Button>
          {info?.dir && (
            <Button size="sm" variant="primary" data-testid="backup-now" onClick={() => act("backup", () => window.gamesAPI.backupSaves(detail.id), "Your saves are backed up.")}>
              {busy === "backup" ? "Backing up..." : "Back up now"}
            </Button>
          )}
        </div>
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
    </section>
  );
}
