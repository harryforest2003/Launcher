/*
 * The game sections in the web preview: sample games, mods and search results, so the
 * pages can be seen without the desktop app. Nothing here touches a real game.
 */

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();

const GAMES: GameSummary[] = [
  { id: "sims4", name: "The Sims 4", tagline: "Custom content, script mods and Gallery downloads", colour: "#22c55e", found: true, gameDir: "/Applications/The Sims 4.app", docsDir: "~/Documents/Electronic Arts/The Sims 4", source: "the EA app (sample)", chosen: false, windowsOnly: false, nexus: "thesims4", curseforge: 78062, modCount: 0, updated: null },
  { id: "gtav", name: "Grand Theft Auto V", tagline: "Script mods, trainers and add-on vehicles", colour: "#16a34a", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "gta5", curseforge: null, modCount: 0, updated: null },
  { id: "skyrimse", name: "Skyrim Special Edition", tagline: "Plugins, textures and SKSE mods", colour: "#94a3b8", found: true, gameDir: "C:/Steam/steamapps/common/Skyrim Special Edition", docsDir: null, source: "a CrossOver bottle (sample)", chosen: false, windowsOnly: true, nexus: "skyrimspecialedition", curseforge: null, modCount: 0, updated: null, loadOrder: true },
  { id: "fallout4", name: "Fallout 4", tagline: "Plugins, settlements and F4SE mods", colour: "#eab308", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "fallout4", curseforge: null, modCount: 0, updated: null, loadOrder: true },
  { id: "cyberpunk2077", name: "Cyberpunk 2077", tagline: "Archive mods, Cyber Engine Tweaks, redscript and RED4ext", colour: "#facc15", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "cyberpunk2077", curseforge: null, modCount: 0, updated: null },
  { id: "stardew", name: "Stardew Valley", tagline: "SMAPI mods", colour: "#4ade80", found: true, gameDir: "~/Library/Application Support/Steam/steamapps/common/Stardew Valley", docsDir: null, source: "Steam (sample)", chosen: false, windowsOnly: false, nexus: "stardewvalley", curseforge: 669, modCount: 0, updated: null },
];

const mod = (key: string, name: string, extra: Partial<GameMod> = {}): GameMod => ({
  key,
  managed: true,
  name,
  enabled: true,
  source: { provider: "nexus" },
  installedAt: daysAgo(120),
  fileCount: 1,
  areas: [{ area: "Mods", count: 1 }],
  plugins: [],
  notes: [],
  hooks: false,
  since: daysAgo(120),
  mayNeedUpdate: false,
  ...extra,
});

const MODS: Partial<Record<GameId, GameMod[]>> = {
  sims4: [
    mod("m:mccc", "MC Command Center", { hooks: true, mayNeedUpdate: true, fileCount: 14, areas: [{ area: "Mods", count: 14 }], version: "2025.9" }),
    mod("m:ww", "UI Cheats Extension", { hooks: true, mayNeedUpdate: true, source: { provider: "curseforge" } }),
    mod("m:hair", "Wavy Hair Pack", { source: { provider: "file", fileName: "wavy_hair.zip" }, fileCount: 6, areas: [{ area: "Mods", count: 6 }] }),
    mod("m:house", "Seaside Cottage (Tray)", { source: { provider: "file" }, areas: [{ area: "Tray", count: 5 }], fileCount: 5 }),
    mod("h:docs:Mods/old_slider.package", "old_slider.package", { managed: false, source: { provider: "hand" }, where: "Mods", kind: "file", areas: [], enabled: false }),
  ],
  stardew: [mod("m:cjb", "CJB Cheats Menu", { hooks: true, areas: [{ area: "Mods", count: 3 }], fileCount: 3 })],
  skyrimse: [
    mod("m:skyui", "SkyUI", { areas: [{ area: "Data", count: 2 }], plugins: ["SkyUI_SE.esp"], version: "5.2SE" }),
    mod("p:game:Data/Immersive Armors.esp", "Immersive Armors.esp", { managed: false, kind: "plugin", source: { provider: "hand" }, where: "Data", areas: [] }),
    mod("p:game:Data/Armor Patch.esp", "Armor Patch.esp", { managed: false, kind: "plugin", source: { provider: "hand" }, where: "Data", areas: [] }),
    mod("m:weather", "Obsidian Weathers", { areas: [{ area: "Data", count: 4 }], plugins: ["Obsidian Weathers.esp"] }),
  ],
};

