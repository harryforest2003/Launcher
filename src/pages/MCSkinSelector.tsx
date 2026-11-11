import BackgroundLogo from "../components/BackgroundLogo";
import blockbenchLogo from "../assets/blockbench-logo.svg";
import IconButton from "../components/IconButton";
import { DownloadIcon, ResetIcon, SaveIcon, StarIcon } from "../components/Icons";
import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/MCSidebar";
import BlockbenchFrame from "../components/BlockbenchFrame";
import SkinFront from "../components/SkinFront";
import SkinPreview from "../components/SkinPreview";
import { usePrompt } from "../skinBuilder/ui/prompt";
import { PromptDialog } from "../skinBuilder/ui/shared";

type PlayerSearchResult = {
  username: string;
  uuid: string;
  skin: string;
  slim: boolean;
  cape?: string;
};

type Props = {
  onBack: () => void;

  goHome: () => void;
  goMinecraft: () => void;
  goDiscover: () => void;
  goLibrary: () => void;
  goSkinSelector: () => void;
  goSettings: () => void;
};

/* What the preview is showing, and where it came from. */
type Preview =
  | { source: "mine"; skin: string; label: string }
  | { source: "player"; skin: string; label: string }
  | { source: "file"; skin: string; label: string; pickedId: string }
  | { source: "saved"; skin: string; label: string; savedId: string };

/*
 * A spinning 3D view while the card is on screen, and a flat picture otherwise. A page
 * can only hold about sixteen 3D views, and a search can return more players than that.
 */
function PlayerPreview({ player }: { player: PlayerSearchResult }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      rootMargin: "120px",
    });

    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Clicks go to the card, which previews the skin, rather than the 3D view.
        pointerEvents: "none",
      }}
    >
      {onScreen ? (
        <SkinPreview skin={player.skin} slim={player.slim} size={160} height={226} fullBody still spin />
      ) : (
        <SkinFront skin={player.skin} slim={player.slim} scale={6} />
      )}
    </div>
  );
}

// The search cards' buttons: small, side by side, each a symbol with its name on hover.
const iconButton: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 34,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const TickIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const BookmarkIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ""
  );

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 10,
  marginTop: 16,
  fontSize: 13,
  lineHeight: 1.5,
};

