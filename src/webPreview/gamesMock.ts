/*
 * The game sections in the web preview: sample games, mods and search results, so the
 * pages can be seen without the desktop app. Nothing here touches a real game.
 */

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();

// RimWorld's and Baldur's Gate 3's mod lists, for their Load Order pages.
type MockOrderMod = { id: string; name: string; note: string | null; active: boolean; fixed: boolean; needs?: string[]; after?: string[] };
const modOrders: Partial<Record<GameId, MockOrderMod[]>> = {
  rimworld: [
    { id: "ludeon.rimworld", name: "Core", note: "ludeon.rimworld", active: true, fixed: true },
    { id: "ludeon.rimworld.royalty", name: "Royalty", note: "ludeon.rimworld.royalty", active: true, fixed: false },
    { id: "vanillaexpanded.vfecore", name: "Vanilla Expanded Framework", note: "oskarpotocki.vanillafactionsexpanded.core", active: true, fixed: false, needs: ["brrainz.harmony"] },
    { id: "brrainz.harmony", name: "Harmony", note: "brrainz.harmony", active: true, fixed: false },
    { id: "jecrell.doorsexpanded", name: "Doors Expanded", note: "jecrell.doorsexpanded", active: true, fixed: false, needs: ["unlimitedhugs.hugslib"] },
    { id: "unlimitedhugs.hugslib", name: "HugsLib", note: "unlimitedhugs.hugslib", active: false, fixed: false, needs: ["brrainz.harmony"] },
    { id: "fluffy.modmanager", name: "Mod Manager", note: "fluffy.modmanager", active: false, fixed: false },
  ],
  bg3: [
    { id: "28ac9ce2-2aba-8cda-b3b5-6e922f71b6b8", name: "GustavDev", note: "GustavDev", active: true, fixed: true },
    { id: "f1fcd3c5-2b9d-4b9a-9a58-1a3d6a0e6e07", name: "ImprovedUI", note: "ImprovedUI", active: true, fixed: false },
    { id: "a7f1cd52-6f3e-4c47-8c5f-26b7d9f5f2b1", name: "Mod Configuration Menu", note: "BG3MCM", active: true, fixed: false },
    { id: "3f2c9e6b-2a44-4d4f-9b31-8e2f6e5d0a17", name: "5e Spells", note: "5eSpells", active: true, fixed: false },
  ],
};
const modOrderNow = (id: GameId): GameModOrder => {
  const list = modOrders[id] ?? [];
  const on = list.filter((m) => m.active).map((m) => m.id);
  const name = (other: string) => list.find((m) => m.id === other)?.name ?? other;
  const entries = list.map(({ needs = [], after = [], ...m }) => ({
    ...m,
    problems: !m.active
      ? []
      : [
          ...needs.filter((n) => !on.includes(n)).map((n) => `Needs ${name(n)}, which is turned off`),
          ...needs.filter((n) => on.indexOf(n) > on.indexOf(m.id)).map((n) => `Needs ${name(n)}, which loads after it`),
          ...after.filter((n) => on.indexOf(n) > on.indexOf(m.id)).map((n) => `Should load after ${name(n)}`),
        ],
  }));
  const rim = id === "rimworld";
  const bad = entries.some((e) => e.problems.length);
  return {
    kind: rim ? "rimworld" : "bg3",
    file: rim ? "~/Library/Application Support/RimWorld/Config/ModsConfig.xml" : "~/Documents/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/modsettings.lsx",
    toggles: rim,
    entries,
    fix: rim && bad ? { turnOn: list.some((m) => m.id === "unlimitedhugs.hugslib" && !m.active) ? ["HugsLib"] : [], moved: 2 } : { turnOn: [], moved: 0 },
  };
};

// Preview-only fixture for checking launch errors without starting a real game.
const launchListeners = new Set<(event: GameLaunchProgress) => void>();
let failNextPreviewLaunch = new URLSearchParams(window.location.search).get("launchPreview") === "fail-once";
const launchStage = async (gameId: GameId, stage: GameLaunchProgress["stage"]) => {
  launchListeners.forEach((listener) => listener({ gameId, stage }));
  await new Promise((resolve) => setTimeout(resolve, 250));
};

