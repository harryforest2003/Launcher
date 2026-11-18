/**
 * Browser stand-in for the Electron preload bridges (electron/preload.cjs).
 *
 * `npm run web` injects this file ahead of src/main.tsx (see vite.web.config.ts),
 * so the real launcher UI can run on localhost with no Electron process. It never
 * touches instances, accounts or files on disk. Public version and Modrinth data
 * is fetched live when reachable; everything else is simulated in memory and kept
 * in localStorage. It is not loaded by `npm run electron:dev` or production builds.
 */

import { gamesBridge } from "./gamesMock";
import { createCatalog } from "../../electron/shared/catalog.mjs";
import { curseForgeType, modrinthType } from "../../electron/shared/contentTypes.mjs";

/* The real bridges are loosely typed JSON over IPC, and this mirrors them. */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare const __WEB_PREVIEW_HAS_CURSEFORGE__: boolean;

type AnyFn = (...args: any[]) => any;
type Listener = (data: any) => void;

const STORAGE_KEY = "unity-web-preview-state";
const PLAYER_NAME = "PreviewPlayer";

type PreviewAccount = { name: string; uuid: string };

type PreviewState = {
  instances: Instance[];
  mods: Record<string, InstanceMod[]>;
  settings: LauncherSettings;
  /** Simulated sign-ins: "Add another account" adds the next name. */
  accounts: PreviewAccount[];
  /** The active account's uuid. */
  active: string | null;
  hasNexusKey: boolean;
};

// Names for the simulated accounts, in the order they're added.
const PREVIEW_PLAYERS = [PLAYER_NAME, "PreviewAlex", "PreviewSam", "PreviewRiley"];

function sampleMod(name: string, fileName: string, size: number, enabled = true): InstanceMod {
  return {
    type: "mod",
    world: null,
    kind: "file",
    fileName,
    actualFileName: enabled ? fileName : `${fileName}.disabled`,
    name,
    enabled,
    size,
    modified: "2026-10-28T18:12:00.000Z",
    source: "modrinth",
    projectId: null,
    versionNumber: null,
    installedAt: "2026-10-28T18:12:00.000Z",
    iconUrl: null,
  };
}

function initialState(): PreviewState {
  return {
    instances: [
      {
        name: "Fabric 26.2",
        version: "26.2",
        loader: "fabric",
        loaderVersion: "0.19.3",
        ram: 8,
        created: "2026-10-12T20:00:00.000Z",
        lastPlayed: "2026-11-04T21:15:00.000Z",
        gameDirectory: "/preview/instances/Fabric 26.2",
        installed: true,
        running: false,
        jvmArgs: "",
        notes: "Sample instance for the web preview.",
        folder: "Fabric 26.2",
      },
      {
        name: "All The Mods",
        version: "1.21.1",
        loader: "neoforge",
        loaderVersion: "21.1.77",
        ram: 12,
        created: "2026-08-20T22:00:00.000Z",
        gameDirectory: "/preview/instances/All The Mods",
        installed: true,
        running: false,
        folder: "All The Mods",
      },
    ],
    mods: {
      "Fabric 26.2": [
        sampleMod("Fabric API", "fabric-api.jar", 2_310_000),
        sampleMod("Sodium", "sodium-fabric.jar", 1_240_000),
        sampleMod("Iris Shaders", "iris-fabric.jar", 2_680_000, false),
      ],
      "All The Mods": [sampleMod("JEI", "jei.jar", 1_620_000)],
    },
    settings: {
      defaultRam: 8,
      javaPath: "",
      jvmArgs: "",
      javaTuning: "performance",
      closeOnLaunch: false,
      showSnapshots: false,
      cloudFolder: "",
      downloadConcurrency: 8,
      system: {
        totalRamGb: 32,
        maxRecommendedGb: 24,
        platform: "darwin",
        arch: "arm64",
      },
    },
    accounts: [],
    active: null,
    hasNexusKey: false,
  };
}

function loadState(): PreviewState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { account, ...rest } = JSON.parse(saved);
      const loaded: PreviewState = { ...initialState(), ...rest };
      // Saved before there could be several accounts.
      if (account && !rest.accounts) Object.assign(loaded, { accounts: [account], active: account.uuid });
      // No game outlives the page: timers that would close them are gone.
      loaded.instances = loaded.instances.map((instance) => ({ ...instance, running: false, playingAs: null }));
      return loaded;
    }
  } catch {
    // Storage can be blocked or hold old data; start from the samples instead.
  }
  return initialState();
}

const state = loadState();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The preview still works for this page load without storage.
  }
}

/* ---------------- events ---------------- */

const listeners: Record<string, Set<Listener>> = {};

function subscribe(channel: string, callback: Listener) {
  (listeners[channel] ??= new Set()).add(callback);
  return () => {
    listeners[channel]?.delete(callback);
  };
}

function emit(channel: string, data: unknown) {
  listeners[channel]?.forEach((callback) => callback(data));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function simulateInstall(name: string, stages: string[]) {
  for (let i = 0; i < stages.length; i += 1) {
    emit("instance:progress", {
      name,
      stage: stages[i],
      percent: Math.round(((i + 1) / stages.length) * 100),
      detail: "Simulated in the web preview",
    });
    await wait(350);
  }
}

/* ---------------- live public data, with offline fallbacks ---------------- */

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json() as Promise<T>;
}

async function liveOr<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch (err) {
    console.warn("[web preview] using sample data:", err);
    return fallback;
  }
}

const FALLBACK_VERSIONS = ["26.2", "26.1", "1.21.11", "1.21.10", "1.21.8", "1.21.5", "1.21.4", "1.21.1", "1.20.6", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2"].map(
  (id) => ({ id, type: "release" })
);

const SAMPLE_HITS = [
  ["sodium", "Sodium", "A modern rendering engine for Minecraft."],
  ["fabric-api", "Fabric API", "Core library for Fabric mods."],
  ["iris", "Iris Shaders", "A shaders mod compatible with OptiFine packs."],
].map(([id, title, description]) => ({
  project_id: id,
  slug: id,
  title,
  description,
  author: "sample",
  downloads: 1_000_000,
  icon_url: null,
  date_created: "2026-01-01T00:00:00.000Z",
  project_type: "mod",
  all_project_types: ["mod"],
}));

