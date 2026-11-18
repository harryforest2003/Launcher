import "./skins.css";
import Button from "../components/ui/Button";
import Notice from "../components/ui/Notice";
import SearchField from "../components/ui/SearchField";
import blockbenchLogo from "../assets/blockbench-logo.svg";
import IconButton from "../components/IconButton";
import { BinIcon, DownloadIcon, ResetIcon, SaveIcon, StarIcon } from "../components/Icons";
import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/MCSidebar";
import BlockbenchFrame from "../components/BlockbenchFrame";
import SkinFront from "../components/SkinFront";
import SkinPreview from "../components/SkinPreview";
import { usePrompt } from "../skinBuilder/ui/prompt";
import { PromptDialog } from "../skinBuilder/ui/shared";
import { DEFAULT_SKINS } from "./defaultSkins";

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

// Shown until a real skin is picked, so the preview is never an empty box.
const FIRST_DEFAULT = DEFAULT_SKINS[0];
const defaultPreview = (): Preview => ({ source: "player", skin: FIRST_DEFAULT.skin, label: `${FIRST_DEFAULT.name}'s skin` });

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
// A player card's icon buttons share its width.
const cardButton: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  width: "auto",
  height: 34,
  borderRadius: 10,
};

type RecentSkin = { name: string; skin: string; slim: boolean };
const RECENT_KEY = "unity.skins.recent";