function SkinSelector({
  onBack,
  goHome,
  goMinecraft,
  goDiscover,
  goLibrary,
  goSkinSelector,
  goSettings,
}: Props) {
  const [search, setSearch] = useState("");

  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Mojang's record of the signed-in player. Null means nobody is signed in.
  const [profile, setProfile] = useState<SkinProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [slim, setSlim] = useState(false);
  const [capeId, setCapeId] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The main area shows either search results or saved skins.
  const [view, setView] = useState<"search" | "saved">("search");
  const [saved, setSaved] = useState<SavedSkin[]>([]);
  const [blockbenchReady, setBlockbenchReady] = useState(false);
  // Set from the first click on a Blockbench button until the editor closes.
  const blockbenchOpen = useRef(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const { request: namePrompt, ask: askName } = usePrompt();

  // Resetting can't be undone, so it takes a second click.
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMine = useCallback((mine: SkinProfile | null) => {
    setProfile(mine);
    setCapeId(mine?.capes.find((cape) => cape.active)?.id ?? "");

    if (mine?.skin) {
      setPreview({ source: "mine", skin: mine.skin.url, label: "Your skin" });
      setSlim(mine.skin.slim);
    } else {
      setPreview(null);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      showMine(await window.skinAPI.profile());
      setError(null);
    } catch (err) {
      setError(message(err));
    }

    setProfileLoaded(true);
  }, [showMine]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    window.skinAPI.saved().then(setSaved).catch(() => {});
    window.blockbenchAPI
      .available()
      .then((ready) => {
        setBlockbenchReady(ready);
        // Started now, so it opens at once when a Blockbench button is pressed.
        if (ready) window.blockbenchAPI.prepare().catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) {
        setPlayers([]);
        setLoading(false);
        return;
    }

    // Guards against an older, slower search overwriting a newer one.
    let active = true;

    const timer = setTimeout(async () => {
        setLoading(true);

        try {
            const results = await window.launcherAPI.searchPlayers(search);
            if (!active) return;
            setPlayers(Array.isArray(results) ? results : []);
        } catch (err) {
            console.error("Player search failed:", err);
            if (active) setPlayers([]);
        }

        if (active) setLoading(false);
    }, 300);

    return () => {
        active = false;
        clearTimeout(timer);
    };
  }, [search]);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function run(label: string, work: () => Promise<string | null>) {
    setBusy(label);
    setError(null);
    setNotice(null);

    try {
      const done = await work();
      if (done) setNotice(done);
    } catch (err) {
      setError(message(err));
    }

    setBusy(null);
  }

  const inGameNote = "You'll see it in game the next time you join a world.";
  const signedIn = Boolean(profile);
  const activeCape = profile?.capes.find((cape) => cape.active)?.id ?? "";
  const previewCape = profile?.capes.find((cape) => cape.id === capeId)?.url ?? null;

  function previewPlayer(player: PlayerSearchResult) {
    setPreview({ source: "player", skin: player.skin, label: `${player.username}'s skin` });
    setSlim(player.slim);
    setNotice(null);
  }

  function applyPlayer(player: PlayerSearchResult) {
    run(`apply-${player.uuid}`, async () => {
      showMine(await window.skinAPI.applyUrl(player.skin, player.slim));
      return `Your skin is now ${player.username}'s. ${inGameNote}`;
    });
  }

  function downloadSkin(url: string, name: string) {
    run(`download-${url}`, async () => {
      const saved = await window.skinAPI.download(url, name);
      return saved ? `Saved to ${saved}` : null;
    });
  }

  function uploadSkin() {
    run("upload", async () => {
      const picked = await window.skinAPI.pickFile();
      if (!picked) return null;

      setPreview({ source: "file", skin: picked.dataUrl, label: picked.name, pickedId: picked.id });
      setView("search");
      return `Previewing ${picked.name}. Choose the arm model, then Save Changes to make it your skin.`;
    });
  }

  function saveChanges() {
    run("save", async () => {
      if (!profile || !preview) return null;

      let latest = profile;
      const changes: string[] = [];

      if (preview.source === "file") {
        latest = await window.skinAPI.upload(preview.pickedId, slim);
        changes.push("skin");
      } else if (preview.source === "saved") {
        latest = await window.skinAPI.useSaved(preview.savedId, slim);
        changes.push("skin");
      } else if (preview.source === "player") {
        latest = await window.skinAPI.applyUrl(preview.skin, slim);
        changes.push("skin");
      } else if (profile.skin && slim !== profile.skin.slim) {
        latest = await window.skinAPI.applyUrl(profile.skin.url, slim);
        changes.push("arm model");
      }

      if (capeId !== activeCape) {
        latest = await window.skinAPI.setCape(capeId || null);
        changes.push(capeId ? "cape" : "cape (now hidden)");
      }

      showMine(latest);

      return changes.length
        ? `Saved your ${changes.join(" and ")}. ${inGameNote}`
        : "Nothing has changed since your last save.";
    });
  }

  async function saveToMySkins(source: Preview, suggested: string, armsSlim = slim) {
    const name = await askName("Name this skin", suggested);
    if (!name) return;

    run("keep", async () => {
      setSaved(
        await window.skinAPI.save({
          name,
          slim: armsSlim,
          url: source.source === "mine" || source.source === "player" ? source.skin : undefined,
          pickedId: source.source === "file" ? source.pickedId : undefined,
          savedId: source.source === "saved" ? source.savedId : undefined,
        })
      );
      return `Saved "${name}". It's in Favourites whenever you want it back.`;
    });
  }

  function saveMyCurrentSkin() {
    if (!profile?.skin) return;

    const today = new Date().toLocaleDateString();
    const mine: Preview = { source: "mine", skin: profile.skin.url, label: "Your skin" };

    setSlim(profile.skin.slim);
    saveToMySkins(mine, `My skin, ${today}`);
  }

  function editInBlockbench(target: Preview | null = preview, armsSlim = slim) {
    // A quick second click mustn't open another editor and take down this one's bar.
    if (!target || blockbenchOpen.current) return;
    blockbenchOpen.current = true;

    const name = target.source === "mine" ? profile?.name ?? "My skin" : target.label.replace(/'s skin$/, "");

    // The editor shows what it's editing, so the preview has to be it.
    setPreview(target);
    setSlim(armsSlim);

    run("blockbench", async () => {
      try {
        // Saves go into Saved skins: over this one if it's from there, or as a copy.
        const kept = await window.blockbenchAPI.editSkin(
          target.skin,
          armsSlim,
          name,
          target.source === "saved" ? target.savedId : undefined
        );
        if (!kept) return null;

        setSaved(await window.skinAPI.saved());
        setPreview({ source: "saved", skin: kept.dataUrl, label: kept.name, savedId: kept.id });
        setSlim(kept.slim);
        setView("saved");
        return kept.updated
          ? `Updated "${kept.name}" in your saved skins. Save Changes to use it in game.`
          : `Saved your edit as "${kept.name}" in your saved skins. Save Changes to use it in game.`;
      } finally {
        blockbenchOpen.current = false;
      }
    });
  }

  // Going elsewhere while Blockbench is open closes it first, which asks about unsaved work.
  const leaving = (go: () => void) => async () => {
    if (busy === "blockbench" && !(await window.blockbenchAPI.close())) return;
    go();
  };

  function previewSaved(entry: SavedSkin) {
    setPreview({ source: "saved", skin: entry.dataUrl, label: entry.name, savedId: entry.id });
    setSlim(entry.slim);
    setNotice(null);
  }

  function applySavedSkin(entry: SavedSkin) {
    run(`use-${entry.id}`, async () => {
      showMine(await window.skinAPI.useSaved(entry.id, entry.slim));
      return `Your skin is now "${entry.name}". ${inGameNote}`;
    });
  }

  function deleteSavedSkin(entry: SavedSkin) {
    if (confirmingDelete !== entry.id) {
      setConfirmingDelete(entry.id);
      return;
    }

    setConfirmingDelete(null);

    run(`delete-${entry.id}`, async () => {
      setSaved(await window.skinAPI.deleteSaved(entry.id));
      return null;
    });
  }

  function resetToDefault() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      resetTimer.current = setTimeout(() => setConfirmingReset(false), 4000);
      return;
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    setConfirmingReset(false);

    run("reset", async () => {
      showMine(await window.skinAPI.reset());
      return `Your skin is back to the default. ${inGameNote}`;
    });
  }

  const unsaved =
    signedIn &&
    preview &&
    (preview.source !== "mine" || slim !== profile?.skin?.slim || capeId !== activeCape);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#0d0d0d",
        color: "white",
        fontFamily: "'Orbitron', sans-serif",
      }}
    >
      <Sidebar
        currentPage="skins"
        goHome={leaving(goHome)}
        goMinecraft={leaving(goMinecraft)}
        goDiscover={leaving(goDiscover)}
        goLibrary={leaving(goLibrary)}
        goSkinSelector={leaving(goSkinSelector)}
        goSettings={leaving(goSettings)}
        showBack
        onBack={leaving(onBack)}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {busy === "blockbench" && preview && <BlockbenchFrame title={`Editing ${preview.label}`} />}

        {/* Main Content, with the logo centred behind it and staying put while it scrolls */}
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex" }}>
        <BackgroundLogo />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "35px",
            overflowY: "auto",
            position: "relative",
          }}
        >
          <div style={{ position: "relative", zIndex: 1 }}>
            <h1
              style={{
                color: "#c084fc",
                lineHeight: 1,
                marginBottom: "10px",
              }}
            >
              Minecraft Skin Selector
            </h1>

            <p
              style={{
                color: "#9ca3af",
                marginBottom: "30px",
              }}
            >
              Upload, preview and manage your Minecraft skins.
            </p>

            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setView("search");
              }}
              placeholder="Search Minecraft Players..."
              style={{
                width: "100%",
                padding: "15px",
                borderRadius: "12px",
                border: "1px solid #6d28d9",
                background: "#1a1a1a",
                color: "white",
                fontSize: "16px",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <button
                className="sidebar-button"
                disabled={!!busy}
                onClick={uploadSkin}
                title="Choose a PNG to preview, then Save Changes to make it your skin"
              >
                {busy === "upload" ? "Opening..." : "Upload Skin"}
              </button>

              <button
                className="sidebar-button"
                data-testid="saved-tab"
                aria-pressed={view === "saved"}
                onClick={() => setView(view === "saved" ? "search" : "saved")}
                style={{ background: view === "saved" ? "#6d28d9" : undefined }}
              >
                Favourites ({saved.length})
              </button>

              <button
                className="sidebar-button"
                disabled={!!busy}
                onClick={() => run("refresh", async () => {
                  await loadProfile();
                  setSaved(await window.skinAPI.saved());
                  return null;
                })}
              >
                {busy === "refresh" ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {profileLoaded && !signedIn && (
              <div
                data-testid="skin-signed-out"
                style={{ ...card, background: "#2a1a05", border: "1px solid #b45309", color: "#fcd34d" }}
              >
                Sign in with Microsoft on the Minecraft page to change your skin. You can
                still search and preview skins here.
              </div>
            )}

            {error && (
              <div
                role="alert"
                data-testid="skin-error"
                style={{ ...card, background: "#2a0d0d", border: "1px solid #ef4444", color: "#fca5a5" }}
              >
                {error}
              </div>
            )}

            {notice && (
              <div
                data-testid="skin-notice"
                style={{ ...card, background: "#0d2a12", border: "1px solid #166534", color: "#86efac" }}
              >
                {notice}
              </div>
            )}

            {/* ---------- saved skins ---------- */}
            {view === "saved" && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <h2 style={{ color: "#c084fc", margin: 0, fontSize: 20 }}>Favourites</h2>

                {signedIn && profile?.skin && (
                  <button
                    className="sidebar-button"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    disabled={!!busy}
                    onClick={saveMyCurrentSkin}
                  >
                    Save my current skin
                  </button>
                )}
              </div>

              {saved.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 13 }}>
                  Nothing saved yet. Save your current skin, or any skin you preview, to
                  switch back to it later.
                </p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))",
                    gap: 14,
                  }}
                >
                  {saved.map((entry) => (
                    <div
                      key={entry.id}
                      className="game-card"
                      data-testid="saved-skin"
                      style={{ padding: 12, cursor: "pointer", textAlign: "center" }}
                      onClick={() => previewSaved(entry)}
                      title="Preview"
                    >
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                        <SkinFront skin={entry.dataUrl} slim={entry.slim} scale={4} />
                      </div>

                      <div style={{ color: "#c084fc", fontSize: 13, marginBottom: 8, wordBreak: "break-word" }}>
                        {entry.name}
                      </div>

                      <button
                        className="sidebar-button"
                        style={{ width: "100%", fontSize: 12, padding: "6px", marginBottom: 6 }}
                        disabled={!signedIn || !!busy}
                        title={signedIn ? "Make this your skin in game" : "Sign in to change your skin"}
                        onClick={(event) => {
                          event.stopPropagation();
                          applySavedSkin(entry);
                        }}
                      >
                        {busy === `use-${entry.id}` ? "Applying..." : "Use"}
                      </button>

                      <button
                        className="sidebar-button"
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "6px",
                          background: confirmingDelete === entry.id ? "#7f1d1d" : undefined,
                        }}
                        disabled={!!busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteSavedSkin(entry);
                        }}
                        onMouseLeave={() => {
                          if (confirmingDelete === entry.id) setConfirmingDelete(null);
                        }}
                      >
                        {confirmingDelete === entry.id ? "Click again to delete" : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {view === "search" && loading && (
              <p style={{ color: "#9ca3af", marginTop: 16 }}>
                Searching...
              </p>
            )}

            {view === "search" && !loading && search.trim() && players.length === 0 && (
              <p style={{ color: "#9ca3af", marginTop: 16 }}>
                No Java players found for "{search.trim()}".
              </p>
            )}

            {view === "search" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))",
                gap: "18px",
                marginTop: "30px",
              }}
            >
              {players.map((player) => (
                <div
                  key={player.uuid}
                  className="game-card"
                  data-testid="player-card"
                  style={{ cursor: "pointer" }}
                  onClick={() => previewPlayer(player)}
                >
                  <div
                    style={{
                      height: "230px",
                      background: "#252525",
                      border: "1px solid #6d28d9",
                      borderRadius: "14px",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      color: "#777",
                      marginBottom: "14px",
                      overflow: "hidden",
                    }}
                  >
                    <PlayerPreview player={player} />
                  </div>

                  <h3
                    style={{
                      color: "#c084fc",
                      marginBottom: "10px",
                    }}
                  >
                    {player.username}
                  </h3>

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="sidebar-button"
                      aria-label="Save to favourites"
                      title="Save to favourites"
                      style={iconButton}
                      disabled={!!busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        saveToMySkins(
                          { source: "player", skin: player.skin, label: `${player.username}'s skin` },
                          player.username,
                          player.slim
                        );
                      }}
                    >
                      <BookmarkIcon />
                    </button>

                    <button
                      className="sidebar-button"
                      aria-label="Apply"
                      title={signedIn ? "Apply: make this your skin in game" : "Sign in to change your skin"}
                      style={{ ...iconButton, background: "#7c3aed" }}
                      disabled={!signedIn || !!busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        applyPlayer(player);
                      }}
                    >
                      {busy === `apply-${player.uuid}` ? "…" : <TickIcon />}
                    </button>

                    <button
                      className="sidebar-button"
                      aria-label="Edit in Blockbench"
                      title="Edit in Blockbench"
                      style={iconButton}
                      disabled={!!busy || !blockbenchReady}
                      onClick={(event) => {
                        event.stopPropagation();
                        editInBlockbench(
                          { source: "player", skin: player.skin, label: `${player.username}'s skin` },
                          player.slim
                        );
                      }}
                    >
                      <img src={blockbenchLogo} alt="" style={{ width: 19, height: 19 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>
        </div>

        {/* Right Sidebar: fits the window, with the preview taking whatever height is left */}
        <div
          style={{
            width: "340px",
            borderLeft: "1px solid #6d28d9",
            background: "#161616",
            padding: "20px 22px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <h2 style={{ color: "#c084fc", margin: "0 0 14px", flexShrink: 0 }}>3D Preview</h2>

          <div
            data-testid="skin-preview-box"
            style={{
              flex: 1,
              minHeight: 220,
              background: "#232323",
              border: "1px solid #6d28d9",
              borderRadius: "18px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              color: "#777",
              overflow: "hidden",
              padding: preview ? 0 : 20,
            }}
          >
            {preview ? (
              <SkinPreview skin={preview.skin} slim={slim} cape={previewCape} fill fullBody />
            ) : (
              "Search for a player, or import a skin, to preview it"
            )}
          </div>

          <div
            data-testid={preview ? "preview-label" : undefined}
            style={{ color: "#c084fc", margin: "8px 0 14px", fontSize: 13, minHeight: 17, flexShrink: 0 }}
          >
            {preview ? `${preview.label}${unsaved ? " • not saved yet" : ""}` : ""}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: "10px 12px", flexShrink: 0, textAlign: "left" }}>
            <label htmlFor="skin-model" style={{ color: "#d8b4fe", fontSize: 14, fontWeight: 600 }}>
              Player Model
            </label>
            <select
              id="skin-model"
              className="sidebar-button"
              aria-label="Player model"
              value={slim ? "slim" : "normal"}
              disabled={!preview}
              onChange={(event) => setSlim(event.target.value === "slim")}
              style={{ width: "100%", padding: "8px 10px" }}
            >
              <option value="normal">Normal</option>
              <option value="slim">Slim</option>
            </select>

            <label htmlFor="skin-cape" style={{ color: "#d8b4fe", fontSize: 14, fontWeight: 600 }}>
              Cape
            </label>
            <select
              id="skin-cape"
              className="sidebar-button"
              aria-label="Cape"
              value={capeId}
              disabled={!signedIn}
              onChange={(event) => setCapeId(event.target.value)}
              style={{ width: "100%", padding: "8px 10px" }}
            >
              <option value="">No Cape</option>
              {profile?.capes.map((cape) => (
                <option key={cape.id} value={cape.id}>
                  {cape.name}
                </option>
              ))}
            </select>
          </div>

          {signedIn && profile?.capes.length === 0 && (
            <p style={{ color: "#6b7280", fontSize: 12, margin: "8px 0 0", flexShrink: 0 }}>
              Your account doesn't have any capes.
            </p>
          )}

          {/* What each does comes up above the cursor (HoverTips). */}
          <div data-testid="skin-actions" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 18, flexShrink: 0 }}>
            <IconButton
              testId="edit-in-blockbench"
              label="Edit in Blockbench"
              tip={
                busy === "blockbench"
                  ? "Editing in Blockbench..."
                  : !preview
                  ? "Edit in Blockbench (pick a skin first)"
                  : !blockbenchReady
                  ? "Edit in Blockbench (it's still getting ready)"
                  : "Edit in Blockbench: paint or change this skin, then save it back here"
              }
              disabled={!preview || !blockbenchReady || !!busy}
              onClick={() => editInBlockbench()}
            >
              <img src={blockbenchLogo} alt="" style={{ width: 24, height: 24 }} />
            </IconButton>

            <IconButton
              testId="save-changes"
              label="Save changes"
              variant={unsaved ? "ready" : ""}
              tip={
                busy === "save"
                  ? "Saving..."
                  : !signedIn
                  ? "Save changes (sign in with Microsoft first)"
                  : !preview
                  ? "Save changes (pick a skin first)"
                  : "Save changes: make this your skin and cape in game"
              }
              disabled={!signedIn || !preview || !!busy}
              onClick={saveChanges}
            >
              <SaveIcon size={21} />
            </IconButton>

            <IconButton
              testId="download-skin"
              label="Download this skin"
              tip={
                preview && (preview.source === "mine" || preview.source === "player")
                  ? "Download this skin"
                  : "Download this skin (your own or another player's)"
              }
              disabled={!preview || !(preview.source === "mine" || preview.source === "player") || !!busy}
              onClick={() => preview && downloadSkin(preview.skin, preview.source === "mine" ? profile?.name ?? "skin" : preview.label)}
            >
              <DownloadIcon size={21} />
            </IconButton>

            <IconButton
              testId="reset-skin"
              label="Reset to default"
              variant={confirmingReset ? "confirming" : ""}
              tip={
                busy === "reset"
                  ? "Resetting..."
                  : !signedIn
                  ? "Reset to the default skin (sign in with Microsoft first)"
                  : confirmingReset
                  ? "Click again to reset your skin"
                  : "Reset to the default skin. Mojang doesn't keep your old one, so download it first if you want it back"
              }
              disabled={!signedIn || !!busy}
              onClick={resetToDefault}
            >
              <ResetIcon size={21} />
            </IconButton>

            <IconButton
              testId="save-favourite"
              label="Save to favourites"
              variant={preview?.source === "saved" ? "on" : ""}
              tip={
                preview?.source === "saved"
                  ? "Already in your favourites"
                  : !preview
                  ? "Save to favourites (pick a skin first)"
                  : "Save to favourites"
              }
              disabled={!preview || preview.source === "saved" || !!busy}
              onClick={() =>
                preview &&
                preview.source !== "saved" &&
                saveToMySkins(
                  preview,
                  preview.source === "mine" ? `My skin, ${new Date().toLocaleDateString()}` : preview.label.replace(/'s skin$/, "")
                )
              }
            >
              <StarIcon size={21} filled={preview?.source === "saved"} />
            </IconButton>
          </div>

          <div role="status" style={{ minHeight: 17, marginTop: 10, fontSize: 12, color: confirmingReset ? "#fca5a5" : "#c4b5fd", flexShrink: 0 }}>
            {busy === "save"
              ? "Saving..."
              : busy === "blockbench"
              ? "Editing in Blockbench..."
              : busy === "reset"
              ? "Resetting..."
              : confirmingReset
              ? "Click reset again to put your skin back to the default."
              : ""}
          </div>
        </div>
      </div>

      <PromptDialog request={namePrompt} />
    </div>
  );
}

export default SkinSelector;