const webCatalog = createCatalog({
  modrinth: (path: string) =>
    liveOr<any>(
      `https://api.modrinth.com/v2${path}`,
      path.startsWith("/search") ? { hits: SAMPLE_HITS, total_hits: SAMPLE_HITS.length } : []
    ),
  curseforge: async (path: string) => {
    if (!__WEB_PREVIEW_HAS_CURSEFORGE__) {
      throw Object.assign(new Error("This web preview can't read the key saved in the desktop app. To use CurseForge here, set CURSEFORGE_API_KEY in .env.local."), {
        code: "NO_API_KEY",
      });
    }
    return curseForgeGet<any>(path);
  },
});

/* The dev server adds the key to these requests, so the page never sees it. */
async function curseForgeGet<T>(path: string): Promise<T> {
  return fetchJson<T>(`/curseforge-api/v1${path}`);
}

async function getProject(source: string, id: string) {
  if (source !== "modrinth") {
    if (!__WEB_PREVIEW_HAS_CURSEFORGE__) return null;

    try {
      const [project, description] = await Promise.all([
        curseForgeGet<{ data: any }>(`/mods/${id}`),
        curseForgeGet<{ data: string }>(`/mods/${id}/description`).catch(() => null),
      ]);
      const p = project.data;
      return {
        source: "curseforge",
        installable: p.allowModDistribution !== false,
        url: p.links?.websiteUrl ?? null,
        id: p.id,
        title: p.name,
        description: p.summary,
        body: description?.data || p.summary,
        icon: p.logo?.url,
        downloads: p.downloadCount,
        followers: p.thumbsUpCount,
        type: curseForgeType(p.classId),
        created: p.dateCreated,
        updated: p.dateModified,
        website: p.links?.websiteUrl ?? null,
        authors: (p.authors ?? []).map((a: any) => a.name),
        gallery: p.screenshots ?? [],
        minecraftVersions: [],
        loaders: [],
        versions: [],
      };
    } catch (err) {
      console.warn("[web preview] project lookup failed:", err);
      return null;
    }
  }

  try {
    const base = `https://api.modrinth.com/v2/project/${id}`;
    const [project, versions, members] = await Promise.all([
      fetchJson<any>(base),
      fetchJson<any[]>(`${base}/version`),
      fetchJson<any[]>(`${base}/members`),
    ]);

    return {
      source: "modrinth",
      id: project.id,
      title: project.title,
      description: project.description,
      body: project.body,
      icon: project.icon_url,
      downloads: project.downloads,
      followers: project.followers,
      installable: true,
      url: `https://modrinth.com/project/${project.slug}`,
      type: modrinthType(project),
      created: project.published,
      updated: project.updated,
      website: project.source_url ?? project.wiki_url ?? null,
      author: members[0]?.user?.username,
      authors: members.map((m) => m.user?.username),
      team: members,
      gallery: project.gallery ?? [],
      minecraftVersions: project.game_versions ?? [],
      loaders: [...new Set(versions.flatMap((v) => v.loaders ?? []))],
      versions,
    };
  } catch (err) {
    console.warn("[web preview] project lookup failed:", err);
    return null;
  }
}

/** A plain generated skin, because Mojang's profile APIs block browser requests. */
function makeSampleSkin() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const fill = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  fill("#c9a27e", 0, 0, 32, 16); // head
  fill("#2a1b4d", 8, 0, 8, 8);
  fill("#2a1b4d", 0, 8, 32, 2);
  fill("#a855f7", 10, 12, 1, 1); // eyes
  fill("#a855f7", 13, 12, 1, 1);
  fill("#15131c", 16, 16, 24, 16); // torso
  fill("#6d28d9", 20, 20, 8, 1);
  fill("#15131c", 40, 16, 16, 16); // arms
  fill("#15131c", 32, 48, 16, 16);
  fill("#232033", 0, 16, 16, 16); // legs
  fill("#232033", 16, 48, 16, 16);

  return canvas.toDataURL("image/png");
}

/* ---------------- bridges ---------------- */

function sameItem(item: InstanceMod, ref: ContentRef) {
  return (
    (item.type ?? "mod") === ref.type &&
    item.fileName === ref.fileName &&
    (item.world ?? null) === (ref.world ?? null)
  );
}

function findInstance(name: string) {
  const instance = state.instances.find((i) => i.name === name);
  if (!instance) throw new Error(`No instance named "${name}" in the web preview.`);
  return instance;
}

const activeAccount = () => state.accounts.find((account) => account.uuid === state.active) ?? null;

// Each simulated game closes itself after a while, unless stopped first.
const GAME_MS = 60_000;
const closing = new Map<string, ReturnType<typeof setTimeout>>();

function endGame(name: string) {
  clearTimeout(closing.get(name));
  closing.delete(name);
  const instance = state.instances.find((i) => i.name === name);
  if (instance) Object.assign(instance, { running: false, playingAs: null });
  persist();
  emit("instance:exit", { name, code: 0 });
}

/* As the desktop app: any instance alongside others, each as a signed-in account, one game per account. */
async function launch(nameOrInstance: string | { name: string }, accountId?: string) {
  const name = typeof nameOrInstance === "string" ? nameOrInstance : nameOrInstance.name;
  const instance = findInstance(name);
  if (instance.running) throw new Error(`"${name}" is already running.`);

  const account = accountId ? state.accounts.find((entry) => entry.uuid === accountId) : activeAccount();
  if (accountId && !account) throw new Error("That account isn't signed in any more.");
  const busy = account && state.instances.find((other) => other.running && other.playingAs?.id === account.uuid);
  if (account && busy) {
    throw new Error(
      `${account.name} is already playing "${busy.name}". Minecraft allows one game per account at a time, so play this one as another account, or close "${busy.name}" first.`
    );
  }

  const player = account ? { id: account.uuid, name: account.name } : null;
  Object.assign(instance, { running: true, playingAs: player, lastPlayed: new Date().toISOString() });
  persist();

  emit("instance:log", { name, text: "[web preview] Minecraft was not started.\n" });
  emit("instance:started", { name, account: player });
  closing.set(name, setTimeout(() => endGame(name), GAME_MS));

  return {
    launched: true,
    name,
    pid: 0,
    online: Boolean(account),
    playerName: account?.name ?? PLAYER_NAME,
    account: player,
  };
}

function playing() {
  return Object.fromEntries(state.instances.filter((i) => i.running).map((i) => [i.name, i.playingAs ?? null]));
}