const plugin = (name: string, extra: Partial<GamePlugin> = {}): GamePlugin => ({ name, active: true, master: /\.esm$/i.test(name), light: false, masters: ["Skyrim.esm"], problems: [], ...extra });
let skyrimOrder: GamePlugin[] = [
  plugin("Armor Patch.esp", { masters: ["Skyrim.esm", "Immersive Armors.esp"] }),
  plugin("Immersive Armors.esp"),
  plugin("SkyUI_SE.esp"),
  plugin("Obsidian Weathers.esp", { masters: ["Skyrim.esm", "Missing Lighting.esm"] }),
  plugin("Old Tweaks.esp", { active: false }),
];
const withProblems = (list: GamePlugin[]): GamePlugin[] =>
  list.map((p, i) => ({
    ...p,
    problems: !p.active
      ? []
      : p.masters.flatMap((m): GamePlugin["problems"] => {
          const at = list.findIndex((q) => q.name === m);
          if (m === "Skyrim.esm") return [];
          if (at < 0) return [{ kind: "missing" as const, master: m }];
          if (at > i) return [{ kind: "after" as const, master: m }];
          return [];
        }),
  }));

const FIXED = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"];
const orderNow = (): GameLoadOrder => {
  const plugins = withProblems(skyrimOrder);
  return {
    fixed: FIXED,
    plugins,
    fix: {
      turnOn: plugins.flatMap((p) => p.problems.filter((x) => x.kind === "off").map((x) => ({ name: x.master, for: p.name }))),
      turnOff: plugins.flatMap((p) => p.problems.filter((x) => x.kind === "missing").map((x) => ({ name: p.name, needs: x.master, missing: true }))),
      moved: plugins.filter((p) => p.problems.some((x) => x.kind === "after")).map((p) => p.name),
    },
  };
};

const backups: GameSaveBackup[] = [
  { id: "b2", at: daysAgo(1), reason: "Before playing with changed mods", size: 48_000_000, files: 12, from: "Saves" },
  { id: "b1", at: daysAgo(9), reason: "Before the first play after a game update", size: 46_500_000, files: 11, from: "Saves" },
];
const setsByGame: Partial<Record<GameId, GameSet[]>> = { sims4: [{ id: "s1", name: "Gameplay", keys: ["m:mccc", "m:ww"] }] };
let finderState: { phase: GameFinder["phase"]; suspects: string[]; testing: string[]; round: number } | null = null;
const finderStatus = (id: GameId): GameFinder => {
  if (!finderState) return { active: false };
  const names = (keys: string[]) => keys.map((k) => MODS[id]?.find((m) => m.key === k)?.name ?? k);
  return {
    active: true,
    phase: finderState.phase,
    round: finderState.round,
    roundsLeft: Math.ceil(Math.log2(Math.max(finderState.suspects.length, 1))) + (finderState.phase === "baseline" ? 1 : 0),
    suspects: names(finderState.suspects),
    testing: names(finderState.testing),
    found: finderState.phase === "found" ? names(finderState.suspects)[0] : null,
    foundKey: finderState.phase === "found" ? finderState.suspects[0] : null,
    total: finderState.suspects.length,
  };
};

// Sample mods with a newer version.
const updatable = new Set(["m:mccc", "m:ww"]);

let simsOptions = { mods: true, scripts: true };
let adultOn = false;
let simsUpdated: GameSummary["updated"] = { from: "1.111.102.1030", to: "1.112.519.1020" };

const summary = (game: GameSummary): GameSummary => ({
  ...game,
  modCount: (MODS[game.id] ?? []).filter((m) => m.enabled).length,
  updated: game.id === "sims4" ? simsUpdated : null,
});

const need = (id: GameId) => {
  const game = GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`Unknown game "${id}".`);
  return game;
};

const SAMPLE_NAMES = ["Better Build Buy", "More Columns", "Realistic Weather", "Quick Start Menu", "Expanded Careers", "Cosy Furniture Set", "Night Lighting", "Smarter NPCs"];