function loadRecent(): RecentSkin[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.skin === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ""
  );

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const ShirtIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.4 7.6 16 4a4 4 0 0 1-8 0L3.6 7.6l2 3.4L8 10v10h8V10l2.4 1z" />
  </svg>
);

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

  const [preview, setPreview] = useState<Preview | null>(defaultPreview);
  const [slim, setSlim] = useState(false);
  const [capeId, setCapeId] = useState("");

  const [recent, setRecent] = useState<RecentSkin[]>(loadRecent);

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
  const [why, setWhyNow] = useState<string | null>(null);
  const whyTimer = useRef(0);
  const setWhy = (text: string) => {
    setWhyNow(text);
    window.clearTimeout(whyTimer.current);
    whyTimer.current = window.setTimeout(() => setWhyNow(null), 4000);
  };
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMine = useCallback((mine: SkinProfile | null) => {
    setProfile(mine);
    setCapeId(mine?.capes.find((cape) => cape.active)?.id ?? "");

    if (mine?.skin) {
      setPreview({ source: "mine", skin: mine.skin.url, label: "Your skin" });
      setSlim(mine.skin.slim);
    } else {
      setPreview(defaultPreview());
      setSlim(FIRST_DEFAULT.slim);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Guards against an older, slower search overwriting a newer one.
    let active = true;

    const timer = setTimeout(async () => {
        if (!search.trim()) {
            setPlayers([]);
            setLoading(false);
            return;
        }

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

  function rememberRecent(entry: RecentSkin) {
    const next = [entry, ...recent.filter((old) => old.skin !== entry.skin)].slice(0, 6);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage is blocked; the list just isn't kept.
    }
  }

  function previewPlayer(player: PlayerSearchResult) {
    // Skins found by searching are remembered, so they're easy to get back to.
    if (!DEFAULT_SKINS.some((entry) => entry.id === player.uuid)) {
      rememberRecent({ name: player.username, skin: player.skin, slim: player.slim });
    }

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

  // The sidebar's buttons: whether each can be used now, and what its tip says (why not, if not).
  const wait = "Wait for the current change to finish";
  const canBlockbench = Boolean(preview) && blockbenchReady && !busy;
  const canSave = signedIn && Boolean(preview) && !busy;
  const canDownload = Boolean(preview && (preview.source === "mine" || preview.source === "player")) && !busy;
  const canReset = signedIn && !busy;
  const canFavourite = Boolean(preview) && preview?.source !== "saved" && !busy;
  const tips = {
    blockbench:
      busy === "blockbench"
        ? "Editing in Blockbench..."
        : busy
        ? wait
        : !preview
        ? "Edit in Blockbench (pick a skin first)"
        : !blockbenchReady
        ? "Edit in Blockbench (it's still getting ready)"
        : "Edit in Blockbench: paint or change this skin, then save it back here",
    save:
      busy === "save"
        ? "Saving..."
        : busy
        ? wait
        : !signedIn
        ? "Save changes (sign in with Microsoft on the Minecraft page first)"
        : !preview
        ? "Save changes (pick a skin first)"
        : "Save changes: make this your skin and cape in game",
    download: busy
      ? wait
      : canDownload
      ? "Download this skin"
      : "Download this skin (works for your own skin or another player's)",
    reset:
      busy === "reset"
        ? "Resetting..."
        : busy
        ? wait
        : !signedIn
        ? "Reset to the default skin (sign in with Microsoft on the Minecraft page first)"
        : confirmingReset
        ? "Click again to reset your skin"
        : "Reset to the default skin. Mojang doesn't keep your old one, so download it first if you want it back",
    favourite: busy
      ? wait
      : preview?.source === "saved"
      ? "Already in your favourites"
      : !preview
      ? "Save to favourites (pick a skin first)"
      : "Save to favourites",
  };

  const unsaved =
    signedIn &&
    preview &&
    (preview.source !== "mine" || slim !== profile?.skin?.slim || capeId !== activeCape);

  const toolTip = (tip: string, enabled: boolean) => ({
    "data-tip": tip,
    "aria-disabled": !enabled || undefined,
  });

  const addTile = (primary: boolean) => (
    <button
      type="button"
      className={`sk-tile sk-tile--add${primary ? " sk-tile--upload" : ""}`}
      data-testid={primary ? "upload-skin" : undefined}
      disabled={!!busy}
      onClick={uploadSkin}
      title="Choose a PNG to preview, then Save Changes to make it your skin"
    >
      <span className="sk-tile__plus"><PlusIcon /></span>
      <strong>{busy === "upload" ? "Opening..." : primary ? "Upload skin" : "Add skin"}</strong>
      <small>PNG file</small>
    </button>
  );

  const savedCard = (entry: SavedSkin, testId: string) => (
    <div
      key={entry.id}
      className={`sk-tile${preview?.source === "saved" && preview.savedId === entry.id ? " is-selected" : ""}`}
      data-testid={testId}
      onClick={() => previewSaved(entry)}
      title="Preview"
    >
      <div className="sk-tile__art">
        <SkinFront skin={entry.dataUrl} slim={entry.slim} scale={3} />
      </div>
      <div className="sk-tile__name">{entry.name}</div>
      <div className="sk-tile__row">
        <Button
          size="sm"
          variant="primary"
          // Looks like the others even when it can't be used yet; hovering says why.
          aria-disabled={!signedIn || !!busy || undefined}
          data-tip={
            !signedIn
              ? "Sign in with Microsoft on the Minecraft page to use this skin"
              : busy
              ? "Wait for the current change to finish"
              : "Make this your skin in game"
          }
          onClick={(event) => {
            event.stopPropagation();
            if (signedIn && !busy) applySavedSkin(entry);
          }}
        >
          {busy === `use-${entry.id}` ? "..." : "Use"}
        </Button>
        <Button
          size="sm"
          variant={confirmingDelete === entry.id ? "danger" : "ghost"}
          disabled={!!busy}
          aria-label={confirmingDelete === entry.id ? `Click again to delete ${entry.name}` : `Delete ${entry.name}`}
          title={confirmingDelete === entry.id ? "Click again to delete" : "Delete"}
          onClick={(event) => {
            event.stopPropagation();
            deleteSavedSkin(entry);
          }}
          onMouseLeave={() => {
            if (confirmingDelete === entry.id) setConfirmingDelete(null);
          }}
        >
          {confirmingDelete === entry.id ? "Sure?" : <BinIcon size={15} />}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="sk-page">
      <Sidebar
        currentPage="skins"
        goHome={goHome}
        goMinecraft={goMinecraft}
        goDiscover={goDiscover}
        goLibrary={goLibrary}
        goSkinSelector={goSkinSelector}
        goSettings={goSettings}
        showBack
        onBack={onBack}
      />

      <div className="sk-shell">
        {busy === "blockbench" && preview && <BlockbenchFrame title={`Editing ${preview.label}`} />}

        {/* Left: the big 3D preview, with the one main action under it */}
        <aside className="sk-stage" aria-label="Skin preview">
          <div className="sk-stage__box" data-testid="skin-preview-box" title="Drag to rotate">
            {preview ? (
              <SkinPreview skin={preview.skin} slim={slim} cape={previewCape} fill fullBody />
            ) : (
              <div className="sk-stage__empty">
                <ShirtIcon />
                <p>Pick a skin, search for a player or add your own to preview it here.</p>
              </div>
            )}
          </div>

          <div className="sk-stage__label" data-testid={preview ? "preview-label" : undefined}>
            {preview ? preview.label : "No skin picked"}
            {unsaved && <span className="sk-stage__unsaved">Not saved yet</span>}
          </div>

          <Button
            variant="primary"
            size="lg"
            className="sk-stage__edit"
            data-testid="edit-in-blockbench"
            aria-label="Edit in Blockbench"
            icon={<img src={blockbenchLogo} alt="" width={18} height={18} />}
            {...toolTip(tips.blockbench, canBlockbench)}
            onClick={() => (canBlockbench ? editInBlockbench() : setWhy(tips.blockbench))}
          >
            Edit skin
          </Button>

          <div className="sk-stage__fields">
            <div>
              <label htmlFor="skin-model">Player model</label>
              <select
                id="skin-model"
                className="sidebar-button"
                aria-label="Player model"
                value={slim ? "slim" : "normal"}
                disabled={!preview}
                onChange={(event) => setSlim(event.target.value === "slim")}
              >
                <option value="normal">Normal</option>
                <option value="slim">Slim</option>
              </select>
            </div>
            <div>
              <label htmlFor="skin-cape">Cape</label>
              <select
                id="skin-cape"
                className="sidebar-button"
                aria-label="Cape"
                title={signedIn && profile?.capes.length === 0 ? "Your account doesn't have any capes." : undefined}
                value={capeId}
                disabled={!signedIn}
                onChange={(event) => setCapeId(event.target.value)}
              >
                <option value="">No Cape</option>
                {profile?.capes.map((cape) => (
                  <option key={cape.id} value={cape.id}>
                    {cape.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* What each does, or why it can't yet, comes up on hover (HoverTips). */}
          <div data-testid="skin-actions" className="sk-stage__actions">
            <IconButton testId="save-changes" label="Save changes" variant={unsaved ? "ready" : ""} tip={tips.save} disabled={!canSave} onUnavailable={() => setWhy(tips.save)} onClick={saveChanges}>
              <SaveIcon size={20} />
            </IconButton>

            <IconButton
              testId="download-skin"
              label="Download this skin"
              tip={tips.download}
              disabled={!canDownload}
              onUnavailable={() => setWhy(tips.download)}
              onClick={() => preview && downloadSkin(preview.skin, preview.source === "mine" ? profile?.name ?? "skin" : preview.label)}
            >
              <DownloadIcon size={20} />
            </IconButton>

            <IconButton testId="reset-skin" label="Reset to default" variant={confirmingReset ? "confirming" : ""} tip={tips.reset} disabled={!canReset} onUnavailable={() => setWhy(tips.reset)} onClick={resetToDefault}>
              <ResetIcon size={20} />
            </IconButton>

            <IconButton
              testId="save-favourite"
              label="Save to favourites"
              variant={preview?.source === "saved" ? "on" : ""}
              tip={tips.favourite}
              disabled={!canFavourite}
              onUnavailable={() => setWhy(tips.favourite)}
              onClick={() =>
                preview &&
                preview.source !== "saved" &&
                saveToMySkins(
                  preview,
                  preview.source === "mine" ? `My skin, ${new Date().toLocaleDateString()}` : preview.label.replace(/'s skin$/, "")
                )
              }
            >
              <StarIcon size={20} filled={preview?.source === "saved"} />
            </IconButton>
          </div>

          <div role="status" className={`sk-stage__status${confirmingReset ? " is-danger" : ""}`}>
            {busy === "save"
              ? "Saving..."
              : busy === "blockbench"
              ? "Editing in Blockbench..."
              : busy === "reset"
              ? "Resetting..."
              : confirmingReset
              ? "Click reset again to put your skin back to the default."
              : why ?? ""}
          </div>
        </aside>

        {/* Right: search, then saved skins or search results as a tile grid */}
        <main className="sk-main">
          <header className="sk-head">
            <div>
              <h1 className="sk-title">Skin selector</h1>
              <p className="sk-sub">Preview, save and wear your skins.</p>
            </div>
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => run("refresh", async () => {
              await loadProfile();
              setSaved(await window.skinAPI.saved());
              return null;
            })}>
              {busy === "refresh" ? "Refreshing..." : "Refresh"}
            </Button>
          </header>

          <div className="sk-toolbar">
            <SearchField
              label="Search Minecraft players"
              wrapperClassName="sk-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setView("search");
              }}
              placeholder="Search Minecraft players..."
            />

            <div className="sk-tabs" role="group" aria-label="Skins shown">
              <Button
                variant="secondary"
                className={view === "search" ? "is-on" : ""}
                aria-pressed={view === "search"}
                onClick={() => setView("search")}
              >
                Players
              </Button>
              <Button
                variant="secondary"
                data-testid="saved-tab"
                className={view === "saved" ? "is-on" : ""}
                aria-pressed={view === "saved"}
                onClick={() => setView(view === "saved" ? "search" : "saved")}
              >
                Favourites ({saved.length})
              </Button>
            </div>
          </div>

          {profileLoaded && !signedIn && (
            <p className="sk-hint" data-testid="skin-signed-out">
              Sign in with Microsoft on the Minecraft page to change your skin. You can still search and preview skins here.
            </p>
          )}
          {error && <Notice tone="danger" data-testid="skin-error">{error}</Notice>}
          {notice && <Notice tone="success" data-testid="skin-notice">{notice}</Notice>}

          {view === "saved" && (
            <section>
              <div className="sk-section-head">
                <h2>Favourites</h2>
                {signedIn && profile?.skin && (
                  <Button size="sm" disabled={!!busy} onClick={saveMyCurrentSkin}>
                    Save my current skin
                  </Button>
                )}
              </div>

              <div className="sk-grid">
                {addTile(false)}
                {saved.map((entry) => savedCard(entry, "saved-skin"))}
              </div>

              {saved.length === 0 && (
                <p className="sk-empty">
                  Nothing saved yet. Save your current skin, or any skin you preview, to switch back to it later.
                </p>
              )}
            </section>
          )}

          {view === "search" && (
            <section>
              {!search.trim() && (
                <>
                  <div className="sk-section-head">
                    <h2>Default skins</h2>
                  </div>
                  <div className="sk-grid" data-testid="default-skins">
                    {addTile(true)}

                    {DEFAULT_SKINS.map((entry) => (
                      <div
                        key={entry.id}
                        className={`sk-tile${preview?.skin === entry.skin ? " is-selected" : ""}`}
                        data-testid="default-skin"
                        tabIndex={0}
                        role="button"
                        aria-label={`Preview ${entry.name}`}
                        onClick={() => previewPlayer({ username: entry.name, uuid: entry.id, skin: entry.skin, slim: entry.slim })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            previewPlayer({ username: entry.name, uuid: entry.id, skin: entry.skin, slim: entry.slim });
                          }
                        }}
                      >
                        <div className="sk-tile__art">
                          <SkinFront skin={entry.skin} slim={entry.slim} scale={3} />
                        </div>
                        <div className="sk-tile__name">{entry.name}</div>
                      </div>
                    ))}
                  </div>

                  {recent.length > 0 && (
                    <>
                      <div className="sk-section-head">
                        <h2>Recently used</h2>
                      </div>
                      <div className="sk-grid" data-testid="recent-skins">
                        {recent.map((entry) => (
                          <div
                            key={entry.skin}
                            className={`sk-tile${preview?.skin === entry.skin ? " is-selected" : ""}`}
                            data-testid="recent-skin"
                            tabIndex={0}
                            role="button"
                            aria-label={`Preview ${entry.name}`}
                            onClick={() => previewPlayer({ username: entry.name, uuid: entry.skin, skin: entry.skin, slim: entry.slim })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                previewPlayer({ username: entry.name, uuid: entry.skin, skin: entry.skin, slim: entry.slim });
                              }
                            }}
                          >
                            <div className="sk-tile__art">
                              <SkinFront skin={entry.skin} slim={entry.slim} scale={3} />
                            </div>
                            <div className="sk-tile__name">{entry.name}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {saved.length > 0 && (
                    <>
                      <div className="sk-section-head">
                        <h2>Favourites</h2>
                      </div>
                      <div className="sk-grid" data-testid="favourite-skins">
                        {saved.map((entry) => savedCard(entry, "favourite-skin"))}
                      </div>
                    </>
                  )}
                </>
              )}

              {search.trim() && (
                <div className="sk-section-head">
                  <h2>Players</h2>
                </div>
              )}

              {loading && <p className="sk-empty">Searching...</p>}

              {!loading && search.trim() && players.length === 0 && (
                <p className="sk-empty">No Java players found for "{search.trim()}".</p>
              )}

              <div className="sk-grid sk-grid--players">
                {players.map((player) => (
                  <div
                    key={player.uuid}
                    className={`sk-tile${preview?.skin === player.skin ? " is-selected" : ""}`}
                    data-testid="player-card"
                    onClick={() => previewPlayer(player)}
                  >
                    <div className="sk-tile__art sk-tile__art--tall">
                      <PlayerPreview player={player} />
                    </div>

                    <div className="sk-tile__name">{player.username}</div>

                    <div className="sk-tile__row">
                      <IconButton
                        label="Save to favourites"
                        tip={busy ? wait : "Save to favourites"}
                        disabled={!!busy}
                        style={cardButton}
                        onClick={() =>
                          saveToMySkins(
                            { source: "player", skin: player.skin, label: `${player.username}'s skin` },
                            player.username,
                            player.slim
                          )
                        }
                      >
                        <StarIcon size={17} />
                      </IconButton>

                      <Button
                        size="sm"
                        variant="primary"
                        aria-label="Apply"
                        aria-disabled={!signedIn || !!busy || undefined}
                        data-tip={
                          busy === `apply-${player.uuid}`
                            ? "Making this your skin..."
                            : busy
                            ? wait
                            : signedIn
                            ? "Make this your skin in game"
                            : "Make this your skin in game (sign in with Microsoft on the Minecraft page first)"
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          if (signedIn && !busy) applyPlayer(player);
                        }}
                      >
                        {busy === `apply-${player.uuid}` ? "Applying..." : "Use"}
                      </Button>

                      <IconButton
                        label="Edit in Blockbench"
                        tip={busy ? wait : blockbenchReady ? "Edit in Blockbench" : "Edit in Blockbench (it's still getting ready)"}
                        disabled={!!busy || !blockbenchReady}
                        style={cardButton}
                        onClick={() =>
                          editInBlockbench(
                            { source: "player", skin: player.skin, label: `${player.username}'s skin` },
                            player.slim
                          )
                        }
                      >
                        <img src={blockbenchLogo} alt="" style={{ width: 19, height: 19 }} />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      <PromptDialog request={namePrompt} />
    </div>
  );
}

export default SkinSelector;