const GAMES: GameSummary[] = [
  { id: "sims4", name: "The Sims 4", steamAppId: "1222670", tagline: "Custom content, script mods and Gallery downloads", colour: "#22c55e", found: true, gameDir: "/Applications/The Sims 4.app", docsDir: "~/Documents/Electronic Arts/The Sims 4", source: "the EA app (sample)", chosen: false, windowsOnly: false, nexus: "thesims4", curseforge: 78062, modCount: 0, updated: null },
  { id: "gtav", name: "Grand Theft Auto V", steamAppId: "271590", tagline: "Script mods, trainers and add-on vehicles", colour: "#16a34a", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "gta5", curseforge: null, modCount: 0, updated: null },
  { id: "skyrimse", name: "Skyrim Special Edition", steamAppId: "489830", tagline: "Plugins, textures and SKSE mods", colour: "#94a3b8", found: true, gameDir: "C:/Steam/steamapps/common/Skyrim Special Edition", docsDir: null, source: "a CrossOver bottle (sample)", chosen: false, windowsOnly: true, nexus: "skyrimspecialedition", curseforge: null, modCount: 0, updated: null, loadOrder: "plugins" },
  { id: "fallout4", name: "Fallout 4", steamAppId: "377160", tagline: "Plugins, settlements and F4SE mods", colour: "#eab308", found: false, gameDir: null, docsDir: null, source: null, chosen: false, windowsOnly: true, nexus: "fallout4", curseforge: null, modCount: 0, updated: null, loadOrder: "plugins" },
  { id: "cyberpunk2077", name: "Cyberpunk 2077", steamAppId: "1091500", tagline: "redscript mods, and archive mods through archive-loader", colour: "#facc15", found: true, gameDir: "~/Library/Application Support/Steam/steamapps/common/Cyberpunk 2077", docsDir: null, source: "Steam (sample)", chosen: false, windowsOnly: false, cantRun: "Cyberpunk 2077's Mac version only runs on Apple silicon (M1 or later), and this Mac has an Intel processor.", nexus: "cyberpunk2077", curseforge: null, modCount: 0, updated: null },
  { id: "stardew", name: "Stardew Valley", steamAppId: "413150", tagline: "SMAPI mods", colour: "#4ade80", found: true, gameDir: "~/Library/Application Support/Steam/steamapps/common/Stardew Valley", docsDir: null, source: "Steam (sample)", chosen: false, windowsOnly: false, nexus: "stardewvalley", curseforge: 669, modCount: 0, updated: null },
  // Games every launcher store sells: a mods folder and a way to start, no workspace of their own.
  ...([
    ["eldenring", "ELDEN RING", "#c9a227", "eldenring", null, "1245620", true],
    ["bg3", "Baldur's Gate 3", "#7c3aed", "baldursgate3", 84299, "1086940", true],
    ["valheim", "Valheim", "#0ea5e9", "valheim", null, "892970", false],
    ["terraria", "Terraria", "#22c55e", "terraria", 431, "105600", true],
    ["rimworld", "RimWorld", "#f97316", "rimworld", null, "294100", true],
    ["witcher3", "The Witcher 3: Wild Hunt", "#dc2626", "witcher3", null, "292030", false],
  ] as const).map(([id, name, colour, nexus, curseforge, steamAppId, found]): GameSummary => ({
    id, name, colour, nexus, curseforge, steamAppId, found,
    tagline: "Mods from Nexus Mods" + (curseforge ? " and CurseForge" : ""),
    gameDir: found ? `~/Library/Application Support/Steam/steamapps/common/${name}` : null,
    docsDir: null, source: found ? "Steam (sample)" : null, chosen: false, windowsOnly: false, modCount: 0, updated: null,
    generic: true, modsDir: found ? `~/Library/Application Support/Steam/steamapps/common/${name}/mods` : null, modsChosen: false, launchExe: null,
    loadOrder: id === "bg3" || id === "rimworld" ? id : null,
  })),
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
    mod("m:wicked", "WickedWhims", { hooks: true, source: { provider: "file", fileName: "WickedWhims_v179.zip" }, fileCount: 22, areas: [{ area: "Mods", count: 22 }], version: "179", installedAt: daysAgo(40) }),
    mod("m:lot51", "Lot 51 Core Library", { hooks: true, source: { provider: "curseforge", modId: "551" }, fileCount: 2, areas: [{ area: "Mods", count: 2 }], version: "1.0.4", installedAt: daysAgo(18) }),
    mod("m:slice", "Slice of Life", { hooks: true, source: { provider: "curseforge", modId: "552" }, fileCount: 9, areas: [{ area: "Mods", count: 9 }], version: "2.3.1", installedAt: daysAgo(60) }),
    mod("m:basemental", "Basemental Drugs", { hooks: true, source: { provider: "file", fileName: "Basemental_Drugs_Tuning.zip" }, fileCount: 31, areas: [{ area: "Mods", count: 31 }], installedAt: daysAgo(85) }),
    mod("m:lumpinou", "Lumpinou Better Build/Buy", { source: { provider: "file", fileName: "Lumpinou_BB.zip" }, fileCount: 4, areas: [{ area: "Mods", count: 4 }], installedAt: daysAgo(33) }),
    mod("m:skin", "Default Skin Overlay Set", { source: { provider: "curseforge", modId: "553" }, fileCount: 12, areas: [{ area: "Mods", count: 12 }], version: "3.0", installedAt: daysAgo(150) }),
    mod("m:eyes", "Default Replacement Eyes", { source: { provider: "file", fileName: "default_eyes.package" }, fileCount: 1, areas: [{ area: "Mods", count: 1 }], installedAt: daysAgo(200) }),
    mod("m:poses", "Couple Poses Pack", { managed: false, source: { provider: "hand" }, where: "Mods", kind: "folder", areas: [], fileCount: 18, installedAt: daysAgo(70) }),
    mod("m:tray2", "Modern Loft (Tray)", { source: { provider: "file", fileName: "ModernLoft.zip" }, areas: [{ area: "Tray", count: 6 }], fileCount: 6, installedAt: daysAgo(12) }),
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
      turnOff: [],
      moved: plugins.filter((p) => p.problems.some((x) => x.kind === "after")).map((p) => p.name),
      get: plugins.flatMap((p) =>
        p.problems
          .filter((x) => x.kind === "missing")
          .map((x) => ({ key: "nexus:9999", name: "Lighting Overhaul", kind: "nexus" as const, modId: "9999", fileId: "1", url: null, neededBy: [p.name], auto: true, master: x.master }))
      ),
    },
  };
};

