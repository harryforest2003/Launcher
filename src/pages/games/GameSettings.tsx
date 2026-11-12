import { useEffect, useState } from "react";
import Toggle from "../../components/Toggle";
import { errorText, note, panel, smallButton } from "./shared";

type Props = {
  detail: GameDetail;
  reload: () => Promise<void>;
  goLauncherSettings: () => void;
};

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: "1px solid #262626" };

/* Where the game is, The Sims 4's own mod switches, and the Nexus Mods account. */
export default function GameSettings({ detail, reload, goLauncherSettings }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ name: string; premium: boolean } | null | undefined>(undefined);

  useEffect(() => {
    if (detail.nexus) window.gamesAPI.nexusAccount().then(setAccount).catch(() => setAccount(null));
  }, [detail.nexus]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ color: "#c084fc", margin: 0 }}>{detail.name} Settings</h1>
      {error && <div style={note("bad")}>{error}</div>}

      <div style={panel}>
        <div style={{ color: "#c084fc", fontWeight: 600, marginBottom: 8 }}>Where it is</div>
        <div style={{ ...row, borderTop: "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>Game folder</div>
            <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3, wordBreak: "break-all" }} data-testid="game-folder">
              {detail.gameDir ? `${detail.gameDir} (${detail.chosen ? "chosen by you" : `found via ${detail.source}`})` : "Not found"}
            </div>
          </div>
          {detail.gameDir && (
            <button className="sidebar-button" style={smallButton} onClick={() => act(() => window.gamesAPI.openFolder(detail.id, "game"))}>
              Open
            </button>
          )}
          <button className="sidebar-button" style={smallButton} onClick={() => act(() => window.gamesAPI.chooseFolder(detail.id))}>
            Choose...
          </button>
          {detail.chosen && (
            <button className="sidebar-button" style={smallButton} onClick={() => act(() => window.gamesAPI.forgetFolder(detail.id))}>
              Find it again
            </button>
          )}
        </div>
        {detail.id === "sims4" && (
          <div style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>Documents folder</div>
              <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3, wordBreak: "break-all" }}>
                {detail.docsDir ?? "Not found"}. The Sims 4 keeps Mods, Tray and its options here.
              </div>
            </div>
            {detail.docsDir && (
              <button className="sidebar-button" style={smallButton} onClick={() => act(() => window.gamesAPI.openFolder(detail.id, "docs"))}>
                Open
              </button>
            )}
            <button className="sidebar-button" style={smallButton} onClick={() => act(() => window.gamesAPI.chooseDocs(detail.id))}>
              Choose...
            </button>
          </div>
        )}
        {detail.windowsOnly && detail.platform !== "win32" && (
          <div style={{ ...note("info"), marginTop: 8 }}>
            {detail.name} only runs on Windows. On a Mac it can be played through CrossOver or Whisky: the launcher looks for it in their bottles,
            puts mods in the bottle's copy, and starts it through CrossOver.
          </div>
        )}
      </div>

      {detail.id === "sims4" && (
        <div style={panel}>
          <div style={{ color: "#c084fc", fontWeight: 600, marginBottom: 8 }}>The Sims 4's own mod switches</div>
          {sims ? (
            <>
              <div style={{ ...row, borderTop: "none" }}>
                <div style={{ flex: 1 }}>
                  <div>Custom content and mods</div>
                  <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3 }}>When off, the game loads nothing from the Mods folder.</div>
                </div>
                <Toggle on={sims.mods} label="Custom content and mods" onChange={(on) => act(() => window.gamesAPI.setSimsOptions({ mods: on }))} />
              </div>
              <div style={row}>
                <div style={{ flex: 1 }}>
                  <div>Script mods</div>
                  <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3 }}>
                    .ts4script mods. These are the ones game updates break; Play turns them off for you after an update if you choose.
                  </div>
                </div>
                <Toggle on={sims.scripts} label="Script mods" onChange={(on) => act(() => window.gamesAPI.setSimsOptions({ scripts: on }))} />
              </div>
              <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>Changes take effect the next time the game starts; change them with the game closed.</div>
            </>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: 13 }}>The Sims 4 hasn't made its options file yet: start the game once, then these switches appear.</div>
          )}
        </div>
      )}

      {detail.nexus && (
        <div style={panel}>
          <div style={{ color: "#c084fc", fontWeight: 600, marginBottom: 8 }}>Nexus Mods</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, fontSize: 13, color: "#d4d4d8", lineHeight: 1.5 }} data-testid="nexus-account">
              {account === undefined
                ? "Checking..."
                : account
                  ? `Using ${account.name}'s key (${account.premium ? "Premium: mods install straight from Discover" : "free account: installs go through the website's Mod Manager Download button"}).`
                  : "No Nexus Mods key yet. Searching works without one; installing needs your personal API key."}
            </div>
            <button className="sidebar-button" style={smallButton} onClick={goLauncherSettings}>
              API keys
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
