import { useEffect, useState } from "react";
import Toggle from "../../components/Toggle";
import { ArchiveRestore, FolderOpen, FolderSearch, KeyRound, Puzzle, Save } from "lucide-react";
import IconButton from "../../components/IconButton";
import { BinIcon } from "../../components/Icons";
import SettingsLayout, {
  SettingsHeader,
  type SettingsCategory,
} from "../../components/SettingsLayout";
import Button from "../../components/ui/Button";
import Notice from "../../components/ui/Notice";
import { errorText, shortDate, sizeText } from "./shared";

type Props = {
  detail: GameDetail;
  reload: () => Promise<void>;
  goLauncherSettings: () => void;
};

/* A folder path as a one-line, read-only value: cut in the middle, the whole path as its tooltip. */
function PathValue({ path, testId }: { path: string | null; testId?: string }) {
  if (!path) {
    return (
      <div className="set-pathvalue set-pathvalue--empty" data-testid={testId}>
        Not found
      </div>
    );
  }
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"), 0);
  const tail = path.length - cut > 28 ? path.slice(-28) : path.slice(cut);
  const head = path.slice(0, path.length - tail.length);
  return (
    <div className="set-pathvalue" title={path} data-testid={testId} aria-label={path} role="textbox" aria-readonly="true" tabIndex={0}>
      <span className="set-pathvalue-head" aria-hidden="true">{head}</span>
      <span className="set-pathvalue-tail" aria-hidden="true">{tail}</span>
    </div>
  );
}


