import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  Compass,
  FileText,
  FolderOpen,
  House,
  LayoutGrid,
  ListOrdered,
  Loader2,
  Play,
  Plus,
  Puzzle,
  Save,
  Search,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { Badge, Button, Notice, type Tone } from "../components/ui";
import { AccountClashNotice, PlayAsMenu } from "../components/PlayAs";
import { useAccountChoice } from "../components/playAsChoice";
import type { GamePageKey, McPage } from "../components/ui/shellContext";
import { loaderName } from "./dashboard/useInstances";
import { useGameArt } from "./gameArt";
import { initials, timeAgo } from "./playedAgo";
import { errorText } from "./games/shared";
import "./library.css";

export type HomePanelTarget = { kind: "minecraft" } | { kind: "game"; id: GameId };

type Props = {
  target: HomePanelTarget;
  /** For a game: its summary from Home's list, and what its card says needs a look. */
  game?: GameSummary;
  chips?: { label: string; tone: Tone }[];
  instances: Instance[];
  reloadInstances: () => void;
  onClose: () => void;
  /** Opens a Minecraft page; `instance` opens that instance's own page in the Library. */
  onMinecraft: (page: McPage, instance?: string) => void;
  onGame: (id: GameId, page?: GamePageKey) => void;
};

const plain = (err: unknown) => errorText(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/* The drawer's banner: the game's picture, or its initials. */
function Banner({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = useGameArt([id])(id);
  return (
    <div className="hp-art" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="hp-art__mark">{initials(name)}</span>
      )}
    </div>
  );
}

function Action({ icon, label, hint, onClick, testId }: { icon: ReactNode; label: string; hint?: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="lx-action" data-testid={testId} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {hint && <span className="lx-action-hint">{hint}</span>}
    </button>
  );
}

const MC_LINKS: { page: McPage; label: string; icon: ReactNode }[] = [
  { page: "minecraft", label: "Minecraft home", icon: <House size={16} aria-hidden="true" /> },
  { page: "library", label: "Library", icon: <LayoutGrid size={16} aria-hidden="true" /> },
  { page: "discover", label: "Discover", icon: <Compass size={16} aria-hidden="true" /> },
  { page: "skins", label: "Skins", icon: <Shirt size={16} aria-hidden="true" /> },
  { page: "skinbuilder", label: "Model Builder", icon: <Box size={16} aria-hidden="true" /> },
  { page: "settings", label: "Settings", icon: <SlidersHorizontal size={16} aria-hidden="true" /> },
];

/* The same pages the sidebar lists for a game, with the same rules for which it has. */
function gameLinks(game: GameSummary): { page: GamePageKey; label: string; icon: ReactNode }[] {
  return [
    { page: "home" as const, label: `${game.name} home`, icon: <House size={16} aria-hidden="true" /> },
    { page: "mods" as const, label: "Mods", icon: <Puzzle size={16} aria-hidden="true" /> },
    { page: "discover" as const, label: "Discover", icon: <Compass size={16} aria-hidden="true" /> },
    ...(game.id === "sims4" ? [{ page: "cc" as const, label: "Custom Content (CC)", icon: <Sparkles size={16} aria-hidden="true" /> }] : []),
    ...(game.loadOrder ? [{ page: "loadorder" as const, label: "Load Order", icon: <ListOrdered size={16} aria-hidden="true" /> }] : []),
    ...(game.loadOrder === "plugins" || game.graphics ? [{ page: "tools" as const, label: "Tools", icon: <Wrench size={16} aria-hidden="true" /> }] : []),
    { page: "settings" as const, label: "Settings", icon: <SlidersHorizontal size={16} aria-hidden="true" /> },
  ];
}

/*
 * Home's right-hand drawer for one card: pick the instance or mod profile and play it from
 * the grid, open its files, or jump to any of its pages. Like the Library's drawer, it floats
 * over the page, the page behind is inert while it's open, and Escape or a click outside
 * closes it.
 */