// A short stand-in for the starter mods list, which lives in the desktop app's profile.
const PREVIEW_STARTER_MODS: StarterMod[] = [
  { source: "modrinth", projectId: "AANobbMI", name: "Sodium", type: "mod", enabled: true },
  { source: "modrinth", projectId: "gvQqBUqZ", name: "Lithium", type: "mod", enabled: true },
  { source: "modrinth", projectId: "mOgUt4GM", name: "Mod Menu", type: "mod", enabled: true },
];
let previewStarterMods = PREVIEW_STARTER_MODS.map((entry) => ({ ...entry }));

async function createInstance(
  config: Partial<Instance> & { name: string; version: string; starterMods?: boolean }
) {
  const { starterMods: addStarter, ...instanceConfig } = config;
  await simulateInstall(config.name, ["Fetching version data", "Downloading libraries", "Downloading assets", "Finishing up"]);

  const created: Instance = {
    loader: "vanilla",
    loaderVersion: "",
    ram: state.settings.defaultRam,
    created: new Date().toISOString(),
    gameDirectory: `/preview/instances/${config.name}`,
    installed: true,
    running: false,
    folder: config.name,
    ...instanceConfig,
  };

  state.instances.unshift(created);
  state.mods[created.name] = [];
  persist();

  const starter: StarterSummary | null =
    addStarter === false
      ? null
      : {
          added: previewStarterMods.filter((entry) => entry.enabled).map((entry) => entry.name),
          dependencies: [],
          unavailable: [],
          failed: [],
        };

  return { ...created, starter };
}

function previewAccounts() {
  return state.accounts.map((account) => ({ ...account, skin: null, savedAt: new Date().toISOString(), active: account.uuid === state.active }));
}

// Each sign-in adds the next simulated player and makes it active, as Microsoft's would.
async function signIn() {
  const n = state.accounts.length;
  const account = {
    name: PREVIEW_PLAYERS[n] ?? `${PLAYER_NAME}${n + 1}`,
    uuid: (n + 1).toString(16).padStart(32, "0"),
  };
  state.accounts = [...state.accounts, account];
  state.active = account.uuid;
  persist();

  return { ...account, skin: makeSampleSkin() };
}

function removePreviewAccount(uuid: string | null) {
  state.accounts = state.accounts.filter((account) => account.uuid !== uuid);
  if (state.active === uuid) state.active = state.accounts[state.accounts.length - 1]?.uuid ?? null;
  persist();
  return previewAccounts();
}

const launcherBridge = {
  loginMicrosoft: signIn,
  getInstances: async () => state.instances,
  launchInstance: launch,
  getInstancesStorage: async () => 790 * 1024 * 1024,
  getMinecraftVersions: () => getVersions(),
  getFabricVersions: (version: string) =>
    liveOr(`https://meta.fabricmc.net/v2/versions/loader/${version}`, [{ loader: { version: "0.19.3" } }]),
  getQuiltVersions: (version: string) =>
    liveOr(`https://meta.quiltmc.org/v3/versions/loader/${version}`, [{ loader: { version: "0.29.2" } }]),
  // Forge and NeoForge version lists do not allow browser requests.
  getForgeVersions: async () => [{ version: "sample-forge" }],
  getNeoForgeVersions: async () => [{ version: "sample-neoforge" }],
  getLoaders: async () => [
    { id: "vanilla", name: "Vanilla" },
    { id: "fabric", name: "Fabric" },
    { id: "forge", name: "Forge" },
    { id: "neoforge", name: "NeoForge" },
    { id: "quilt", name: "Quilt" },
  ],
  getProject,
  browseCatalog: (options: CatalogQuery) => webCatalog.browse(options),
  resolveProjectLink: (link: object) => webCatalog.resolveProjectLink(link),
  searchPlayers: async (query: string) =>
    query.trim()
      ? [
          {
            username: query.trim(),
            uuid: "00000000000000000000000000000000",
            skin: makeSampleSkin(),
            slim: false,
          },
        ]
      : [],
};

async function getVersions() {
  const manifest = await liveOr<{ versions: { id: string; type: string }[] }>(
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    { versions: FALLBACK_VERSIONS }
  );
  return manifest.versions;
}

