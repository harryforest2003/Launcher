import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Compass, CornerDownLeft, FolderOpen, House, Layers, LayoutGrid, ListOrdered, Play, Puzzle, Search, Settings, Shirt, SlidersHorizontal, Sparkles, Wrench, Zap } from "lucide-react";
import type { ShellTarget } from "./ui/AppSidebar";
import type { GamePageKey, McPage } from "./ui/shellContext";
import { requestLaunch, requestModSearch, requestOpenInstance } from "../utils/launchRequests";
import "./commandPalette.css";

/* Something the palette can do: open a page, play an instance, find a mod, run an action. */
export type PaletteCommand = {
  id: string;
  group: "Pages" | "Games" | "Minecraft instances" | "Mods" | "Actions";
  label: string;
  /** Muted text after the label: the game, a version, a shortcut. */
  hint?: string;
  /** More words that find it ("options" finds Settings). */
  keywords?: string;
  icon: ReactNode;
  run: () => void;
};

type Props = {
  onClose: () => void;
  go: (target: ShellTarget) => void;
  /** The app's own actions (fold the sidebar, full screen, controller mode). */
  actions: PaletteCommand[];
};

const LOADER_NAMES: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", "legacy-fabric": "Legacy Fabric", babric: "Babric", liteloader: "LiteLoader" };
const GROUP_ORDER: PaletteCommand["group"][] = ["Pages", "Games", "Minecraft instances", "Mods", "Actions"];
const PER_GROUP = 6;

const MC_PAGES: { page: McPage; label: string; icon: ReactNode; keywords?: string }[] = [
  { page: "minecraft", label: "Minecraft home", icon: <House size={15} /> },
  { page: "library", label: "Minecraft library", icon: <LayoutGrid size={15} />, keywords: "instances profiles" },
  { page: "discover", label: "Minecraft: Discover", icon: <Compass size={15} />, keywords: "browse mods modpacks shaders resource packs" },
  { page: "skins", label: "Minecraft: Skin selector", icon: <Shirt size={15} />, keywords: "skins capes" },
  { page: "skinbuilder", label: "Minecraft: Model Builder", icon: <Box size={15} />, keywords: "custom model data blockbench tools weapons" },
  { page: "settings", label: "Minecraft settings", icon: <SlidersHorizontal size={15} />, keywords: "java memory options" },
];

const GAME_PAGES: { page: GamePageKey; label: string; icon: ReactNode; keywords?: string; when?: (game: GameSummary) => boolean }[] = [
  { page: "mods", label: "Mods", icon: <Puzzle size={15} />, keywords: "installed" },
  { page: "discover", label: "Discover", icon: <Compass size={15} />, keywords: "browse download" },
  { page: "cc", label: "Custom Content (CC)", icon: <Sparkles size={15} />, when: (game) => game.id === "sims4" },
  { page: "loadorder", label: "Load Order", icon: <ListOrdered size={15} />, keywords: "plugins loot", when: (game) => Boolean(game.loadOrder) },
  { page: "tools", label: "Tools", icon: <Wrench size={15} />, keywords: "ini reshade enb", when: (game) => game.loadOrder === "plugins" || Boolean(game.graphics) },
  { page: "settings", label: "Settings", icon: <SlidersHorizontal size={15} />, keywords: "folder options" },
];

/* How well the words match: every word must appear; a word at the start of a word counts more. */
function scoreOf(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of words) {
    const at = lower.indexOf(word);
    if (at < 0) return -1;
    score += at === 0 ? 4 : /[^a-z0-9]/.test(lower[at - 1]) ? 2 : 1;
  }
  return score;
}

function rank(command: PaletteCommand, words: string[]): number {
  const label = scoreOf(command.label, words);
  // A shorter label wins a tie: "Skyrim" puts the game above its pages.
  if (label >= 0) return label + 10 - command.label.length / 200;
  return scoreOf(`${command.label} ${command.hint ?? ""} ${command.keywords ?? ""}`, words);
}

/*
 * Search everything from anywhere (Cmd/Ctrl+K): pages, games, Minecraft instances, installed
 * mods and the app's actions. Up and Down move, Enter opens, Escape closes.
 */
