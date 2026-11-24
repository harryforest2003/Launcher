import { useState } from "react";
import { Archive, FolderOpen, RotateCcw } from "lucide-react";
import { Badge, Button } from "./ui";
import { BinIcon } from "./Icons";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

type Shared = {
  instanceName: string;
  running: boolean;
  /** After a backup is made, put back or deleted: the worlds and backups are read again. */
  onChanged: () => void;
  onError: (text: string) => void;
};

/* One world's backups, under its row: making one, putting one back, deleting one. */
export function WorldBackupsPanel({ instanceName, folder, name, backups, running, onChanged, onError }: Shared & { folder: string; name: string; backups: WorldBackup[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  const work = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (err) {
      onError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const closeFirst = running ? "Close Minecraft first: the game keeps writing to its worlds while it's open." : undefined;

  return (
    <div className="backups" data-testid="world-backups">
      <div className="backups__head">
        <span className="backups__title">Backups of {name}</span>
        <Button size="sm" icon={<Archive size={15} />} disabled={running || !!busy} title={closeFirst} onClick={() => work("new", () => window.instanceAPI.backupWorld(instanceName, folder))}>
          {busy === "new" ? "Backing up…" : "Back up now"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<FolderOpen size={15} />}
          aria-label={`Open ${name}'s backups folder`}
          title="Open the backups folder"
          onClick={() => window.instanceAPI.openBackups(instanceName, folder).catch((err) => onError(message(err)))}
        />
      </div>
      {backups.length === 0 ? (
        <p className="worlds__muted">No backups yet. A backup is a .zip of the world, kept in the instance's backups folder.</p>
      ) : (
        <BackupList instanceName={instanceName} backups={backups} running={running} busy={busy} work={work} worldName={name} />
      )}
    </div>
  );
}

/* Backups of worlds no longer in saves, which can still be put back. */
export function DeletedWorldBackups({ instanceName, backups, running, onChanged, onError }: Shared & { backups: WorldBackup[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const worlds = [...new Set(backups.map((backup) => backup.world))];
  if (!worlds.length) return null;

  const work = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (err) {
      onError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="backups backups--deleted" aria-label="Backups of deleted worlds">
      <div className="backups__head">
        <span className="backups__title">Backups of worlds no longer here</span>
      </div>
      {worlds.map((world) => (
        <div key={world} className="backups__group">
          <div className="worlds__meta">{world}</div>
          <BackupList instanceName={instanceName} backups={backups.filter((backup) => backup.world === world)} running={running} busy={busy} work={work} worldName={world} />
        </div>
      ))}
    </section>
  );
}

function BackupList({
  instanceName,
  backups,
  running,
  busy,
  work,
  worldName,
}: {
  instanceName: string;
  backups: WorldBackup[];
  running: boolean;
  busy: string | null;
  work: (key: string, fn: () => Promise<unknown>) => void;
  worldName: string;
}) {
  return (
    <ul className="backups__list">
      {backups.map((backup) => {
        const key = `${backup.world}/${backup.file}`;
        const when = new Date(backup.createdAt).toLocaleString();
        return (
          <li key={key} className="backups__item">
            <span className="backups__when">{when}</span>
            <span className="worlds__meta worlds__meta--small">{formatBytes(backup.size)}</span>
            {backup.auto && <Badge>Before an update</Badge>}
            <span className="backups__actions">
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={15} />}
                disabled={running || !!busy}
                title={running ? "Close Minecraft first: the game keeps writing to its worlds while it's open." : `Put ${worldName} back as it was on ${when}`}
                onClick={() => {
                  if (window.confirm(`Put "${worldName}" back as it was on ${when}? The world as it is now goes to the Bin, so you can still get it back.`)) {
                    work(`restore:${key}`, () => window.instanceAPI.restoreBackup(instanceName, backup.world, backup.file));
                  }
                }}
              >
                {busy === `restore:${key}` ? "Restoring…" : "Restore"}
              </Button>
              <button
                className="bin-button"
                title={`Move the backup from ${when} to the Bin`}
                aria-label={`Move the backup from ${when} to the Bin`}
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm(`Move the backup of "${worldName}" from ${when} to the Bin?`)) {
                    work(`delete:${key}`, () => window.instanceAPI.deleteBackup(instanceName, backup.world, backup.file));
                  }
                }}
              >
                <BinIcon />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