const backups: GameSaveBackup[] = [
  { id: "b2", at: daysAgo(1), reason: "Before playing with changed mods", size: 48_000_000, files: 12, from: "Saves" },
  { id: "b1", at: daysAgo(9), reason: "Before the first play after a game update", size: 46_500_000, files: 11, from: "Saves" },
];
const hiddenClashes = new Set<string>();
const CLASHES: Partial<Record<GameId, GameClash[]>> = {
  sims4: [
    { id: "tuning|a|b", kind: "tuning", mods: [{ name: "Better Traits", key: "h:docs:Mods/BetterTraits.package" }, { name: "Better Traits (copy)", key: "h:docs:Mods/Old/BetterTraits.package" }], count: 282, examples: ["trait_Active", "trait_Ambitious", "trait_Cheerful"], severity: "error" },
    { id: "item|c|d", kind: "item", mods: [{ name: "Tallulah Dress", key: "h:docs:Mods/CAS/Tallulah.package" }, { name: "Tallulah Dress v2", key: "h:docs:Mods/Tallulah_v2.package" }], count: 10, examples: [], severity: "warn" },
  ],
  skyrimse: [
    { id: "records|Bandit Overhaul.esp>Prettier NPCs.esp", kind: "records", mods: [{ name: "Bandit Overhaul.esp", key: "p:game:Data/Bandit Overhaul.esp" }, { name: "Prettier NPCs.esp", key: "p:game:Data/Prettier NPCs.esp" }], winner: "Prettier NPCs.esp", count: 37, examples: ["NPC_ ×31", "OTFT ×6"], severity: "warn" },
  ],
  cyberpunk2077: [
    { id: "redscript|e|f", kind: "redscript", mods: [{ name: "Better Death", key: "h:game:r6/scripts/BetterDeath" }, { name: "No Death Screen", key: "h:game:r6/scripts/NoDeathScreen" }], count: 1, examples: ["PlayerPuppet.OnDeath"], severity: "error" },
  ],
};
const clashesFor = (id: GameId): GameClash[] => (CLASHES[id] ?? []).map((c) => ({ ...c, hidden: hiddenClashes.has(c.id) }));