export default function CommandPalette({ onClose, go, actions }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [mods, setMods] = useState<{ game: GameSummary; mod: GameMod }[] | null>(null);

  useEffect(() => {
    const box = dialog.current;
    const before = document.activeElement as HTMLElement | null;
    if (box && !box.open) box.showModal();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.resolve(window.gamesAPI?.list?.())
      .then((list) => live && Array.isArray(list) && setGames(list))
      .catch(() => undefined);
    Promise.resolve(window.instanceAPI?.list?.())
      .then((list) => live && Array.isArray(list) && setInstances(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Installed mods are read once someone types: every found game's list, at once.
  const typed = query.trim().length >= 2;
  useEffect(() => {
    if (!typed || mods !== null || !games.length) return;
    let live = true;
    const withMods = games.filter((game) => game.found && game.modCount);
    Promise.all(withMods.map((game) => Promise.resolve(window.gamesAPI.mods(game.id)).then((list) => (list ?? []).map((mod) => ({ game, mod })), () => [])))
      .then((lists) => live && setMods(lists.flat()))
      .catch(() => live && setMods([]));
    return () => {
      live = false;
    };
  }, [typed, mods, games]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const all: PaletteCommand[] = [
      { id: "home", group: "Pages", label: "Your games", hint: "Home", keywords: "home launcher start", icon: <House size={15} />, run: () => go({ kind: "home" }) },
      { id: "more", group: "Pages", label: "More Games", keywords: "other detected", icon: <Layers size={15} />, run: () => go({ kind: "modmanager" }) },
      { id: "settings", group: "Pages", label: "Launcher settings", keywords: "options preferences theme controller", icon: <Settings size={15} />, run: () => go({ kind: "settings" }) },
      ...MC_PAGES.map(({ page, label, icon, keywords }) => ({ id: `mc:${page}`, group: "Pages" as const, label, keywords, icon, run: () => go({ kind: "mc", page }) })),
      { id: "game:minecraft", group: "Games", label: "Minecraft", hint: "Java Edition", icon: <Play size={15} />, run: () => go({ kind: "mc", page: "minecraft" }) },
    ];
    const found = [...games].sort((a, b) => Number(b.found) - Number(a.found));
    for (const game of found) {
      all.push({
        id: `game:${game.id}`,
        group: "Games",
        label: game.name,
        hint: game.found ? (game.modCount ? `${game.modCount} ${game.modCount === 1 ? "mod" : "mods"}` : "No mods yet") : "Not found",
        icon: <Play size={15} />,
        run: () => go({ kind: "game", id: game.id }),
      });
      if (!game.found) continue;
      for (const page of GAME_PAGES) {
        if (page.when && !page.when(game)) continue;
        all.push({
          id: `game:${game.id}:${page.page}`,
          group: "Pages",
          label: `${game.name}: ${page.label}`,
          keywords: page.keywords,
          icon: page.icon,
          run: () => go({ kind: "game", id: game.id, page: page.page }),
        });
      }
    }
    const recent = [...instances].sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""));
    for (const instance of recent) {
      const loader = instance.loader && instance.loader !== "vanilla" ? (LOADER_NAMES[instance.loader] ?? instance.loader) : "";
      const version = [loader, instance.version].filter(Boolean).join(" ");
      all.push({
        id: `play:${instance.name}`,
        group: "Minecraft instances",
        label: `Play ${instance.name}`,
        hint: version,
        keywords: "launch start minecraft",
        icon: <Play size={15} />,
        run: () => {
          requestLaunch(instance.name);
          go({ kind: "mc", page: "library" });
        },
      });
      all.push({
        id: `open:${instance.name}`,
        group: "Minecraft instances",
        label: `Open ${instance.name}`,
        hint: version,
        keywords: "instance profile mods worlds",
        icon: <FolderOpen size={15} />,
        run: () => {
          requestOpenInstance(instance.name);
          go({ kind: "mc", page: "library" });
        },
      });
    }
    for (const { game, mod } of mods ?? []) {
      all.push({
        id: `mod:${game.id}:${mod.key}`,
        group: "Mods",
        label: mod.name,
        hint: game.name,
        icon: <Puzzle size={15} />,
        run: () => {
          requestModSearch(game.id, mod.name);
          go({ kind: "game", id: game.id, page: "mods" });
        },
      });
    }
    return [...all, ...actions];
  }, [games, instances, mods, actions, go]);

  // Nothing typed: the main pages, the games, recent instances and the actions.
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const groups = new Map<PaletteCommand["group"], PaletteCommand[]>();
    if (!words.length) {
      const starter = commands.filter(
        (command) =>
          (command.group === "Pages" && !command.id.startsWith("game:")) ||
          command.group === "Games" ||
          command.group === "Actions" ||
          (command.group === "Minecraft instances" && command.id.startsWith("play:"))
      );
      for (const command of starter) {
        const list = groups.get(command.group) ?? [];
        if (list.length < (command.group === "Minecraft instances" ? 3 : 12)) list.push(command);
        groups.set(command.group, list);
      }
    } else {
      const scored = commands
        .map((command) => ({ command, score: rank(command, words) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.command.label.length - b.command.label.length || a.command.label.localeCompare(b.command.label));
      // The group holding the best match comes first: typing a game's name puts the game on top.
      const best = new Map<PaletteCommand["group"], number>();
      for (const { command, score } of scored) if (!best.has(command.group)) best.set(command.group, score);
      const order = [...GROUP_ORDER].sort((a, b) => (best.get(b) ?? -1) - (best.get(a) ?? -1) || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
      for (const { command } of scored) {
        const list = groups.get(command.group) ?? [];
        if (list.length < PER_GROUP) list.push(command);
        groups.set(command.group, list);
      }
      return order.filter((group) => groups.get(group)?.length).map((group) => ({ group, items: groups.get(group)! }));
    }
    return GROUP_ORDER.filter((group) => groups.get(group)?.length).map((group) => ({ group, items: groups.get(group)! }));
  }, [commands, query]);
  const flat = useMemo(() => results.flatMap((section) => section.items), [results]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const choose = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = (by: number) => {
      event.preventDefault();
      if (flat.length) setActive((current + by + flat.length) % flat.length);
    };
    if (event.key === "ArrowDown") step(1);
    else if (event.key === "ArrowUp") step(-1);
    else if (event.key === "PageDown") step(5);
    else if (event.key === "PageUp") step(-5);
    else if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[current]);
    }
  };

  // Each section's first row in the flat list the arrow keys move through.
  const starts = results.reduce<number[]>((acc, _, i) => [...acc, i ? acc[i - 1] + results[i - 1].items.length : 0], []);
  return (
    <dialog
      ref={dialog}
      className="cmdp"
      aria-label="Search the launcher"
      data-testid="command-palette"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="cmdp__box">
        <div className="cmdp__field">
          <Search size={16} aria-hidden="true" className="cmdp__glass" />
          <input
            className="cmdp__input"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? `cp-opt-${current}` : undefined}
            aria-label="Search pages, games, instances and mods"
            placeholder="Search pages, games, instances and mods"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            data-testid="command-input"
          />
          <kbd className="cmdp__kbd">Esc</kbd>
        </div>
        <ul ref={list} id="cp-list" className="cmdp__list" role="listbox" aria-label="Results">
          {results.map(({ group, items }, section) => (
            <li key={group} role="presentation" className="cmdp__section">
              <div className="cmdp__heading" aria-hidden="true">
                {group}
              </div>
              <ul role="group" aria-label={group} className="cmdp__items">
                {items.map((command, row) => {
                  const at = starts[section] + row;
                  return (
                    <li
                      key={command.id}
                      id={`cp-opt-${at}`}
                      data-index={at}
                      role="option"
                      aria-selected={at === current}
                      className="cmdp__item"
                      data-testid="command-option"
                      onMouseMove={() => at !== current && setActive(at)}
                      onClick={() => choose(command)}
                    >
                      <span className="cmdp__icon" aria-hidden="true">
                        {command.icon}
                      </span>
                      <span className="cmdp__label">{command.label}</span>
                      {command.hint && <span className="cmdp__hint">{command.hint}</span>}
                      {at === current && <CornerDownLeft size={13} aria-hidden="true" className="cmdp__enter" />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {flat.length === 0 && (
          <p className="cmdp__empty" role="status">
            {typed && mods === null ? "Searching your mods..." : `Nothing matches "${query.trim()}".`}
          </p>
        )}
        <div className="cmdp__foot" aria-hidden="true">
          <span>
            <kbd className="cmdp__kbd">↑</kbd>
            <kbd className="cmdp__kbd">↓</kbd> move
          </span>
          <span>
            <kbd className="cmdp__kbd">↵</kbd> open
          </span>
          <span className="cmdp__foot-gap" />
          <span>
            <Zap size={11} /> Installed mods appear as you type
          </span>
        </div>
      </div>
    </dialog>
  );
}