const instanceBridge = {
  list: async () => state.instances,
  get: async (name: string) => findInstance(name),
  create: createInstance,
  starterModsList: async () => previewStarterMods,
  starterModsSave: async (list: StarterMod[]) => (previewStarterMods = list.map((entry) => ({ ...entry }))),
  starterModsAdd: async (project: Omit<StarterMod, "enabled">) =>
    (previewStarterMods = [...previewStarterMods, { ...project, enabled: true }]),
  starterModsReset: async () => (previewStarterMods = PREVIEW_STARTER_MODS.map((entry) => ({ ...entry }))),
  repair: async (name: string) => {
    await simulateInstall(name, ["Checking files", "Repairing files"]);
    return findInstance(name);
  },
  remove: async (name: string) => {
    state.instances = state.instances.filter((i) => i.name !== name);
    delete state.mods[name];
    persist();
    return { deleted: name };
  },
  launch,
  stop: async (name: string) => {
    if (!findInstance(name).running) throw new Error(`"${name}" is not running.`);
    endGame(name);
    return { stopped: name };
  },
  playing: async () => playing(),
  openFolder: async (name: string) => `/preview/instances/${name}`,

  content: async (name: string) => {
    const items = (state.mods[name] ?? []).map((item) => ({ ...item, type: item.type ?? "mod" }));
    const ofType = (type: ContentType) => items.filter((item) => item.type === type);
    return {
      mod: ofType("mod"),
      resourcepack: ofType("resourcepack"),
      shader: ofType("shader"),
      datapack: ofType("datapack"),
      worlds: ["Survival", "Creative test"],
    };
  },
  contentToggle: async (name: string, item: ContentRef, enabled: boolean) => {
    const found = (state.mods[name] ?? []).find((m) => sameItem(m, item));
    if (found) found.enabled = enabled;
    persist();
    return { fileName: item.fileName, enabled };
  },
  contentDelete: async (name: string, item: ContentRef) => {
    state.mods[name] = (state.mods[name] ?? []).filter((m) => !sameItem(m, item));
    persist();
    return { deleted: item.fileName };
  },
  copyDatapack: async (name: string, fileName: string, world: string) => {
    const found = (state.mods[name] ?? []).find((m) => m.type === "datapack" && m.fileName === fileName && !m.world);
    if (found) (state.mods[name] ??= []).push({ ...found, world });
    persist();
    return { fileName, world };
  },
  modSearch: async (name: string, options: { query?: string; type?: string; source?: string; page?: number }) => {
    const instance = findInstance(name);

    return webCatalog.browse({
      ...options,
      type: options.type || "mod",
      mcVersion: instance.version,
      loader: instance.loader,
      sort: options.query?.trim() ? "relevance" : "downloads",
    });
  },
  modInstall: async (payload: {
    name: string;
    modName: string;
    source?: string;
    projectId?: string;
    iconUrl?: string | null;
    type?: ContentType;
    world?: string;
  }) => {
    const type = payload.type ?? "mod";
    const extension = type === "mod" ? "jar" : "zip";
    const fileName = `${payload.modName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${extension}`;
    const world = type === "datapack" ? (payload.world ?? null) : null;

    (state.mods[payload.name] ??= []).push({
      ...sampleMod(payload.modName, fileName, 1_000_000),
      type,
      world,
      source: payload.source ?? null,
      projectId: payload.projectId ?? null,
      iconUrl: payload.iconUrl ?? null,
    });
    persist();

    const folders: Record<ContentType, string> = {
      mod: "mods",
      resourcepack: "resourcepacks",
      shader: "shaderpacks",
      datapack: world ? `saves/${world}/datapacks` : "datapacks",
    };
    return { fileName, name: payload.modName, type, world, folder: folders[type], dependencies: [] };
  },
  update: async (name: string, patch: Partial<Instance>) => {
    Object.assign(findInstance(name), patch);
    persist();
    return findInstance(name);
  },
  installModpack: async (payload: { name?: string }) => {
    const created = await createInstance({
      name: payload.name ?? "Sample modpack",
      version: "1.21.1",
      loader: "fabric",
      loaderVersion: "0.19.3",
    });
    return {
      ...created,
      pack: { name: created.name, version: "1.0.0", fileCount: 0, blocked: [], failed: 0 },
    };
  },

  // Native file dialogs have no browser equivalent here, so they act as cancelled.
  scanLaunchers: async () => [],
  pickFolder: async () => null,
  pickZip: async () => null,
  importInstance: async () => {
    throw new Error("Importing needs the desktop app.");
  },
  importModpackFile: async () => {
    throw new Error("Importing needs the desktop app.");
  },

  cloudDetect: async () => [
    { id: "icloud", label: "iCloud Drive", path: "/preview/iCloud Drive/Unity" },
  ],
  cloudPickFolder: async () => null,
  cloudSetFolder: async (folder: string) => {
    state.settings.cloudFolder = folder;
    persist();
    return folder;
  },
  cloudList: async () => ({ folder: state.settings.cloudFolder, instances: [] }),
  cloudExport: async (name: string) => ({
    path: `${state.settings.cloudFolder || "/preview/cloud"}/${name}.zip`,
    files: 0,
    bytes: 0,
  }),
  cloudImport: async () => {
    throw new Error("Cloud import needs the desktop app.");
  },

  getSettings: async () => state.settings,
  setSettings: async (patch: Partial<LauncherSettings>) => {
    state.settings = { ...state.settings, ...patch };
    persist();
    return state.settings;
  },
  pickJava: async () => null,
  githubReleases: async () => {
    throw new Error("GitHub installs need the desktop app.");
  },
  githubInstall: async () => {
    throw new Error("GitHub installs need the desktop app.");
  },
  getApiKeys: async () => ({
    curseforge: { set: __WEB_PREVIEW_HAS_CURSEFORGE__, fromEnvironment: __WEB_PREVIEW_HAS_CURSEFORGE__ },
    nexus: { set: state.hasNexusKey, fromEnvironment: false },
    github: { set: false, fromEnvironment: false },
    modrinth: { set: false, fromEnvironment: false },
  }),
  // A browser has no keychain, so the preview never holds a key itself.
  setApiKey: async () => {
    throw new Error("Keys can only be saved in the desktop app. For this preview, use .env.local.");
  },
  getAccount: async () => activeAccount(),
  clearAccount: async () => {
    removePreviewAccount(state.active);
    return true;
  },
  listAccounts: async () => previewAccounts(),
  switchAccount: async (uuid: string) => {
    if (!state.accounts.some((account) => account.uuid === uuid)) throw new Error("That account isn't signed in any more.");
    state.active = uuid;
    persist();
    return previewAccounts();
  },
  removeAccount: async (uuid: string) => removePreviewAccount(uuid),

  // Files, logs, Java, updates and exports belong to the desktop app; the preview shows
  // them empty.
  worlds: async () => [],
  screenshots: async () => [],
  fileAction: async () => {
    throw new Error("Files can only be opened in the desktop app.");
  },
  duplicate: async () => {
    throw new Error("Copying an instance needs the desktop app.");
  },
  log: async () => ({ source: "none", running: false, startedAt: null, endedAt: null, exitCode: null, lines: [] }),
  crashHelp: async () => ({ crashed: false }),
  openLogFile: async () => {},
  pickInstanceJava: async () => null,
  javaInfo: async () => ({ component: "java-runtime-delta", majorVersion: 21, downloaded: false }),
  javaRuntimes: async () => [],
  contentDetails: async () => ({}),
  checkUpdates: async () => ({ checked: 0, identified: 0, updates: [], status: {} }),
  applyUpdates: async () => ({ updated: [], skipped: [], failed: [], batch: null, dependencies: [], missingDependencies: [], disabledDependencies: [] }),
  versions: async () => ({ name: "", versions: [] }),
  versionChangelog: async () => "",
  installVersion: async () => ({ updated: [], skipped: [], failed: [], batch: null, dependencies: [], missingDependencies: [], disabledDependencies: [] }),
  lastUpdate: async () => null,
  undoUpdate: async () => ({ restored: [] }),
  optimiseCheck: async () => ({
    hardware: { gpu: "Intel Iris Plus Graphics", builtIn: true, weak: true, retina: true, memoryGb: 16, cores: 8 },
    running: false,
    undo: null,
    items: [
      {
        id: "mods",
        state: "fix",
        title: "Speed mods",
        detail: "One speed mod is missing. Each is checked against your other mods before it goes in.",
        list: [{ label: "retiNO", text: "Draws at normal resolution on the Retina screen instead of four times the pixels: slightly softer, much faster" }],
        action: "Add retiNO",
      },
      {
        id: "fps",
        state: "fix",
        title: "Frame rate limits",
        detail: "3 things are holding your frame rate down. Turn off any of them here.",
        fixes: [
          { id: "maxFps", label: "Minecraft's Max Framerate", text: "75 FPS", action: "Set to Unlimited", recommended: true },
          { id: "smartfps", label: "Smart FPS Booster", text: "Battery Saver profile, which aims for a steady 30 FPS", action: "Switch to Max FPS", recommended: true },
          { id: "fpsreducer", label: "FPS Reducer", text: "drops to 30 FPS after 1 minute without input, to 10 after 10, and in menus", action: "Turn off", recommended: true },
          { id: "afk", label: "Minecraft's inactivity limit", text: "drops the frame rate when you've not touched anything for a minute", action: "Only when minimised", recommended: false },
          { id: "dynamicfps", label: "Dynamic FPS", text: "slows the game only while it's in the background or hidden, which keeps your computer cool", action: "Turn off", recommended: false },
        ],
      },
      { id: "shaders", state: "ok", title: "Shaders", detail: "Shaders are off." },
      {
        id: "java",
        state: "fix",
        title: "Java settings",
        detail: "How much memory Minecraft has, and how it cleans up after itself. The default cleaning causes stutters.",
        list: [{ label: "Garbage collection", text: "Java's default → Minecraft Launcher's (fewer stutters)" }],
        action: "Use these",
      },
      { id: "graphics", state: "ok", title: "Graphics settings", detail: "Already set for speed." },
      {
        id: "heavy",
        state: "tip",
        title: "Heavy mods",
        detail: "These cost the most speed. Turn off any you're not using in the Content tab: a mod that's off keeps its settings for when you turn it back on.",
        list: [
          { label: "Essential", text: "runs cosmetics, friends and its own menus in the background" },
          { label: "Axiom", text: "a building editor that's always running; turn it off when you're not building" },
        ],
      },
      {
        id: "packs",
        state: "tip",
        title: "Resource packs",
        detail: "7 packs are on. Large ones take memory and can cause stutters; turn off any you don't need in Options → Resource Packs.",
        list: [
          { label: "lf skins", text: "89 MB" },
          { label: "Cyber Arsenal", text: "19 MB" },
        ],
      },
    ],
  }),
  optimiseApply: async () => ({ done: ["Simulated in the web preview."], skipped: [] }),
  optimiseUndo: async () => ({ restored: [] }),
  loaderVersions: async () => ({ loaderName: "Fabric Loader", current: "", newest: null, versions: [] }),
  planLoader: async (_name: string, version: string) => ({
    loaderName: "Fabric Loader",
    current: "",
    target: version,
    upgrade: true,
    fixes: [],
    blocking: [],
    otherUpdates: 0,
  }),
  applyLoader: async (_name: string, version: string) => ({
    loader: { name: "Fabric Loader", from: "", to: version },
    updated: [],
    skipped: [],
    failed: [],
    batch: null,
    dependencies: [],
    missingDependencies: [],
    disabledDependencies: [],
  }),
  exportModpack: async () => {
    throw new Error("Exporting a modpack needs the desktop app.");
  },

  onProgress: (callback: Listener) => subscribe("instance:progress", callback),
  onLog: (callback: Listener) => subscribe("instance:log", callback),
  onExit: (callback: Listener) => subscribe("instance:exit", callback),
  onStarted: (callback: Listener) => subscribe("instance:started", callback),
};