export default function HomeGamePanel(props: Props) {
  const { target, game, onClose } = props;
  const panelRef = useRef<HTMLElement | null>(null);
  const title = target.kind === "minecraft" ? "Minecraft" : game?.name ?? "Game";

  // Modal: focus in, the rest of the page inert, focus back to the card on close.
  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;
    const behind: HTMLElement[] = [];
    Array.from(panelEl.parentElement?.children ?? []).forEach((el) => {
      if (el !== panelEl && !el.classList.contains("lx-scrim") && el instanceof HTMLElement) behind.push(el);
    });
    behind.forEach((el) => el.setAttribute("inert", ""));
    panelEl.focus({ preventScroll: true });
    const key = target.kind === "minecraft" ? "minecraft" : target.id;
    return () => {
      behind.forEach((el) => el.removeAttribute("inert"));
      document.querySelector<HTMLElement>(`[data-home-card="${key}"]`)?.focus({ preventScroll: true });
    };
  }, [target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A menu open inside the drawer closes first.
      if (document.querySelector(".ui-menu__list, [role='menu']")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const panelEl = event.currentTarget;
    const items = Array.from(
      panelEl.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return event.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelEl)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <aside
      ref={panelRef}
      className="lx-panel hp-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hp-title"
      tabIndex={-1}
      data-testid="home-panel"
      onKeyDown={trapTab}
    >
      <Button variant="ghost" size="sm" className="lx-panel-close" aria-label="Close" data-tip="Close (Esc)" icon={<X size={16} aria-hidden="true" />} onClick={onClose} />
      <Banner id={target.kind === "minecraft" ? "minecraft" : target.id} name={title} />
      {target.kind === "minecraft" ? <MinecraftBody {...props} /> : game ? <GameBody {...props} game={game} /> : null}
    </aside>
  );
}

/* ------------------------------ Minecraft ------------------------------ */

const metaOf = (instance: Instance) => {
  const played = timeAgo(instance.lastPlayed);
  return `${instance.version} · ${loaderName(instance.loader)}${instance.running ? " · Running" : played ? ` · ${played}` : ""}`;
};

type PickItem = { id: string; name: string; meta?: string };
// Stands for the game's mods as they are when it has no profiles yet.
const NO_PROFILE = "\u0000default";

/*
 * The drawer's drop-down (instances, mod profiles): one line tall until opened, so a long
 * list doesn't push Play down. With more than a few it has a search box. Up and Down move,
 * Enter picks, Escape closes the list (not the drawer).
 */