const picture = (colour: string, shape: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ece8f4"/>${shape.replace(/C/g, colour)}</svg>`)}`;
const DRESS = '<path d="M40 18h20l-4 18 16 50H28l16-50z" fill="C"/>';
const SOFA = '<rect x="14" y="44" width="72" height="26" rx="8" fill="C"/><rect x="20" y="30" width="60" height="20" rx="6" fill="C" opacity=".8"/>';
const HAIR = '<circle cx="50" cy="48" r="26" fill="C"/><circle cx="50" cy="56" r="16" fill="#f3d1b0"/>';
const CC: GameCC[] = [
  ["CAS/Tallulah Dress.package", "Create a Sim", 10, true],
  ["CAS/Hair/Wavy Bob.package", "Create a Sim", 24, true],
  ["CAS/Hair/Long Braids.package", "Create a Sim", 18, true],
  ["CAS/Sneakers.package", "Create a Sim", 6, false],
  ["Build/Velvet Sofa.package", "Build/Buy", 3, true],
  ["Build/Garden Set.package", "Build/Buy", 12, true],
  ["Build/Kitchen Island.package", "Build/Buy", 1, true],
  ["Gameplay/Better Traits.package", "Gameplay", 0, true],
  ["Gameplay/Realistic Careers.package", "Gameplay", 0, true],
  ["MCCC/mc_cmd_center.ts4script", "Script", 0, true],
  ["WickedWhims.ts4script", "Script", 0, true],
  ["Misc/Loading Screen.package", "Other", 0, true],
].map(([rel, category, items, enabled]) => ({
  rel: String(rel),
  key: `h:docs:Mods/${rel}`,
  name: String(rel).split("/").pop()!.replace(/\.(package|ts4script)$/, ""),
  folder: String(rel).includes("/") ? String(rel).split("/").slice(0, -1).join("/") : "",
  category: category as GameCC["category"],
  items: Number(items),
  size: 180_000 + String(rel).length * 91_000,
  enabled: Boolean(enabled),
  picture: category === "Create a Sim" || category === "Build/Buy",
  owner: rel === "WickedWhims.ts4script" ? "WickedWhims" : null,
  broken: rel === "Misc/Loading Screen.package",
}));
const CC_PICTURES: Record<string, string> = {
  "CAS/Tallulah Dress.package": picture("#7c3aed", DRESS),
  "CAS/Hair/Wavy Bob.package": picture("#92400e", HAIR),
  "CAS/Hair/Long Braids.package": picture("#1f2937", HAIR),
  "CAS/Sneakers.package": picture("#dc2626", '<rect x="18" y="52" width="64" height="18" rx="9" fill="C"/>'),
  "Build/Velvet Sofa.package": picture("#047857", SOFA),
  "Build/Garden Set.package": picture("#65a30d", '<circle cx="35" cy="45" r="16" fill="C"/><circle cx="62" cy="40" r="20" fill="C"/><rect x="30" y="60" width="40" height="20" fill="#78350f"/>'),
};

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

// The downloads queue, simulated: "Skip this one" stands in for pressing Nexus' download button.
const queueItems: GameQueueItem[] = [];
const queueListeners = new Set<(q: GameQueue) => void>();
const queueSnap = (): GameQueue => ({
  items: [...queueItems],
  current: queueItems.find((i) => i.status === "website" || i.status === "working") ?? null,
  counts: {
    waiting: queueItems.filter((i) => i.status === "waiting").length,
    done: queueItems.filter((i) => i.status === "done").length,
    failed: queueItems.filter((i) => i.status === "failed").length,
    skipped: queueItems.filter((i) => i.status === "skipped").length,
    total: queueItems.length,
  },
});
const emitQueue = () => queueListeners.forEach((listener) => listener(queueSnap()));

let simsOptions = { mods: true, scripts: true };
let adultOn = false;
let simsUpdated: GameSummary["updated"] = { from: "1.111.102.1030", to: "1.112.519.1020" };

/* The rest of the sample catalog gets a workspace too, as in the app: found when the sample
   mod scan found it, otherwise waiting in More Games. */
export function addSampleWorkspaces(catalog: CatalogGame[], detected: { id: string; installPath?: string | null; modDir?: string | null }[]) {
  for (const game of catalog) {
    if (game.id === "minecraft" || GAMES.some((g) => g.id === game.id)) continue;
    const seen = detected.find((d) => d.id === game.id);
    GAMES.push({
      id: game.id, name: game.name, colour: "#64748b", tagline: game.notOnPC ? "Not on PC yet" : "Mods from Nexus Mods", found: Boolean(seen) && !game.notOnPC,
      gameDir: seen?.installPath ?? null, docsDir: null, source: seen ? "Mods folder (sample)" : null, chosen: false, windowsOnly: game.windowsOnly,
      nexus: game.providers.includes("nexus") ? game.id : null, curseforge: null, steamAppId: game.steamAppId, notOnPC: game.notOnPC,
      modCount: 0, updated: null, generic: true, modsDir: seen?.modDir ?? null, modsChosen: false, launchExe: null,
    });
  }
}

const steamHeader = (appId: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
/* What the stores return for a search: invented paging over real store names. */
const FOUND_SAMPLE: Omit<GameFound, "existing">[] = (
  [
    ["ELDEN RING", "1245620", "eldenring", 9800, null],
    ["Baldur's Gate 3", "1086940", "baldursgate3", 14000, 84299],
    ["Valheim", "892970", "valheim", 6200, null],
    ["Terraria", "105600", "terraria", 2100, 431],
    ["RimWorld", "294100", "rimworld", 3600, null],
    ["The Witcher 3: Wild Hunt", "292030", "witcher3", 7400, null],
    ["Mount & Blade II: Bannerlord", "261550", "mountandblade2bannerlord", 8100, null],
    ["Hollow Knight", "367520", "hollowknight", 900, null],
    ["Dark Souls III", "374320", "darksouls3", 2800, null],
    ["Monster Hunter: World", "582010", "monsterhunterworld", 11000, null],
    ["Euro Truck Simulator 2", "227300", "eurotrucksimulator2", 700, null],
    ["Kerbal Space Program", "220200", "kerbalspaceprogram", 1500, 4401],
    ["Darkest Dungeon", "262060", "darkestdungeon", 1300, null],
    ["Slay the Spire", "646570", "slaythespire", 600, null],
    ["Subnautica", "264710", "subnautica", 1900, null],
  ] as const
).map(([name, steamAppId, nexus, nexusMods, curseforge], i) => ({
  name, steamAppId, nexus, nexusGameId: null, nexusMods, curseforge, installed: i === 7, art: steamHeader(steamAppId), artAlt: null,
}));

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

/* [name, author, summary, downloads, endorsements, days since update, sites]. Invented, generic content. */
type SampleRow = [string, string, string, number, number, number, "both" | "nexus" | "curseforge"];
const SAMPLE_ROWS: SampleRow[] = [
  ["Better Build Buy", "BuildCraftLab", "Sorts the catalogue by room and style, and adds a search box that remembers what you looked for.", 412000, 15800, 3, "both"],
  ["Slice of Life Needs", "QuietHollow", "Adds moodlets for small daily joys and annoyances, with settings to tune how often they appear.", 388000, 14200, 8, "both"],
  ["More Columns", "ArchWorks", "A set of pillars, arches and half walls in every wall style, for builders who run out of trim.", 301000, 9400, 12, "nexus"],
  ["Realistic Weather", "SkyRoutine", "Rain, snow and fog change slowly through the day instead of switching all at once.", 276000, 8100, 5, "both"],
  ["Quick Start Menu", "TinyTools", "Skips the intro screens and takes you straight to your save in a few seconds.", 254000, 7600, 21, "nexus"],
  ["Expanded Careers", "NineToFive", "Adds six new careers with their own outfits, work days and promotions.", 233000, 7200, 16, "curseforge"],
  ["Cosy Furniture Set", "WoolAndOak", "Forty soft chairs, rugs and lamps in warm colours, all with recolours.", 219000, 6900, 30, "both"],
  ["Night Lighting", "DuskStudio", "Warmer street lamps and window glow after dark. Works with most lighting packs.", 187000, 5300, 9, "nexus"],
  ["Smarter Neighbours", "TownPlanner", "Townies visit parks, shops and each other more often, and stay out of your way less.", 164000, 4800, 44, "curseforge"],
  ["Relaxed Aging", "LongerDays", "Choose how long each life stage lasts, from a few days to a full season.", 152000, 4500, 14, "both"],
  ["Hair Without Hats", "StrandCo", "Hat-friendly versions of popular hairstyles, so hair no longer clips through caps.", 141000, 4100, 27, "curseforge"],
  ["Clutter Cleaner", "TidyTeam", "Removes leftover objects after parties and adds a one-click tidy to the pie menu.", 128000, 3900, 6, "nexus"],
  ["Kitchen Overhaul", "PanAndPlate", "New cooking animations, more recipes and a cleaner kitchen interface.", 117000, 3400, 52, "both"],
  ["Better Pets Behaviour", "PawPrint", "Pets sleep, play and beg for food in more natural ways.", 96000, 2900, 19, "curseforge"],
  ["Faster Loading Screens", "QuickLoad", "Trims the wait between lots by cutting unused preloaded data.", 88000, 2600, 33, "nexus"],
  ["Seasonal Outfits", "ThreadAndNeedle", "Coats, scarves and summer wear that match the weather outside.", 74000, 2100, 60, "both"],
];

const sampleMods = (game: GameSummary, provider: "nexus" | "curseforge", query: string, page: number): GameRemoteMod[] =>
  SAMPLE_ROWS.filter(([name, , summary, , , , sites]) => (sites === "both" || sites === provider) && (!query || `${name} ${summary}`.toLowerCase().includes(query.toLowerCase()))).map(
    ([name, author, summary, downloads, endorsements, days], index) => ({
      provider,
      id: String(1000 + SAMPLE_ROWS.findIndex((row) => row[0] === name)),
      name: page ? `${name} ${page + 1}` : name,
      summary,
      picture: null,
      author,
      downloads: Math.round((downloads * (provider === "nexus" ? 1 : 0.8)) / (page + 1)),
      endorsements: provider === "nexus" ? endorsements : null,
      version: `1.${(index % 5) + 1}`,
      updated: daysAgo(days),
      adult: false,
      url: provider === "nexus" ? `https://www.nexusmods.com/${game.nexus}/mods/${1000 + index}` : "https://www.curseforge.com/",
    }),
  );

export const gamesBridge = {
  list: async () => GAMES.map(summary),
  collections: async (): Promise<{ total: number; collections: GameCollectionSummary[] }> => ({
    total: 2,
    collections: [
      { slug: "abc123", name: "Cosy Valley", summary: "A sample collection for the web preview: farm life, prettier seasons and more friends.", picture: null, author: "SampleCurator", endorsements: 4800, downloads: 760000, updated: daysAgo(4), mods: 6, size: 465_000_000, revision: 12, adult: false, url: "https://www.nexusmods.com/" },
      { slug: "def456", name: "Bigger Town", summary: "Another sample collection.", picture: null, author: "SampleCurator", endorsements: 690, downloads: 130000, updated: daysAgo(20), mods: 3, size: 120_000_000, revision: 3, adult: false, url: "https://www.nexusmods.com/" },
    ],
  }),
  collection: async (_id: GameId, slug: string): Promise<GameCollection> => ({
    slug,
    name: "Cosy Valley",
    summary: "A sample collection for the web preview: farm life, prettier seasons and more friends.",
    description: "## What's in it\n\nA **sample** description, written the way collection authors do.",
    picture: null,
    author: "SampleCurator",
    endorsements: 4800,
    downloads: 760000,
    revision: 12,
    size: 465_000_000,
    installationInfo: "",
    url: "https://www.nexusmods.com/",
    files: [
      { modId: "1915", fileId: "1", name: "Content Patcher", fileName: "Content Patcher 2.5", version: "2.5.0", optional: false, installed: "same" },
      { modId: "2", fileId: "2", name: "Seasonal Outfits", fileName: "Seasonal Outfits", version: "1.4", optional: false, installed: "no" },
      { modId: "3", fileId: "3", name: "Better Ranching", fileName: "Better Ranching", version: "2.1", optional: false, installed: "other" },
      { modId: "4", fileId: "4", name: "Lookup Anything", fileName: "Lookup Anything", version: "1.40", optional: false, installed: "no" },
      { modId: "5", fileId: "5", name: "Prettier Paths", fileName: "Prettier Paths", version: "1.0", optional: true, installed: "no" },
      { modId: "6", fileId: "6", name: "Night Sky", fileName: "Night Sky", version: "0.9", optional: true, installed: "no" },
    ],
    external: [],
  }),
  installCollection: async (_id: GameId, _slug: string, fileIds: string[]) => ({ added: fileIds.length, external: [] }),
  status: async (id: GameId): Promise<GameStatus> =>
    id === "sims4" ? { updates: 2, requirements: 1, loadOrder: 0, crashes: 1, health: 0, clashes: clashesFor(id).filter((c) => c.severity === "error" && !c.hidden).length } : id === "skyrimse" ? { updates: 0, requirements: 2, loadOrder: 2, crashes: 0, health: 1 } : { updates: 0, requirements: 0, loadOrder: id === "rimworld" ? modOrderNow(id).entries.filter((e) => e.problems.length).length : 0, crashes: 0, health: 0 },
  health: async (id: GameId): Promise<GameHealthIssue[]> =>
    id === "skyrimse" ? [{ id: "orphan-archives", severity: "warn", title: "1 archive won't load", detail: "The game only loads an archive when a plugin of the same name does.", files: ["Data/LonelyTextures.bsa"], fix: null }] : [],
  healthFix: async () => ({ done: "Fixed." }),
  conflicts: async (id: GameId): Promise<GameConflict[]> =>
    id === "skyrimse"
      ? [{ id: "m:skyui+m:weather", mods: [{ id: "m:skyui", name: "SkyUI" }, { id: "m:weather", name: "Obsidian Weathers" }], files: ["Data/interface/skyui/config.txt"], live: "m:weather", suggested: "m:weather", reason: "Updated most recently (3 Nov 2026)", chosen: false }]
      : [],
  chooseConflict: async () => [],
  clashes: async (id: GameId) => clashesFor(id),
  hideClash: async (id: GameId, clashId: string, hidden: boolean) => {
    if (hidden) hiddenClashes.add(clashId);
    else hiddenClashes.clear();
    return clashesFor(id);
  },
  clashLoadAfter: async (id: GameId, name: string) => {
    hiddenClashes.add(clashesFor(id).find((c) => c.kind === "records" && c.mods.some((m) => m.name === name))?.id ?? "");
    return clashesFor(id);
  },
  ccList: async () => CC.map((item) => ({ ...item })),
  ccPictures: async (rels: string[]) => Object.fromEntries(rels.map((rel) => [rel, CC_PICTURES[rel] ? { src: CC_PICTURES[rel], alpha: null } : null])),
  ccReveal: async () => {},
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
  // The real search, run by the preview's dev server (vite.web.config.ts); offline, the samples.
  findGames: async (query: string, page = 0, source: GameFindSource = "all", filters: GameFindFilters = {}): Promise<GameFindResult> => {
    const here = (game: Omit<GameFound, "existing"> & { existing?: string | null }) =>
      GAMES.find((g) => g.name === game.name || (g.steamAppId && g.steamAppId === game.steamAppId))?.id ??
      (game.existing && GAMES.some((g) => g.id === game.existing) ? game.existing : null);
    try {
      const response = await fetch(`/__games/find?${new URLSearchParams({
        q: query,
        page: String(page),
        source,
        ...(filters.price ? { price: filters.price } : {}),
        ...(filters.sort ? { sort: filters.sort } : {}),
        ...(filters.mac ? { mac: "1" } : {}),
      })}`);
      if (!response.ok) throw new Error(String(response.status));
      const result = (await response.json()) as GameFindResult;
      return { ...result, results: result.results.map((game) => ({ ...game, existing: here(game) })) };
    } catch {
      const words = query.trim().toLowerCase();
      const all = FOUND_SAMPLE.filter((game) => !words || game.name.toLowerCase().includes(words)).map((game) => ({ ...game, existing: here(game) }));
      const pageCount = Math.max(1, Math.ceil(all.length / 12));
      const at = Math.min(page, pageCount - 1);
      return { results: all.slice(at * 12, at * 12 + 12), page: at, pageCount, total: all.length, warnings: [], source };
    }
  },
  // Any game opens straight to a page of its own; it's kept once its folder is set.
  openGame: async (entry: Partial<GameFound>) => {
    const name = entry.name ?? "Game";
    const already = GAMES.find((g) => g.name === name || (entry.steamAppId && g.steamAppId === entry.steamAppId));
    if (already) return already.id;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = entry.steamAppId ? `steam-${entry.steamAppId}` : entry.nexus ? `nexus-${entry.nexus}` : `custom-${slug}`;
    GAMES.push({
      id, name, colour: "#64748b", tagline: "Mods from Steam Workshop, Nexus Mods and CurseForge", found: Boolean(entry.installed), gameDir: null, docsDir: null,
      source: entry.installed ? "Steam (sample)" : null, chosen: false, windowsOnly: false, nexus: entry.nexus ?? null,
      curseforge: entry.curseforge ?? null, steamAppId: entry.steamAppId ?? null, modCount: 0, updated: null,
      generic: true, visiting: true, modsDir: null, modsChosen: false, launchExe: null, art: entry.art ?? null,
    });
    return id;
  },
  getOnSteam: async (steamAppId: string) => {
    window.open(`https://store.steampowered.com/app/${steamAppId}/`, "_blank", "noopener");
  },
  // Real news and DLC through the preview's dev server; nothing offline.
  storeInfo: async (id: GameId): Promise<GameStoreInfo> => {
    const appId = GAMES.find((g) => g.id === id)?.steamAppId ?? null;
    const none: GameStoreInfo = { steamAppId: appId, price: null, news: [], dlc: [], dlcCount: 0, storeUrl: null };
    if (!appId) return none;
    try {
      const response = await fetch(`/__games/store?${new URLSearchParams({ appid: appId })}`);
      return response.ok ? ((await response.json()) as GameStoreInfo) : none;
    } catch {
      return none;
    }
  },
  removeGame: async (id: GameId) => {
    const at = GAMES.findIndex((g) => g.id === id && g.custom);
    if (at >= 0) GAMES.splice(at, 1);
  },
  chooseModsDir: async () => null,
  forgetModsDir: async () => null,
  chooseLaunch: async () => null,
  forgetLaunch: async () => null,
  art: async (ids: GameId[]) =>
    Object.fromEntries(ids.map((id) => [id, GAMES.find((g) => g.id === id)?.steamAppId ? steamHeader(GAMES.find((g) => g.id === id)!.steamAppId!) : null])),
  chooseDocs: async () => null,
  openFolder: async () => {},
  onLaunchProgress: (callback: (event: GameLaunchProgress) => void) => {
    launchListeners.add(callback);
    return () => { launchListeners.delete(callback); };
  },
  launch: async (id: GameId, options?: { safe?: boolean }) => {
    await launchStage(id, "checking");
    await launchStage(id, "backup");
    await launchStage(id, "starting");
    if (failNextPreviewLaunch) {
      failNextPreviewLaunch = false;
      throw new Error("Simulated Steam handoff failure. No game was launched. Retry to test recovery.");
    }
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
    const lists = sources.map((source) => sampleMods(game, source, options.query ?? "", options.page ?? 0).slice(0, sources.length > 1 ? 7 : 12));
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
  // As the desktop app: Steam's signed-in player for games found in Steam, else where sign-in happens.
  openAccount: async (provider: NonNullable<GameStoreAccount["store"]>) => {
    if (provider === "steam") throw new Error("Opening the Steam app is available in the desktop launcher. Open Steam manually while using this web preview.");
    const urls = { ea: "https://myaccount.ea.com/", epic: "https://www.epicgames.com/account/personal", gog: "https://www.gog.com/account/settings/security", rockstar: "https://signin.rockstargames.com/signin/user-form" };
    window.open(urls[provider], "_blank", "noopener,noreferrer");
  },
  account: async (id: GameId): Promise<GameStoreAccount> => {
    const game = GAMES.find((entry) => entry.id === id);
    if (!game?.gameDir) return { store: null, storeName: null, name: null, how: "Find the game on this computer to see how it signs in." };
    if (/steamapps/i.test(game.gameDir)) {
      return { store: "steam", storeName: "Steam", name: "PreviewSteamPlayer", how: "Last-used local Steam profile, not a verified live session. Sign in or switch accounts in Steam before playing." };
    }
    return { store: "ea", storeName: "EA app", name: null, how: "The EA app handles sign-in. Sign in there to play." };
  },

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
  modOrder: async (id: GameId) => modOrderNow(id),
  setModOrder: async (id: GameId, entries: { id: string; active: boolean }[]) => {
    modOrders[id] = entries.map((e) => ({ ...modOrders[id]!.find((m) => m.id === e.id)!, active: e.active }));
    return modOrderNow(id);
  },
  fixModOrder: async (id: GameId) => {
    const before = modOrderNow(id).fix;
    const list = modOrders[id]!.map((m) => (m.id === "unlimitedhugs.hugslib" ? { ...m, active: true } : m));
    const harmony = list.find((m) => m.id === "brrainz.harmony")!;
    const hugs = list.find((m) => m.id === "unlimitedhugs.hugslib")!;
    const rest = list.filter((m) => m !== harmony && m !== hugs);
    modOrders[id] = [rest[0], harmony, hugs, ...rest.slice(1).filter((m) => m.active), ...rest.slice(1).filter((m) => !m.active)];
    return { ...modOrderNow(id), done: before };
  },
  setLoadOrder: async (_id: GameId, entries: { name: string; active: boolean }[]): Promise<GameLoadOrder> => {
    skyrimOrder = entries.map((e) => ({ ...skyrimOrder.find((p) => p.name === e.name)!, active: e.active }));
    return orderNow();
  },
  lootPlan: async () => ({
    moved: [
      { name: "SkyUI_SE.esp", group: "Fixes", after: [] },
      { name: "Obsidian Weathers.esp", group: "default", after: [] },
    ],
    fetchedAt: Date.now(),
    loops: [],
  }),
  lootSort: async () => {
    const previous = skyrimOrder.map((p) => ({ name: p.name, active: p.active }));
    const sky = skyrimOrder.find((p) => p.name === "SkyUI_SE.esp")!;
    skyrimOrder = [sky, ...skyrimOrder.filter((p) => p !== sky)];
    return { ...orderNow(), previous, moved: [{ name: "SkyUI_SE.esp", group: "Fixes", after: [] }] };
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
  queue: async (): Promise<GameQueue> => queueSnap(),
  queueAdd: async (list: GameQueueAdd[]) => {
    for (const item of list) queueItems.push({ ...item, id: `q${Date.now()}${Math.random()}`, status: queueItems.some((i) => i.status === "website") ? "waiting" : "website" });
    emitQueue();
    return list.length;
  },
  queueControl: async (action: string) => {
    const current = queueItems.find((i) => i.status === "website");
    if (action === "skip" && current) {
      current.status = "done";
      const next = queueItems.find((i) => i.status === "waiting");
      if (next) next.status = "website";
    }
    if (action === "stop") queueItems.forEach((i) => (i.status === "waiting" || i.status === "website") && (i.status = "skipped"));
    if (action === "clear") queueItems.splice(0, queueItems.length, ...queueItems.filter((i) => i.status === "waiting" || i.status === "website"));
    emitQueue();
    return queueSnap();
  },
  onQueue: (callback: (q: GameQueue) => void) => {
    queueListeners.add(callback);
    return () => queueListeners.delete(callback);
  },
  onModsChanged: () => () => {},
  onProgress: () => () => {},
  onNxm: () => () => {},
};