const when = (iso: string) => `${shortDate(iso)}, ${new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

/* The game's saves: the folder, a back-up button, and the copies made before risky plays, each of which can be put back. */
function SavesRows({ detail }: { detail: GameDetail }) {
  const [info, setInfo] = useState<{ dir: string | null; backups: GameSaveBackup[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

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
      if (done) setMessage({ tone: "success", text: done });
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err) });
    }
    setInfo(await window.gamesAPI.saves(detail.id).catch(() => info));
    setBusy(null);
  }

  return (
    <div className="set-flat" data-testid="saves-panel">
      <div className="set-frow set-frow--path">
        <div className="set-frow-text">
          <h4 className="set-row-name">Saves folder</h4>
          <p className="set-help">Where the game keeps your saves.</p>
        </div>
        <div className="set-frow-ctl">
          <PathValue path={info === null ? null : info.dir} />
          {info?.dir && (
            <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => act("open", () => window.gamesAPI.openSaves(detail.id))}>
              Open
            </Button>
          )}
          <Button size="sm" onClick={() => act("choose", () => window.gamesAPI.chooseSaves(detail.id))}>
            Choose...
          </Button>
        </div>
      </div>

      {info?.dir && (
        <div className="set-frow">
          <div className="set-frow-text">
            <h4 className="set-row-name">Backups</h4>
            <p className="set-help">Made before risky plays; the last 8 are kept.</p>
          </div>
          <div className="set-frow-ctl">
            <Button size="sm" variant="primary" data-testid="backup-now" onClick={() => act("backup", () => window.gamesAPI.backupSaves(detail.id), "Your saves are backed up.")}>
              {busy === "backup" ? "Backing up..." : "Back up now"}
            </Button>
          </div>
        </div>
      )}

      {message && <p className={`set-message set-message--${message.tone}`}>{message.text}</p>}

      {(info?.backups.length ?? 0) > 0 && (
        <ul className="set-backups" data-testid="backups" aria-label="Saved copies">
          {info!.backups.map((backup) => (
            <li key={backup.id} className="set-backup">
              <span className="set-backup-when">{when(backup.at)}</span>
              <span className="set-backup-meta" title={backup.reason}>
                {backup.reason} • {backup.files} file{backup.files === 1 ? "" : "s"} • {sizeText(backup.size)}
              </span>
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
                <ArchiveRestore size={16} />
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
                <BinIcon size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Where the game is, The Sims 4's own mod switches, and the Nexus Mods account. */
export default function GameSettings({
  detail,
  reload,
  goLauncherSettings,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<
    { name: string; premium: boolean } | null | undefined
  >(undefined);
  const [adult, setAdult] = useState<GameAdultStatus | null>(null);

  useEffect(() => {
    if (!detail.nexus) return;
    window.gamesAPI
      .nexusAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
    window.gamesAPI
      .adultStatus()
      .then(setAdult)
      .catch(() => setAdult(null));
  }, [detail.nexus]);

  async function changeAdult(work: () => Promise<GameAdultStatus>) {
    setError(null);
    try {
      setAdult(await work());
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function act(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const sims = detail.simsOptions;

  const meta = [
    detail.version ? `Version ${detail.version}` : null,
    `${detail.modCount} mod${detail.modCount === 1 ? "" : "s"} installed`,
    detail.lastPlayed ? `Last played ${new Date(detail.lastPlayed).toLocaleDateString()}` : "Not played from here yet",
  ]
    .filter(Boolean)
    .join(" · ");

  const categories: SettingsCategory[] = [
    {
      id: "folders",
      label: "Folders",
      group: "Game",
      icon: <FolderSearch size={16} aria-hidden="true" />,
      content: (
        <section className="ui-panel set-panel set-flat">
          <div className="set-frow set-frow--path">
            <div className="set-frow-text">
              <h4 className="set-row-name">Game folder</h4>
              <p className="set-help">
                {detail.gameDir ? (detail.chosen ? "Chosen by you" : `Found via ${detail.source}`) : "The launcher couldn't find the game."}
              </p>
            </div>
            <div className="set-frow-ctl">
              <PathValue path={detail.gameDir} testId="game-folder" />
              {detail.gameDir && (
                <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => act(() => window.gamesAPI.openFolder(detail.id, "game"))}>
                  Open
                </Button>
              )}
              <Button size="sm" onClick={() => act(() => window.gamesAPI.chooseFolder(detail.id))}>
                Choose...
              </Button>
              {detail.chosen && (
                <Button size="sm" variant="ghost" onClick={() => act(() => window.gamesAPI.forgetFolder(detail.id))}>
                  Find it again
                </Button>
              )}
            </div>
          </div>
          {detail.id === "sims4" && (
            <div className="set-frow set-frow--path">
              <div className="set-frow-text">
                <h4 className="set-row-name">Documents folder</h4>
                <p className="set-help">Mods, Tray and options.</p>
              </div>
              <div className="set-frow-ctl">
                <PathValue path={detail.docsDir} />
                {detail.docsDir && (
                  <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => act(() => window.gamesAPI.openFolder(detail.id, "docs"))}>
                    Open
                  </Button>
                )}
                <Button size="sm" onClick={() => act(() => window.gamesAPI.chooseDocs(detail.id))}>
                  Choose...
                </Button>
              </div>
            </div>
          )}
          {detail.windowsOnly && detail.platform !== "win32" && (
            <Notice tone="info" style={{ marginTop: "var(--space-3)" }}>
              {detail.name} only runs on Windows. On a Mac it can be played through CrossOver or Whisky: the launcher looks for it in their bottles, puts mods in
              the bottle's copy, and starts it through CrossOver.
            </Notice>
          )}
        </section>
      ),
    },
    {
      id: "saves",
      label: "Saves",
      icon: <Save size={16} aria-hidden="true" />,
      content: (
        <section className="ui-panel set-panel">
          <SavesRows detail={detail} />
        </section>
      ),
    },
    ...(detail.id === "sims4"
      ? [
          {
            id: "mod-loading",
            label: "Mod loading",
            group: "Mods",
            icon: <Puzzle size={16} aria-hidden="true" />,
            content: (
              <section className="ui-panel set-panel set-flat">
                {detail.id === "sims4" && (
                  <>
                    {sims ? (
                      <>
                        <div className="set-frow">
                          <div className="set-frow-text">
                            <h4 className="set-row-name">Custom content and mods</h4>
                            <p className="set-help">When off, the game loads nothing from the Mods folder.</p>
                          </div>
                          <div className="set-frow-ctl">
                            <Toggle on={sims.mods} label="Custom content and mods" onChange={(on) => act(() => window.gamesAPI.setSimsOptions({ mods: on }))} />
                          </div>
                        </div>
                        <div className="set-frow">
                          <div className="set-frow-text">
                            <h4 className="set-row-name">Script mods</h4>
                            <p className="set-help">.ts4script mods, the ones game updates break. Change with the game closed.</p>
                          </div>
                          <div className="set-frow-ctl">
                            <Toggle on={sims.scripts} label="Script mods" onChange={(on) => act(() => window.gamesAPI.setSimsOptions({ scripts: on }))} />
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="set-help">The Sims 4 hasn't made its options file yet: start the game once, then these switches appear.</p>
                    )}
                  </>
                )}
              </section>
            ),
          },
        ]
      : []),
    ...(detail.nexus
      ? [
          {
            id: "nexus",
            label: "Nexus Mods",
            group: detail.id === "sims4" ? undefined : "Mods",
            icon: <KeyRound size={16} aria-hidden="true" />,
            content: (
              <section className="ui-panel set-panel set-flat">
                {detail.nexus && (
                  <>
                    <div className="set-frow">
                      <div className="set-frow-text">
                        <h4 className="set-row-name">API key</h4>
                        <p className="set-help" data-testid="nexus-account">
                          {account === undefined
                            ? "Checking..."
                            : account
                              ? `Using ${account.name}'s key (${account.premium ? "Premium: mods install straight from Discover" : "free account: installs go through the website's Mod Manager Download button"}).`
                              : "No key yet. Searching works without one; installing needs your personal API key."}
                        </p>
                      </div>
                      <div className="set-frow-ctl">
                        <Button size="sm" onClick={goLauncherSettings}>
                          API keys
                        </Button>
                      </div>
                    </div>
                    <div className="set-frow" data-testid="adult-setting">
                      <div className="set-frow-text">
                        <h4 className="set-row-name">Adult mods</h4>
                        <p className="set-help">
                          {!adult
                            ? "Checking..."
                            : adult.error
                              ? `Couldn't ask Nexus Mods: ${adult.error}`
                              : !adult.hasKey
                                ? "Shown only for a Nexus Mods account that's age-verified. Add your key to check yours."
                                : !adult.verified
                                  ? "Your Nexus Mods account isn't age-verified, so adult mods stay hidden. Verify it on nexusmods.com, then check again."
                                  : `Your Nexus Mods account is age-verified. Shows adult mods in Discover for every game${adult.blur ? ", with their pictures blurred as your Nexus preferences ask" : ""}.`}
                        </p>
                      </div>
                      <div className="set-frow-ctl">
                        {adult?.verified ? (
                          <Toggle on={adult.on} label="Show adult mods" onChange={(on) => changeAdult(() => window.gamesAPI.setAdult(on))} />
                        ) : adult?.hasKey ? (
                          <Button size="sm" onClick={() => changeAdult(() => window.gamesAPI.adultStatus(true))}>
                            Check again
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </section>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="set-page">
      <SettingsHeader
        title={`${detail.name} settings`}
        lead={meta}
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <SettingsLayout
        label={`${detail.name} settings categories`}
        categories={categories}
      />
    </div>
  );
}