function sampleGame(id: string, name: string, source: string): DetectedGame {
  return {
    id,
    name,
    installPath: `/preview/games/${name}`,
    modDir: `/preview/games/${name}/Mods`,
    modDirExists: true,
    source,
    providers: {},
    modExtensions: [".zip"],
    notes: null,
    windowsOnlyModding: false,
    managedByInstances: false,
    availableProviders: [{ id: "modrinth", label: "Modrinth", ready: true }],
  };
}

const sampleGames = [
  sampleGame("stardew", "Stardew Valley", "Steam (sample)"),
  sampleGame("terraria", "Terraria", "Steam (sample)"),
  sampleGame("hytale", "Hytale", "Installed (sample)"),
];

// The supported games, as electron/mods/gameRegistry.cjs lists them.
const catalogGame = (id: string, name: string, extra: Partial<CatalogGame> = {}): CatalogGame => ({
  id, name, steamAppId: null, notOnPC: null, windowsOnly: true, providers: ["nexus"], modExtensions: [], noModFolder: false, ...extra,
});
const sampleCatalog: CatalogGame[] = [
  catalogGame("sims4", "The Sims 4", { windowsOnly: false, providers: ["curseforge", "nexus"] }),
  catalogGame("gtav", "Grand Theft Auto V"),
  catalogGame("stardew", "Stardew Valley", { windowsOnly: false, providers: ["curseforge", "nexus"] }),
  catalogGame("palworld", "Palworld", { providers: ["curseforge"] }),
  catalogGame("terraria", "Terraria", { windowsOnly: false, providers: ["curseforge"] }),
  catalogGame("skyrimse", "Skyrim Special Edition"),
  catalogGame("cyberpunk2077", "Cyberpunk 2077"),
  catalogGame("bg3", "Baldur's Gate 3", { windowsOnly: false }),
  catalogGame("valheim", "Valheim", { providers: [] }),
  catalogGame("rimworld", "RimWorld", { windowsOnly: false, providers: [] }),
  catalogGame("hytale", "Hytale", { windowsOnly: false, providers: ["curseforge", "nexus"] }),
  catalogGame("rdr2", "Red Dead Redemption 2"),
  catalogGame("rdr1", "Red Dead Redemption", { noModFolder: true }),
  catalogGame("gta6", "Grand Theft Auto VI", { providers: [], notOnPC: "Out on PS5 and Xbox Series X|S on 19 November 2026. Rockstar hasn't announced a PC version yet." }),
  catalogGame("eldenring", "Elden Ring"),
  catalogGame("witcher3", "The Witcher 3: Wild Hunt"),
  catalogGame("falloutnv", "Fallout: New Vegas"),
  catalogGame("starfield", "Starfield"),
  catalogGame("oblivionremastered", "The Elder Scrolls IV: Oblivion Remastered"),
  catalogGame("hogwartslegacy", "Hogwarts Legacy"),
  catalogGame("kcd2", "Kingdom Come: Deliverance II"),
  catalogGame("bannerlord", "Mount & Blade II: Bannerlord"),
  catalogGame("satisfactory", "Satisfactory"),
  catalogGame("ets2", "Euro Truck Simulator 2", { windowsOnly: false }),
  catalogGame("factorio", "Factorio", { windowsOnly: false, providers: [] }),
  catalogGame("sims3", "The Sims 3", { windowsOnly: false }),
  catalogGame("silksong", "Hollow Knight: Silksong", { windowsOnly: false }),
  catalogGame("wukong", "Black Myth: Wukong"),
  catalogGame("lethalcompany", "Lethal Company"),
  catalogGame("subnautica", "Subnautica", { windowsOnly: false }),
  catalogGame("schedule1", "Schedule I"),
  catalogGame("kenshi", "Kenshi"),
  catalogGame("mhwilds", "Monster Hunter Wilds"),
];

