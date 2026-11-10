import { useCallback, useEffect, useState } from "react";
import ModManager from "./ModManager";

type Props = {
  onBack: () => void;
  onMinecraft: () => void;
};

export default function ModGames({ onBack, onMinecraft }: Props) {
  const [games, setGames] = useState<DetectedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DetectedGame | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nexusKey, setNexusKey] = useState("");
  const [hasNexusKey, setHasNexusKey] = useState(false);
  const [showKeyForm, setShowKeyForm] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);

    try {
      if (refresh) await window.modAPI.refreshGames();

      const [list, settings] = await Promise.all([
        window.modAPI.getGames(refresh ? { refresh: true } : undefined),
        window.modAPI.getSettings(),
      ]);

      setGames(list);
      setHasNexusKey(settings.hasNexusKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGames([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveKey() {
    try {
      const s = await window.modAPI.setNexusKey(nexusKey.trim() || null);
      setHasNexusKey(s.hasNexusKey);
      setNexusKey("");
      setShowKeyForm(false);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const card: React.CSSProperties = {
    background: "#151515",
    border: "1px solid #6d28d9",
    borderRadius: 12,
    padding: 16,
  };

  if (selected) {
    return (
      <div style={{ display: "flex", height: "100vh", background: "#0d0d0d", color: "white" }}>
        <ModManager game={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d0d0d",
        color: "white",
        padding: 30,
        overflowY: "auto",
      }}
    >
      <button
        className="sidebar-button"
        onClick={onBack}
        style={{ marginBottom: 20, alignSelf: "flex-start" }}
      >
        ← Back to Launcher
      </button>

      <h1 style={{ color: "#c084fc", marginBottom: 6 }}>Mod Manager</h1>

      <p style={{ color: "#9ca3af", marginBottom: 20 }}>
        Games found on this computer. Mods can be viewed, enabled and disabled
        for any of them.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button className="sidebar-button" onClick={() => load(true)}>
          Rescan for Games
        </button>

        <button
          className="sidebar-button"
          onClick={() => setShowKeyForm((v) => !v)}
        >
          {hasNexusKey ? "Nexus Key: set" : "Add Nexus API Key"}
        </button>
      </div>

      {showKeyForm && (
        <div style={{ ...card, marginBottom: 20 }}>
          <p style={{ color: "#d8b4fe", marginBottom: 10 }}>
            Nexus Mods API key
          </p>

          <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 10 }}>
            From nexusmods.com → Account Settings → API Keys. Stored outside
            this project folder. Note that Nexus has no public keyword-search
            endpoint, and only Premium accounts can download through the API.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="password"
              value={nexusKey}
              onChange={(e) => setNexusKey(e.target.value)}
              placeholder="Paste your API key"
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 10,
                background: "#1b1b1b",
                color: "white",
                border: "1px solid #6d28d9",
              }}
            />

            <button className="sidebar-button" onClick={saveKey}>
              Save
            </button>

            {hasNexusKey && (
              <button
                className="sidebar-button"
                style={{ background: "#7f1d1d" }}
                onClick={async () => {
                  await window.modAPI.setNexusKey(null);
                  setHasNexusKey(false);
                  await load(true);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            ...card,
            borderColor: "#ef4444",
            background: "#2a0d0d",
            color: "#fca5a5",
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#9ca3af" }}>Scanning for installed games...</div>
      ) : games.length === 0 ? (
        <div style={{ ...card, color: "#9ca3af", maxWidth: 700 }}>
          <p style={{ marginBottom: 10 }}>No supported games detected.</p>

          <p style={{ fontSize: 13, lineHeight: 1.7 }}>
            The scan looks through Steam libraries, Epic manifests, and the
            standard install and mod folders for The Sims 4, GTA V, Stardew
            Valley, Palworld, Terraria, Skyrim SE, Cyberpunk 2077, Baldur's
            Gate 3, Valheim and RimWorld.
            <br />
            <br />
            If a game is installed somewhere unusual, set{" "}
            <code style={{ color: "#c084fc" }}>UNITY_STEAM_ROOTS</code> to its
            Steam folder and rescan.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
            gap: 20,
          }}
        >
          {games.map((game) => (
            <div
              key={game.id}
              className="game-card"
              onClick={() =>
                game.managedByInstances ? onMinecraft() : setSelected(game)
              }
              style={{ cursor: "pointer", display: "flex", flexDirection: "column" }}
            >
              <h3 style={{ color: "#c084fc", marginBottom: 8 }}>{game.name}</h3>

              <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>
                Found via {game.source}
              </p>

              <p
                style={{
                  color: "#6b7280",
                  fontSize: 11,
                  marginBottom: 12,
                  wordBreak: "break-all",
                }}
              >
                {game.modDir ?? "No mod folder"}
              </p>

              <div style={{ marginTop: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {game.managedByInstances ? (
                  <span style={{ ...tag, background: "#6d28d9" }}>
                    Instances
                  </span>
                ) : game.availableProviders.length > 0 ? (
                  game.availableProviders.map((p) => (
                    <span
                      key={p.id}
                      style={{
                        ...tag,
                        background: p.ready ? "#166534" : "#3f3f46",
                      }}
                      title={p.ready ? "" : "Needs an API key"}
                    >
                      {p.label}
                    </span>
                  ))
                ) : (
                  <span style={{ ...tag, background: "#3f3f46" }}>
                    Local only
                  </span>
                )}

                {!game.modDirExists && !game.managedByInstances && (
                  <span style={{ ...tag, background: "#7f1d1d" }}>
                    No mods folder yet
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const tag: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  color: "white",
};