const sampleMods = (game: GameSummary, provider: "nexus" | "curseforge", query: string, page: number): GameRemoteMod[] =>
  SAMPLE_NAMES.filter((name) => !query || name.toLowerCase().includes(query.toLowerCase())).map((name, index) => ({
    provider,
    id: String(1000 + page * 24 + index),
    name: `${name}${page ? ` ${page + 1}` : ""}`,
    summary: `A sample ${game.name} mod for the web preview. The desktop app shows real ones from ${provider === "nexus" ? "Nexus Mods" : "CurseForge"}.`,
    picture: null,
    author: "SampleAuthor",
    downloads: 250000 - index * 21000,
    endorsements: provider === "nexus" ? 9000 - index * 700 : null,
    version: "1.2",
    updated: daysAgo(index * 9 + 2),
    adult: false,
    url: provider === "nexus" ? `https://www.nexusmods.com/${game.nexus}/mods/${1000 + index}` : "https://www.curseforge.com/",
  }));

export const gamesBridge = {
  list: async () => GAMES.map(summary),
  get: async (id: GameId): Promise<GameDetail> => {
    const game = summary(need(id));
    return {
      ...game,
      platform: "darwin",
      version: id === "sims4" ? "1.112.519.1020" : null,
      lastPlayed: id === "sims4" ? daysAgo(75) : null,
      simsOptions: id === "sims4" ? simsOptions : null,
      problems:
        id === "sims4" && simsUpdated
          ? [{ file: "lastException_3011.txt", time: daysAgo(1), mods: ["mc_cmd_center", "MCCC"], line: "AttributeError: 'Sim' object has no attribute 'get_career_tracker'" }]
          : [],
    };
  },
  mods: async (id: GameId) => MODS[id] ?? [],
  setEnabled: async (id: GameId, key: string, enabled: boolean) => {
    const found = MODS[id]?.find((m) => m.key === key);
    if (found) found.enabled = enabled;
    return { key, enabled };
  },
  remove: async (id: GameId, key: string) => {
    MODS[id] = (MODS[id] ?? []).filter((m) => m.key !== key);
    return { removed: key };
  },
  downloads: async (id: GameId): Promise<GameDownload[]> =>
    id === "sims4"
      ? [
          { path: "/preview/Downloads/TSR_LongHair.zip", name: "TSR_LongHair.zip", size: 4_200_000, modified: daysAgo(0), installed: false, fits: true },
          { path: "/preview/Downloads/MCCC_2025.zip", name: "MCCC_2025.zip", size: 1_900_000, modified: daysAgo(1), installed: false, fits: true },
          { path: "/preview/Downloads/wavy_hair.zip", name: "wavy_hair.zip", size: 800_000, modified: daysAgo(30), installed: true, fits: true },
          { path: "/preview/Downloads/Invoice.zip", name: "Invoice.zip", size: 120_000, modified: daysAgo(3), installed: false, fits: false },
        ]
      : [],
  install: async (id: GameId, filePath?: string): Promise<GameInstallResult> => {
    const name = (filePath ?? "Chosen mod.zip").split("/").pop()!.replace(/\.(zip|7z|rar)$/i, "");
    MODS[id] = [...(MODS[id] ?? []), mod(`m:${name}`, name, { installedAt: new Date().toISOString(), since: new Date().toISOString(), source: { provider: "file", fileName: filePath?.split("/").pop() } })];
    return { mod: { id: name, name }, placed: { Mods: 3 }, skipped: [], notes: [] };
  },
  chooseFolder: async () => null,
  forgetFolder: async () => null,
  chooseDocs: async () => null,
  openFolder: async () => {},
  launch: async (id: GameId, options?: { safe?: boolean }) => {
    if (!need(id).found) throw new Error(`${need(id).name} couldn't be started from here: choose its folder in Settings, or start it as you usually do.`);
    if (id === "sims4") {
      if (options?.safe) simsOptions = { ...simsOptions, scripts: false };
      simsUpdated = null;
      for (const m of MODS.sims4 ?? []) m.mayNeedUpdate = m.hooks && !!options?.safe && m.mayNeedUpdate;
    }
    return { how: id === "sims4" ? "The Sims 4 app" : "Steam", safe: Boolean(options?.safe), backedUp: backups[0] ?? null, backupError: null };
  },
  setSimsOptions: async (options: { mods?: boolean; scripts?: boolean }) => {
    simsOptions = { mods: options.mods ?? simsOptions.mods, scripts: options.scripts ?? simsOptions.scripts };
    return simsOptions;
  },
  search: async (id: GameId, options: { provider?: "any" | "nexus" | "curseforge"; query?: string; page?: number }): Promise<GameSearchPage> => {
    const game = need(id);
    const sources: ("nexus" | "curseforge")[] =
      options.provider === "nexus" || options.provider === "curseforge" ? [options.provider] : game.curseforge ? ["nexus", "curseforge"] : ["nexus"];
    const lists = sources.map((source) => sampleMods(game, source, options.query ?? "", options.page ?? 0).slice(0, sources.length > 1 ? 4 : 8));
    const mods = lists[0].flatMap((first, i) => [first, ...lists.slice(1).map((list) => list[i]).filter(Boolean)]);
    const totals = Object.fromEntries(sources.map((source) => [source, options.query ? 4 : 1200]));
    return { total: Object.values(totals).reduce((a, b) => a + b, 0), totals, pageCount: options.query ? 1 : 100, mods };
  },
  details: async (id: GameId, provider: "nexus" | "curseforge", modId: string): Promise<GameModDetails> => {
    const game = need(id);
    const base = sampleMods(game, provider, "", 0).find((m) => m.id === modId) ?? sampleMods(game, provider, "", 0)[0];
    return {
      ...base,
      html: "<center><b>Sample description</b></center><br>This is what a mod's description looks like here. The desktop app shows the real one, with its pictures and links.<ul><li>Feature one</li><li>Feature two</li></ul>",
      images: [],
      hasKey: true,
      premium: false,
      files: [
        { id: "1", name: `${base.name} main file`, version: "1.2", category: "Main", size: 3_400_000, fileName: "main.zip", date: daysAgo(4), description: "" },
        { id: "2", name: "Optional extras", version: "1.2", category: "Optional", size: 900_000, fileName: "extras.zip", date: daysAgo(4), description: "Adds more colours." },
      ],
    };
  },
  installRemote: async (): Promise<GameInstallResult> => ({ needsWebsite: null, reason: "The web preview can't download mods." }),
  checkUpdates: async (id: GameId): Promise<GameUpdateCheck> => ({
    updates: (MODS[id] ?? [])
      .filter((m) => updatable.has(m.key))
      .map((m) => ({ key: m.key, name: m.name, provider: "nexus" as const, modId: "123", fromVersion: "2025.9", toVersion: "2025.11", toFileId: "9", toName: m.name, date: daysAgo(3), size: 2_000_000 })),
    checked: (MODS[id] ?? []).filter((m) => m.managed).length,
    unknown: 0,
    needsKey: 0,
    error: null,
  }),
  update: async (_id: GameId, key: string): Promise<GameInstallResult> => {
    for (const list of Object.values(MODS)) {
      const found = list?.find((m) => m.key === key);
      if (found) {
        found.version = "2025.11";
        found.canUndo = true;
        found.mayNeedUpdate = false;
      }
    }
    updatable.delete(key);
    return { mod: { id: key, name: key }, placed: { Mods: 1 }, notes: ["Replaced the copy installed before (Undo puts it back)."] };
  },
  undoUpdate: async (_id: GameId, key: string) => {
    for (const list of Object.values(MODS)) {
      const found = list?.find((m) => m.key === key);
      if (found) {
        found.version = "2025.9";
        found.canUndo = false;
      }
    }
    updatable.add(key);
    return { restored: key, version: "2025.9" };
  },
  nexusAccount: async () => ({ name: "PreviewUser", premium: false }),

  saves: async (id: GameId) => ({ dir: id === "sims4" ? "~/Documents/Electronic Arts/The Sims 4/Saves" : null, backups: id === "sims4" ? backups : [] }),
  backupSaves: async () => {
    const made = { id: `b${Date.now()}`, at: new Date().toISOString(), reason: "Backed up from Settings", size: 48_200_000, files: 12, from: "Saves" };
    backups.unshift(made);
    return made;
  },
  restoreSaves: async (_id: GameId, backupId: string) => backups.find((b) => b.id === backupId)!,
  deleteBackup: async (_id: GameId, backupId: string) => {
    backups.splice(backups.findIndex((b) => b.id === backupId), 1);
  },
  chooseSaves: async () => null,
  forgetSaves: async () => {},
  openSaves: async () => {},

  loadOrder: async (): Promise<GameLoadOrder> => orderNow(),
  setLoadOrder: async (_id: GameId, entries: { name: string; active: boolean }[]): Promise<GameLoadOrder> => {
    skyrimOrder = entries.map((e) => ({ ...skyrimOrder.find((p) => p.name === e.name)!, active: e.active }));
    return orderNow();
  },
  fixLoadOrder: async () => {
    const done = orderNow().fix;
    const off = new Set(done.turnOff.map((t) => t.name));
    const on = new Set(done.turnOn.map((t) => t.name));
    const changed = skyrimOrder.map((p) => ({ ...p, active: off.has(p.name) ? false : on.has(p.name) ? true : p.active }));
    const masters = (p: GamePlugin) => p.masters.filter((m) => changed.some((q) => q.name === m));
    const out: GamePlugin[] = [];
    const place = (p: GamePlugin) => {
      if (out.includes(p)) return;
      masters(p).forEach((m) => place(changed.find((q) => q.name === m)!));
      out.push(p);
    };
    changed.forEach(place);
    skyrimOrder = out;
    return { ...orderNow(), done };
  },

  requirements: async (id: GameId): Promise<GameRequirement[]> =>
    id === "skyrimse"
      ? [
          { key: "nexus:30379", name: "Skyrim Script Extender (SKSE64)", kind: "nexus", modId: "30379", url: null, neededBy: ["SkyUI"], auto: true },
          { key: "master:missing lighting.esm", name: "Missing Lighting.esm", kind: "master", modId: null, url: null, neededBy: ["Obsidian Weathers.esp"], auto: false, note: "A plugin file other plugins need." },
        ]
      : id === "sims4"
        ? [{ key: "cf:123", name: "XML Injector", kind: "curseforge", modId: "123", url: null, neededBy: ["UI Cheats Extension"], auto: true }]
        : [],
  requirementsBefore: async () => [],
  getRequirement: async (_id: GameId, key: string): Promise<GameInstallResult> => ({ needsWebsite: "https://www.nexusmods.com/", modId: key.split(":")[1] }),

  sets: async (id: GameId) => setsByGame[id] ?? [],
  saveSet: async (id: GameId, set: { id?: string | null; name: string }) => {
    const list = (setsByGame[id] ??= []);
    const existing = set.id && list.find((s) => s.id === set.id);
    if (existing) existing.name = set.name;
    else list.push({ id: `s${Date.now()}`, name: set.name, keys: [] });
    return [...list];
  },
  deleteSet: async (id: GameId, setId: string) => (setsByGame[id] = (setsByGame[id] ?? []).filter((s) => s.id !== setId)),
  setMember: async (id: GameId, setId: string, key: string, member: boolean) => {
    const set = setsByGame[id]?.find((s) => s.id === setId);
    if (set) set.keys = member ? [...new Set([...set.keys, key])] : set.keys.filter((k) => k !== key);
    return [...(setsByGame[id] ?? [])];
  },
  useSet: async (id: GameId, setId: string) => {
    const set = setsByGame[id]?.find((s) => s.id === setId);
    let changed = 0;
    for (const m of MODS[id] ?? []) {
      const want = Boolean(set?.keys.includes(m.key));
      if (m.enabled !== want) {
        m.enabled = want;
        changed += 1;
      }
    }
    return { changed };
  },

  finder: async (id: GameId) => finderStatus(id),
  finderStart: async (id: GameId) => {
    const on = (MODS[id] ?? []).filter((m) => m.enabled).map((m) => m.key);
    finderState = { phase: "baseline", suspects: on, testing: [], round: 0 };
    return finderStatus(id);
  },
  finderAnswer: async (id: GameId, happened: boolean) => {
    const f = finderState!;
    if (f.phase === "baseline") f.phase = happened ? "not-mods" : "split";
    else f.suspects = happened ? f.testing : f.suspects.filter((k) => !f.testing.includes(k));
    if (f.phase === "split" && f.suspects.length === 1) f.phase = "found";
    if (f.phase === "split") {
      f.testing = f.suspects.slice(0, Math.ceil(f.suspects.length / 2));
      f.round += 1;
    }
    return finderStatus(id);
  },
  finderStop: async (id: GameId, keepOff?: string | null): Promise<GameFinder> => {
    finderState = null;
    return { active: false, keptOff: keepOff ? (MODS[id]?.find((m) => m.key === keepOff)?.name ?? null) : null };
  },
  adultStatus: async (): Promise<GameAdultStatus> => ({ hasKey: true, verified: true, on: adultOn, blur: true, error: null }),
  setAdult: async (on: boolean): Promise<GameAdultStatus> => {
    adultOn = on;
    return { hasKey: true, verified: true, on, blur: true, error: null };
  },
  openUrl: async (url: string) => {
    window.open(url, "_blank", "noopener");
  },
  onProgress: () => () => {},
  onNxm: () => () => {},
};