const installedGameMods: Record<string, InstalledMod[]> = {};

const modBridge = {
  getGames: async () => sampleGames,
  refreshGames: async () => sampleGames.length,
  catalog: async () => sampleCatalog,
  list: async (gameId: string) => installedGameMods[gameId] ?? [],
  setEnabled: async (gameId: string, relativePath: string, enabled: boolean) => {
    const mod = installedGameMods[gameId]?.find((m) => m.relativePath === relativePath);
    if (mod) mod.enabled = enabled;
    return { relativePath, enabled };
  },
  remove: async (gameId: string, relativePath: string) => {
    installedGameMods[gameId] = (installedGameMods[gameId] ?? []).filter(
      (m) => m.relativePath !== relativePath
    );
    return { deleted: relativePath };
  },
  openFolder: async (gameId: string) => `/preview/games/${gameId}`,
  search: async () => ({ results: [], warnings: ["Online search is off for sample games."] }),
  install: async () => {
    throw new Error("Installing mods needs the desktop app.");
  },
  installFromFile: async () => {
    throw new Error("Installing mods needs the desktop app.");
  },
  openUrl: async (url: string) => {
    window.open(url, "_blank", "noopener");
    return true;
  },
  getSettings: async () => ({ hasNexusKey: state.hasNexusKey }),
  onProgress: (callback: Listener) => subscribe("mods:progress", callback),
};

/* ---------------- skin builder, kept in this browser's IndexedDB ---------------- */

const SKIN_DB_NAME = "unity-web-preview-skins";
const SKIN_STORE = "records";

function openSkinDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SKIN_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SKIN_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function skinDbGet<T>(key: string): Promise<T | undefined> {
  const db = await openSkinDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SKIN_STORE).objectStore(SKIN_STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function skinDbChange(change: (store: IDBObjectStore) => void) {
  const db = await openSkinDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SKIN_STORE, "readwrite");
    change(transaction.objectStore(SKIN_STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

type StoredLibrary = { groups: any[]; skins: any[]; outputFolder: string };

async function readSkinLibrary(): Promise<StoredLibrary> {
  return (await skinDbGet<StoredLibrary>("library")) ?? { groups: [], skins: [], outputFolder: "" };
}

function writeSkinLibrary(library: StoredLibrary) {
  return skinDbChange((store) => store.put(library, "library"));
}

function saveToDownloads(fileName: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function thumbUrl(id: string) {
  const bytes = await skinDbGet<Uint8Array>(`${id}/thumb.png`);
  if (!bytes) return undefined;
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  });
}

const skinBuilderBridge = {
  getLibrary: async () => {
    const library = await readSkinLibrary();
    return {
      groups: library.groups,
      skins: await Promise.all(library.skins.map(async (skin) => ({ ...skin, thumb: await thumbUrl(skin.id) }))),
    };
  },
  saveSkin: async (meta: any, files: Record<string, Uint8Array>) => {
    await skinDbChange((store) => {
      for (const [name, bytes] of Object.entries(files)) store.put(bytes, `${meta.id}/${name}`);
    });
    const library = await readSkinLibrary();
    library.skins = [...library.skins.filter((skin) => skin.id !== meta.id), meta];
    await writeSkinLibrary(library);
    return { ...meta, thumb: await thumbUrl(meta.id) };
  },
  readSkinFile: async (id: string, file: string) => {
    const bytes = await skinDbGet<Uint8Array>(`${id}/${file}`);
    if (!bytes) throw new Error(`${file} is missing for this skin.`);
    return bytes;
  },
  updateSkin: async (id: string, patch: any) => {
    const library = await readSkinLibrary();
    const skin = library.skins.find((entry) => entry.id === id);
    Object.assign(skin, patch);
    await writeSkinLibrary(library);
    return skin;
  },
  deleteSkin: async (id: string) => {
    const library = await readSkinLibrary();
    library.skins = library.skins.filter((skin) => skin.id !== id);
    await writeSkinLibrary(library);
    await skinDbChange((store) => {
      for (const file of ["source.png", "mask.png", "hints.png", "texture.png", "model.json", "skin.bbmodel", "thumb.png", "glow.png", "glow_still.png"]) {
        store.delete(`${id}/${file}`);
      }
    });
  },
  createGroup: async (name: string) => {
    const library = await readSkinLibrary();
    const group = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
    library.groups.push(group);
    await writeSkinLibrary(library);
    return group;
  },
  renameGroup: async (id: string, name: string) => {
    const library = await readSkinLibrary();
    const group = library.groups.find((entry) => entry.id === id);
    group.name = name;
    await writeSkinLibrary(library);
    return group;
  },
  deleteGroup: async (id: string) => {
    const library = await readSkinLibrary();
    library.groups = library.groups.filter((group) => group.id !== id);
    for (const skin of library.skins) {
      if (skin.groupId === id) skin.groupId = null;
    }
    await writeSkinLibrary(library);
  },
  // A browser has no folder picker to remember, so packs go to its downloads.
  getOutputFolder: async () => (await readSkinLibrary()).outputFolder,
  pickOutputFolder: async () => {
    const library = await readSkinLibrary();
    library.outputFolder = "Browser downloads (web preview)";
    await writeSkinLibrary(library);
    return library.outputFolder;
  },
  writePack: async (fileName: string, bytes: Uint8Array) => {
    saveToDownloads(fileName, bytes);
    return { written: true, path: `Browser downloads/${fileName}` };
  },
  revealPath: async () => {},
  editInBlockbench: async () => {
    throw new Error("Blockbench needs the desktop app.");
  },
};

/** Anything the bridges above do not cover logs a warning instead of crashing a screen. */
function withFallback<T extends Record<string, AnyFn>>(bridgeName: string, bridge: T): T {
  return new Proxy(bridge, {
    get(target, property: string) {
      if (property in target) return target[property];
      return () => {
        if (property.startsWith("on")) return () => {};
        console.warn(`[web preview] ${bridgeName}.${property} is not simulated`);
        return Promise.resolve(undefined);
      };
    },
  });
}

function showPreviewLabel() {
  const label = document.createElement("div");
  label.dataset.webPreviewLabel = "";
  label.title = "Live versions and Modrinth search. Instances, launching and accounts are simulated.";
  label.style.cssText =
    "position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;gap:10px;align-items:center;" +
    "padding:6px 10px;border:1px solid #6d28d9;border-radius:8px;background:#161616;color:#c084fc;" +
    "font:12px system-ui,sans-serif;";
  label.textContent = "Web preview: simulated data";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  reset.style.cssText =
    "padding:0;border:0;background:none;color:#fff;font:inherit;text-decoration:underline;cursor:pointer;";
  reset.onclick = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was saved if storage is blocked.
    }
    location.reload();
  };

  label.append(reset);
  document.body.append(label);
}