function Picker({
  items,
  chosen,
  onPick,
  labelId,
  noun,
  placeholder,
  disabled,
  testid,
  footer,
}: {
  items: PickItem[];
  chosen: string;
  onPick: (id: string) => void;
  /** The id of the visible label above it. */
  labelId: string;
  /** Plural, for the search box: "instances". */
  noun: string;
  placeholder: string;
  disabled?: boolean;
  testid: string;
  /** Buttons under the list ("New profile"); given a function that closes the list. */
  footer?: (close: () => void) => ReactNode;
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const searchable = items.length > 6;
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((item) => `${item.name} ${item.meta ?? ""}`.toLowerCase().includes(needle)) : items;
  const at = Math.min(active, Math.max(shown.length - 1, 0));
  const current = items.find((item) => item.id === chosen);

  const openList = () => {
    setQuery("");
    setActive(Math.max(0, items.findIndex((item) => item.id === chosen)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (id: string) => {
    close();
    if (id !== chosen) onPick(id);
  };

  useEffect(() => {
    if (open) (searchable ? search.current : list.current)?.focus();
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, at]);

  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // The footer's buttons keep their own keys.
    if (event.target !== search.current && event.target !== list.current) return;
    const move = (to: number) => {
      event.preventDefault();
      if (shown.length) setActive(Math.max(0, Math.min(shown.length - 1, to)));
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "PageDown") move(at + 8);
    else if (event.key === "PageUp") move(at - 8);
    else if (!searchable && event.key === "Home") move(0);
    else if (!searchable && event.key === "End") move(shown.length - 1);
    else if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault();
      if (shown[at]) pick(shown[at].id);
    }
  };

  const activeId = open && shown.length ? `${ids}-opt-${at}` : undefined;
  return (
    <div
      ref={box}
      className="hp-dd"
      data-testid={testid}
      onBlur={(event) => {
        if (open && !box.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="hp-dd__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${ids}-list` : undefined}
        aria-labelledby={`${labelId} ${ids}-value`}
        disabled={disabled}
        data-testid={`${testid}-trigger`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span className="hp-dd__value" id={`${ids}-value`}>
          <span className="hp-pick__name">{current?.name ?? placeholder}</span>
          {current?.meta && <span className="hp-pick__meta">{current.meta}</span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="hp-dd__arrow" />
      </button>
      {open && (
        <div className="hp-dd__pop" onKeyDown={onKey}>
          {searchable && (
            <label className="hp-dd__search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={search}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${ids}-list`}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                aria-label={`Search ${items.length} ${noun}`}
                placeholder={`Search ${items.length} ${noun}`}
                value={query}
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                data-testid={`${testid}-search`}
              />
            </label>
          )}
          <ul
            ref={list}
            id={`${ids}-list`}
            className="hp-dd__list"
            role="listbox"
            aria-labelledby={labelId}
            tabIndex={searchable ? -1 : 0}
            aria-activedescendant={searchable ? undefined : activeId}
            // A click picks without taking focus first (which would close the list).
            onMouseDown={(event) => event.preventDefault()}
          >
            {shown.map((item, index) => {
              const on = item.id === chosen;
              return (
                <li
                  key={item.id}
                  id={`${ids}-opt-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={on}
                  className={`hp-dd__option${index === at ? " is-active" : ""}`}
                  data-testid={`${testid}-option`}
                  onMouseMove={() => index !== at && setActive(index)}
                  onClick={() => pick(item.id)}
                >
                  <span className="hp-dd__value">
                    <span className="hp-pick__name">{item.name}</span>
                    {item.meta && <span className="hp-pick__meta">{item.meta}</span>}
                  </span>
                  {on && <Check size={15} aria-hidden="true" className="hp-dd__check" />}
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className="hp-dd__empty">Nothing matches "{query.trim()}".</p>}
          {footer && <div className="hp-dd__foot">{footer(() => setOpen(false))}</div>}
        </div>
      )}
    </div>
  );
}

function MinecraftBody({ instances, reloadInstances, onMinecraft }: Props) {
  // The last played (first in the list) until another is picked.
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = instances.find((i) => i.name === picked) ?? instances[0] ?? null;
  const [starting, setStarting] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const choice = useAccountChoice();
  const running = instances.filter((i) => i.running).length;

  async function play(name: string, accountId?: string) {
    if (starting) return;
    if (!choice.check(name, accountId)) return;
    setStarting(name);
    setMessage(null);
    try {
      await window.instanceAPI.launch(name, accountId);
      setMessage({ tone: "success", text: `${name} is starting.` });
    } catch (err) {
      if (!(await choice.explain(name, accountId))) setMessage({ tone: "danger", text: `${name} didn't start: ${plain(err)}` });
    }
    setStarting(null);
    reloadInstances();
  }

  async function stop(name: string) {
    setStopping(true);
    try {
      await window.instanceAPI.stop(name);
    } catch (err) {
      setMessage({ tone: "danger", text: plain(err) });
    }
    setStopping(false);
    reloadInstances();
  }

  return (
    <div className="lx-panel-inner">
      <div>
        <h2 id="hp-title" className="lx-panel-title">Minecraft</h2>
        <p className="lx-panel-sub">
          {instances.length === 1 ? "1 instance" : `${instances.length} instances`}
          {running ? `, ${running} running` : ""}
        </p>
      </div>

      {instances.length === 0 ? (
        <Notice tone="info">No instances yet. Make one in the Library.</Notice>
      ) : (
        <>
          <div className="hp-field">
            <span className="hp-label" id="hp-instances">Instance</span>
            {chosen && (
              <Picker
                items={instances.map((instance) => ({ id: instance.name, name: instance.name, meta: metaOf(instance) }))}
                chosen={chosen.name}
                onPick={setPicked}
                labelId="hp-instances"
                noun="instances"
                placeholder="Choose an instance"
                testid="home-panel-instances"
              />
            )}
          </div>

          {chosen && (
            <>
              <div className="lx-play-row">
                <Button
                  variant="primary"
                  size="lg"
                  data-testid="home-panel-play"
                  disabled={Boolean(starting) || chosen.running}
                  icon={starting === chosen.name ? <Loader2 size={18} className="lib-spin" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
                  onClick={() => play(chosen.name)}
                >
                  {starting === chosen.name ? "Starting..." : chosen.running ? "Running" : chosen.installed ? `Play ${chosen.name}` : "Install and play"}
                </Button>
                {!chosen.running && !starting && <PlayAsMenu choice={choice} instance={chosen.name} size="lg" onPlayAs={(id) => play(chosen.name, id)} />}
                {chosen.running && (
                  <Button variant="danger" size="lg" icon={<Square size={14} fill="currentColor" aria-hidden="true" />} disabled={stopping} onClick={() => stop(chosen.name)}>
                    Stop
                  </Button>
                )}
              </div>
              <AccountClashNotice choice={choice} instance={chosen.name} onPlayAs={(id) => play(chosen.name, id)} />
              {chosen.notes?.trim() && (
                <p className="lx-notes" data-testid="home-panel-notes" title={chosen.notes}>
                  {chosen.notes}
                </p>
              )}
              {message && <Notice tone={message.tone}>{message.text}</Notice>}
            </>
          )}
        </>
      )}

      <div className="hp-group">
        <span className="hp-label">Files</span>
        <div className="lx-actions">
          {chosen && (
            <Action
              testId="home-panel-files"
              icon={<FolderOpen size={16} aria-hidden="true" />}
              label="Show files"
              hint={chosen.name}
              onClick={() => window.instanceAPI.openFolder(chosen.name).catch((err) => setMessage({ tone: "danger", text: plain(err) }))}
            />
          )}
          {chosen && (
            <Action testId="home-panel-open-instance" icon={<ArrowUpRight size={16} aria-hidden="true" />} label="Open instance" hint="Mods, worlds, logs" onClick={() => onMinecraft("library", chosen.name)} />
          )}
        </div>
      </div>

      <nav className="hp-group" aria-label="Minecraft pages">
        <span className="hp-label">Go to</span>
        <div className="lx-actions">
          {MC_LINKS.map((link) => (
            <Action key={link.page} icon={link.icon} label={link.label} onClick={() => onMinecraft(link.page)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ------------------------------ Other games ------------------------------ */

function GameBody({ game, chips = [], onGame }: Props & { game: GameSummary }) {
  const [profiles, setProfiles] = useState<GameProfiles | null>(null);
  const [switching, setSwitching] = useState(false);
  const [launching, setLaunching] = useState(false);
  // The new profile's name while it's being typed (null: the box is closed).
  const [naming, setNaming] = useState<string | null>(null);
  // Mods that change the game's code and are older than its update: asked about before playing.
  const [risky, setRisky] = useState<GameMod[] | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success" | "warning"; text: string } | null>(null);

  useEffect(() => {
    if (!game.found) return;
    let active = true;
    window.gamesAPI
      .profiles(game.id)
      .then((found) => active && setProfiles(found))
      .catch(() => active && setProfiles(null));
    return () => {
      active = false;
    };
  }, [game.id, game.found]);

  async function switchTo(id: string) {
    setSwitching(true);
    setMessage(null);
    try {
      const result = await window.gamesAPI.switchProfile(game.id, id);
      setProfiles(result);
      const name = result.profiles.find((p) => p.id === id)?.name ?? "that profile";
      setMessage({
        tone: result.problems.length ? "warning" : "success",
        text: `Switched to ${name}${result.changed ? `: ${result.changed} mod${result.changed === 1 ? "" : "s"} moved` : ""}.${result.problems.length ? ` ${result.problems.join(" ")}` : ""}`,
      });
    } catch (err) {
      setMessage({ tone: "danger", text: plain(err) });
    }
    setSwitching(false);
  }

  // Same as the Mods page's New profile with "copy" on: a copy of the chosen one, then switched to.
  async function create(name: string) {
    setSwitching(true);
    setMessage(null);
    try {
      const made = await window.gamesAPI.saveProfile(game.id, { name, copyOf: "active" });
      if (made.created) {
        const result = await window.gamesAPI.switchProfile(game.id, made.created);
        setProfiles(result);
        const saves = result.saves.on ? " It has a copy of the saves too." : "";
        setMessage({
          tone: result.problems.length ? "warning" : "success",
          text: `Made ${name}, a copy of ${activeName}, and switched to it.${saves}${result.problems.length ? ` ${result.problems.join(" ")}` : ""}`,
        });
      } else setProfiles(made);
      setNaming(null);
    } catch (err) {
      setMessage({ tone: "danger", text: plain(err) });
    }
    setSwitching(false);
  }

  async function launch(safe: boolean) {
    setRisky(null);
    setLaunching(true);
    setMessage(null);
    try {
      const started = await window.gamesAPI.launch(game.id, { safe });
      setMessage({
        tone: started.backupError ? "warning" : "success",
        text: `Launch request sent through ${started.how}${safe ? ", with code mods off" : ""}.${started.backedUp ? " Saves backed up first." : ""}${started.backupError ? ` Saves couldn't be backed up: ${started.backupError}` : ""}`,
      });
    } catch (err) {
      setMessage({ tone: "danger", text: plain(err) });
    }
    setLaunching(false);
  }

  // Same rule as the game's own Play: ask first when it's updated under mods that change its code.
  async function onPlay() {
    if (launching) return;
    if (game.updated) {
      try {
        const mods = await window.gamesAPI.mods(game.id);
        const list = mods.filter((mod) => mod.mayNeedUpdate && mod.enabled);
        if (list.length) return setRisky(list);
      } catch {
        // Can't tell: play as usual, as the game's page would.
      }
    }
    void launch(false);
  }

  const open = (which: "game" | "docs" | "mods") => window.gamesAPI.openFolder(game.id, which).catch((err) => setMessage({ tone: "danger", text: plain(err) }));
  const played = timeAgo(game.lastPlayed);
  const list = profiles?.profiles ?? [];
  const activeName = list.find((profile) => profile.id === profiles?.active)?.name ?? "Default";
  // No profiles yet: what's in the game now shows as "Default" until one is made.
  const profileItems = list.length
    ? list.map((profile) => ({ id: profile.id, name: profile.name, meta: `${profile.keys.length} mod${profile.keys.length === 1 ? "" : "s"}` }))
    : [{ id: NO_PROFILE, name: "Default", meta: `${game.modCount} enabled mod${game.modCount === 1 ? "" : "s"}` }];

  return (
    <div className="lx-panel-inner">
      <div>
        <h2 id="hp-title" className="lx-panel-title">{game.name}</h2>
        <p className="lx-panel-sub">
          {game.found ? `${game.modCount === 1 ? "1 enabled mod" : `${game.modCount} enabled mods`}${played ? `, played ${played}` : ""}` : "Not found on this computer"}
        </p>
        {game.found && (chips.length > 0 || game.cantRun) && (
          <div className="lx-panel-badges" data-testid="home-panel-chips">
            {chips.map((chip) => (
              <Badge key={chip.label} tone={chip.tone}>
                {chip.label}
              </Badge>
            ))}
            {game.cantRun && <Badge>Can't run on this Mac</Badge>}
          </div>
        )}
      </div>

      {!game.found ? (
        <>
          <Notice tone="info">Choose where {game.name} is installed to manage its mods and play it from here.</Notice>
          <Button variant="primary" size="lg" onClick={() => onGame(game.id, "settings")}>
            Choose its folder
          </Button>
        </>
      ) : (
        <>
          <div className="hp-field">
            <span className="hp-label" id="hp-profiles">
              Mod profile
            </span>
            <Picker
              items={profileItems}
              chosen={list.length ? (profiles?.active ?? "") : NO_PROFILE}
              onPick={(id) => id !== NO_PROFILE && switchTo(id)}
              labelId="hp-profiles"
              noun="profiles"
              placeholder="Choose a profile"
              disabled={switching || launching || !profiles}
              testid="home-panel-profile"
              footer={(close) => (
                <>
                  <button
                    type="button"
                    className="hp-dd__action"
                    data-testid="home-panel-profile-new"
                    onClick={() => {
                      close();
                      setNaming("");
                    }}
                  >
                    <Plus size={15} aria-hidden="true" />
                    New profile
                  </button>
                  <button
                    type="button"
                    className="hp-dd__action"
                    onClick={() => {
                      close();
                      onGame(game.id, "mods");
                    }}
                  >
                    <SlidersHorizontal size={15} aria-hidden="true" />
                    Manage profiles
                  </button>
                </>
              )}
            />
            {naming !== null && (
              <form
                className="hp-newprofile"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (naming.trim()) void create(naming.trim());
                }}
              >
                <input
                  className="ui-input"
                  autoFocus
                  aria-label="New profile name"
                  placeholder="Name, like Survival"
                  maxLength={60}
                  value={naming}
                  disabled={switching}
                  data-testid="home-panel-profile-name"
                  onChange={(event) => setNaming(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    // Closes the name box, not the drawer.
                    event.preventDefault();
                    setNaming(null);
                  }}
                />
                <Button type="submit" size="sm" variant="primary" disabled={!naming.trim() || switching}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
                  Cancel
                </Button>
                <span className="hp-newprofile__hint">Starts as a copy of {activeName}&apos;s mods.</span>
              </form>
            )}
          </div>

          <div className="lx-play-row">
            <Button
              variant="primary"
              size="lg"
              data-testid="home-panel-play"
              disabled={launching || switching || Boolean(game.cantRun)}
              data-tip={game.cantRun ?? undefined}
              icon={launching ? <Loader2 size={18} className="lib-spin" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
              onClick={onPlay}
            >
              {launching ? "Starting..." : switching ? "Switching..." : "Play"}
            </Button>
          </div>
          {game.cantRun && <p className="lx-play-hint">{game.cantRun}</p>}

          {risky && (
            <Notice
              tone="warning"
              actions={
                <>
                  <Button size="sm" variant="secondary" onClick={() => launch(true)}>
                    Play with code mods off
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => launch(false)}>
                    Play anyway
                  </Button>
                </>
              }
            >
              {game.name} updated since you last played. {risky.length === 1 ? `${risky[0].name} changes its code and may not work yet.` : `${risky.length} mods change its code and may not work yet.`}
            </Notice>
          )}
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
        </>
      )}

      {game.found && (
        <div className="hp-group">
          <span className="hp-label">Files</span>
          <div className="lx-actions">
            <Action testId="home-panel-files" icon={<FolderOpen size={16} aria-hidden="true" />} label="Show game files" onClick={() => open("game")} />
            <Action icon={<Puzzle size={16} aria-hidden="true" />} label="Show mods folder" onClick={() => open("mods")} />
            {game.docsDir && <Action icon={<FileText size={16} aria-hidden="true" />} label="Show documents folder" onClick={() => open("docs")} />}
            <Action
              icon={<Save size={16} aria-hidden="true" />}
              label="Show saves"
              onClick={() => window.gamesAPI.openSaves(game.id).catch((err) => setMessage({ tone: "danger", text: plain(err) }))}
            />
          </div>
        </div>
      )}

      <nav className="hp-group" aria-label={`${game.name} pages`}>
        <span className="hp-label">Go to</span>
        <div className="lx-actions">
          {gameLinks(game).map((link) => (
            <Action key={link.page} icon={link.icon} label={link.label} onClick={() => onGame(game.id, link.page)} />
          ))}
        </div>
      </nav>
    </div>
  );
}
