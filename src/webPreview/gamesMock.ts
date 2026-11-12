/*
 * The game sections in the web preview: sample games, mods and search results, so the
 * pages can be seen without the desktop app. Nothing here touches a real game.
 */

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();

const GAMES: GameSummary[] = [
  { id: "sims4", name: "The Sims 4", tagline: "Custom content, script mods and Gallery downloads", colour: "#22c55e", found: true, gameDir: "/Applications/The Sims 4.app", docsDir: "~/Documents/Electronic Arts/The Sims 4", source: "the EA app (sample)", chosen: false, windowsOnly: false, nexus: "thesims4", curseforge: 78062, modCount: 0, updated: null },
  { id: "gtav", name: "Grand Theft Auto V", tagline: "Script mods, trainers and add-on vehicles", colour: "#16a34a", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "gta5", curseforge: null, modCount: 0, updated: null },
  { id: "skyrimse", name: "Skyrim Special Edition", tagline: "Plugins, textures and SKSE mods", colour: "#94a3b8", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "skyrimspecialedition", curseforge: null, modCount: 0, updated: null },
  { id: "fallout4", name: "Fallout 4", tagline: "Plugins, settlements and F4SE mods", colour: "#eab308", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "fallout4", curseforge: null, modCount: 0, updated: null },
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
    mod("m:mccc", "MC Command Center", { hooks: true, mayNeedUpdate: true, fileCount: 14, areas: [{ area: "Mods", count: 14 }] }),
    mod("m:ww", "UI Cheats Extension", { hooks: true, mayNeedUpdate: true, source: { provider: "curseforge" } }),
    mod("m:hair", "Wavy Hair Pack", { source: { provider: "file", fileName: "wavy_hair.zip" }, fileCount: 6, areas: [{ area: "Mods", count: 6 }] }),
    mod("m:house", "Seaside Cottage (Tray)", { source: { provider: "file" }, areas: [{ area: "Tray", count: 5 }], fileCount: 5 }),
    mod("h:docs:Mods/old_slider.package", "old_slider.package", { managed: false, source: { provider: "hand" }, where: "Mods", kind: "file", areas: [], enabled: false }),
  ],
  stardew: [mod("m:cjb", "CJB Cheats Menu", { hooks: true, areas: [{ area: "Mods", count: 3 }], fileCount: 3 })],
};

let simsOptions = { mods: true, scripts: true };
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
    return { how: id === "sims4" ? "The Sims 4 app" : "Steam", safe: Boolean(options?.safe) };
  },
  setSimsOptions: async (options: { mods?: boolean; scripts?: boolean }) => {
    simsOptions = { mods: options.mods ?? simsOptions.mods, scripts: options.scripts ?? simsOptions.scripts };
    return simsOptions;
  },
  search: async (id: GameId, options: { provider?: "nexus" | "curseforge"; query?: string; page?: number }) => {
    const game = need(id);
    const mods = sampleMods(game, options.provider ?? "nexus", options.query ?? "", options.page ?? 0);
    return { total: options.query ? mods.length : 2400, mods };
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
  nexusAccount: async () => ({ name: "PreviewUser", premium: false }),
  openUrl: async (url: string) => {
    window.open(url, "_blank", "noopener");
  },
  onProgress: () => () => {},
  onNxm: () => () => {},
};