const needsDesktop = async () => {
  throw new Error("Changing your skin needs the desktop app.");
};

// Nobody is signed in to Mojang in the preview, so it can show skins but not change them.
const skinBridge = {
  profile: async () => null,
  applyUrl: needsDesktop,
  pickFile: needsDesktop,
  upload: needsDesktop,
  reset: needsDesktop,
  setCape: needsDesktop,
  download: needsDesktop,
  // Two kept skins, so the favourites grid has something to show.
  saved: async () => [
    { id: "mock-saved-1", name: "Steve, kept", slim: false, savedAt: "2026-11-01T10:00:00.000Z", dataUrl: "https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb" },
    { id: "mock-saved-2", name: "Alex, kept", slim: true, savedAt: "2026-11-02T10:00:00.000Z", dataUrl: "https://textures.minecraft.net/texture/46acd06e8483b176e8ea39fc12fe105eb3a2a4970f5100057e9d84d4b60bdfa7" },
  ],
  save: needsDesktop,
  useSaved: needsDesktop,
  deleteSaved: needsDesktop,
};

/*
 * Home dashboard. Simulated play time, activity and news so the page can be built here.
 * Add ?dashboard=empty to the address to see a launcher with no history yet, or
 * ?dashboard=offline to see every news source fail.
 */
const dashboardMode = () => new URLSearchParams(location.search).get("dashboard") ?? "";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY_MS = 86_400_000;

function localDay(time: number) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* The same made-up numbers on every load: a small seeded generator, not Math.random. */
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value / 2_147_483_648;
  };
}

function previewThumb(from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function previewStats(): DashboardStats {
  const now = Date.now();
  const empty = dashboardMode() === "empty";
  const names = state.instances.map((instance) => instance.name);
  const random = seeded(26);
  const daily: DashboardDay[] = [];

  for (let i = 89; i >= 0; i--) {
    const byInstance: Record<string, number> = {};
    if (!empty && i < 70) {
      names.forEach((name, index) => {
        const chance = index === 0 ? 0.45 : 0.25;
        if (random() < chance) byInstance[name] = Math.round((20 + random() * 160) * 60);
      });
    }
    const seconds = Object.values(byInstance).reduce((sum, value) => sum + value, 0);
    // Calendar days, not 24-hour steps: a day across a clock change isn't 24 hours long.
    const day = new Date(now);
    daily.push({ date: localDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - i).getTime()), seconds, byInstance });
  }

  const instances: DashboardInstanceStat[] = state.instances.map((instance, index) => {
    const played = daily.filter((day) => day.byInstance[instance.name]);
    const seconds = played.reduce((sum, day) => sum + day.byInstance[instance.name], 0);
    return {
      name: instance.name,
      version: instance.version,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion || undefined,
      modCount: (state.mods[instance.name] ?? []).length,
      created: instance.created,
      lastPlayed: empty ? undefined : instance.lastPlayed,
      playSeconds: empty ? null : seconds,
      sessions: empty ? 0 : played.length,
      since: empty || !played.length ? undefined : played[0].date,
      // Worlds keep their own play time, which can be more than the sessions (an imported world).
      worldPlaySeconds: empty ? null : Math.round(seconds * 0.7) + (index === 0 ? 96 * 3600 : 0),
      worlds: empty ? 0 : index === 0 ? 3 : 1,
    };
  });

  const sum = (pick: (instance: DashboardInstanceStat) => number | null) => {
    const known = instances.map(pick).filter((value): value is number => value !== null);
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  };
  return {
    generatedAt: new Date(now).toISOString(),
    instances,
    totals: {
      instances: instances.length,
      mods: instances.reduce((sum, instance) => sum + instance.modCount, 0),
      playSeconds: sum((instance) => instance.playSeconds),
      sessions: instances.reduce((total, instance) => total + instance.sessions, 0),
      worldPlaySeconds: sum((instance) => instance.worldPlaySeconds),
    },
    daily,
    sources: { tracked: !empty, logs: !empty, worldStats: !empty },
    since: empty ? undefined : daily.find((day) => day.seconds > 0)?.date,
  };
}

function previewActivity(limit = 20): ActivityItem[] {
  if (dashboardMode() === "empty") return [];
  const [first = "Fabric 26.2", second = "All The Mods"] = state.instances.map((instance) => instance.name);
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const items: ActivityItem[] = [
    { at: ago(2), kind: "played", instance: first, title: `Played ${first}`, detail: "1 h 42 min" },
    { at: ago(5), kind: "mods-updated", instance: first, title: "Updated 3 mods", detail: "Sodium, Fabric API, Iris Shaders" },
    { at: ago(26), kind: "launcher-updated", title: "Launcher updated", detail: "Version 0.0.0 (simulated)" },
    { at: ago(30), kind: "crash", instance: second, title: `${second} crashed`, detail: "crash-2026-11-12_18.22.04-client.txt" },
    { at: ago(31), kind: "played", instance: second, title: `Played ${second}`, detail: "38 min" },
    { at: ago(52), kind: "mods-installed", instance: second, title: "Added 2 mods", detail: "JEI, Jade" },
    { at: ago(75), kind: "loader-updated", instance: first, title: "Loader updated", detail: "Fabric 0.19.2 to 0.19.3" },
    { at: ago(140), kind: "instance-created", instance: first, title: `Created ${first}`, detail: "Minecraft 26.2 with Fabric" },
    { at: ago(300), kind: "error", instance: second, title: "Couldn't finish installing", detail: "Simulated error message" },
  ];
  return items.slice(0, Math.max(1, Math.min(100, limit)));
}

function previewNews(): NewsResult {
  const fetchedAt = new Date().toISOString();
  if (dashboardMode() === "offline") {
    return { items: [], failed: ["Minecraft.net", "Java Edition", "Bedrock Edition", "Fabric", "NeoForge", "Forge"], fetchedAt, fromCache: false };
  }
  const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
  const sample = (
    id: string, category: NewsCategory, source: string, days: number, title: string, image: string | null, url: string,
  ): NewsItem => ({
    id, category, source, date: ago(days), title, url, image,
    summary: "Simulated summary for the web preview. The desktop app shows the real article's opening lines here.",
  });
  return {
    items: [
      sample("p1", "minecraft", "Minecraft.net", 0.5, "Sample feature article: a new drop is on the way", previewThumb("#4c1d95", "#0f172a"), "https://www.minecraft.net/en-us/articles"),
      sample("p2", "snapshot", "Java Edition", 1, "Sample snapshot notes: Minecraft 26.3 Snapshot 2", previewThumb("#1e3a8a", "#111827"), "https://www.minecraft.net/en-us/articles"),
      sample("p3", "java", "Java Edition", 4, "Sample release notes: Minecraft Java Edition 26.2.1", previewThumb("#14532d", "#111827"), "https://www.minecraft.net/en-us/articles"),
      sample("p4", "bedrock", "Bedrock Edition", 2, "Sample Bedrock update notes: 1.26.40", previewThumb("#7c2d12", "#111827"), "https://www.minecraft.net/en-us/articles"),
      sample("p5", "fabric", "Fabric", 3, "Sample Fabric post: Fabric for Minecraft 26.3", null, "https://fabricmc.net/blog/"),
      sample("p6", "neoforge", "NeoForge", 6, "Sample NeoForge news: 26.2 released", null, "https://neoforged.net/"),
      sample("p7", "forge", "Forge", 9, "Sample Forge release: Forge for 26.2", null, "https://files.minecraftforge.net/"),
      sample("p8", "minecraft", "Minecraft.net", 12, "Sample community story with a longer headline to check wrapping in small cards", previewThumb("#831843", "#111827"), "https://www.minecraft.net/en-us/articles"),
    ],
    failed: [],
    fetchedAt,
    fromCache: false,
  };
}

function previewGamingNews(): NewsResult {
  const fetchedAt = new Date().toISOString();
  if (dashboardMode() === "offline") {
    return { items: [], failed: ["PC Gamer", "Eurogamer", "Rock Paper Shotgun", "GameSpot", "IGN", "The Verge"], fetchedAt, fromCache: false };
  }
  const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
  const item = (id: string, source: string, hours: number, title: string, from: string, to: string): NewsItem => ({
    id, category: "gaming", source, date: ago(hours), title, url: "https://www.pcgamer.com/", image: previewThumb(from, to),
    summary: "Simulated gaming news for the web preview. The desktop app shows real headlines from gaming sites here.",
  });
  return {
    items: [
      item("g1", "PC Gamer", 1, "Sample headline: a big open-world sequel gets a release date", "#7c2d12", "#111827"),
      item("g2", "Eurogamer", 3, "Sample review: an indie roguelike that keeps you up all night", "#14532d", "#111827"),
      item("g3", "IGN", 5, "Sample news: a classic shooter returns with a remaster", "#1e3a8a", "#111827"),
      item("g4", "Rock Paper Shotgun", 8, "Sample feature: the best co-op games to play this weekend", "#4c1d95", "#0f172a"),
      item("g5", "GameSpot", 12, "Sample news: a surprise shadow-drop at last night's showcase", "#831843", "#111827"),
      item("g6", "The Verge", 20, "Sample story: handheld PCs keep getting better", "#0f766e", "#111827"),
    ],
    failed: [],
    fetchedAt,
    fromCache: false,
  };
}

function previewDeals(): DealsResult {
  const fetchedAt = new Date().toISOString();
  if (dashboardMode() === "offline") return { items: [], failed: ["Steam"], fetchedAt, fromCache: false };
  const deal = (id: number, name: string, percent: number, original: number, from: string, to: string, days: number): SteamDeal => ({
    id, name: `${name} (sample)`, discountPercent: percent, originalPrice: original, finalPrice: Math.round(original * (100 - percent)) / 100,
    currency: "GBP", image: previewThumb(from, to), url: `https://store.steampowered.com/app/${id}/`,
    endsAt: new Date(Date.now() + days * DAY_MS).toISOString(), platforms: { windows: true, mac: id % 2 === 0, linux: false },
  });
  return {
    items: [
      deal(1001, "Sky Forge Tactics", 60, 24.99, "#1e3a8a", "#0f172a", 2),
      deal(1002, "Hollow Lantern", 35, 14.99, "#4c1d95", "#111827", 5),
      deal(1003, "Rally Circuit 26", 75, 39.99, "#7c2d12", "#111827", 1),
      deal(1004, "Starfield Gardens", 20, 19.49, "#14532d", "#111827", 6),
      deal(1005, "Deep Station", 50, 29.99, "#0f766e", "#111827", 3),
      deal(1006, "Pixel Kingdoms", 40, 9.99, "#831843", "#111827", 4),
    ],
    failed: [],
    fetchedAt,
    fromCache: false,
  };
}

const dashboardBridge = {
  stats: async () => {
    await pause(250);
    return previewStats();
  },
  activity: async (limit?: number) => {
    await pause(200);
    return previewActivity(typeof limit === "number" ? limit : 20);
  },
  news: async (opts?: { feed?: NewsFeed }) => {
    await pause(400);
    return opts?.feed === "gaming" ? previewGamingNews() : previewNews();
  },
  deals: async () => {
    await pause(450);
    return previewDeals();
  },
};

if (!window.launcherAPI) {
  const target = window as unknown as Record<string, unknown>;
  target.dashboardAPI = withFallback("dashboardAPI", dashboardBridge);
  target.launcherAPI = withFallback("launcherAPI", launcherBridge);
  target.instanceAPI = withFallback("instanceAPI", instanceBridge);
  target.modAPI = withFallback("modAPI", modBridge);
  target.gamesAPI = withFallback("gamesAPI", gamesBridge as unknown as Record<string, AnyFn>);
  target.skinBuilderAPI = withFallback("skinBuilderAPI", skinBuilderBridge);
  target.skinAPI = withFallback("skinAPI", skinBridge);
  target.blockbenchAPI = withFallback("blockbenchAPI", {
    available: async () => false,
    prepare: async () => {},
    editSkin: async () => {
      throw new Error("Blockbench needs the desktop app.");
    },
    onSaved: () => () => {},
  });

  if (document.body) showPreviewLabel();
  else document.addEventListener("DOMContentLoaded", showPreviewLabel, { once: true });
}

export {};
