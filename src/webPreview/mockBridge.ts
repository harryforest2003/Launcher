/**
 * Browser stand-in for the Electron preload bridges (electron/preload.cjs).
 *
 * `npm run web` injects this file ahead of src/main.tsx (see vite.web.config.ts),
 * so the real launcher UI can run on localhost with no Electron process. It never
 * touches instances, accounts or files on disk. Public version and Modrinth data
 * is fetched live when reachable; everything else is simulated in memory and kept
 * in localStorage. It is not loaded by `npm run electron:dev` or production builds.
 */

import { createCatalog } from "../../electron/shared/catalog.mjs";
import { curseForgeType, modrinthType } from "../../electron/shared/contentTypes.mjs";

/* The real bridges are loosely typed JSON over IPC, and this mirrors them. */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare const __WEB_PREVIEW_HAS_CURSEFORGE__: boolean;

type AnyFn = (...args: any[]) => any;
type Listener = (data: any) => void;

const STORAGE_KEY = "unity-web-preview-state";
const PLAYER_NAME = "PreviewPlayer";

type PreviewState = {
  instances: Instance[];
  mods: Record<string, InstanceMod[]>;
  settings: LauncherSettings;
  account: { name: string; uuid: string } | null;
  hasNexusKey: boolean;
};

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
    account: null,
    hasNexusKey: false,
  };
}

function loadState(): PreviewState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...initialState(), ...JSON.parse(saved) };
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

async function launch(nameOrInstance: string | { name: string }) {
  const name = typeof nameOrInstance === "string" ? nameOrInstance : nameOrInstance.name;
  const instance = findInstance(name);

  instance.running = true;
  instance.lastPlayed = new Date().toISOString();
  persist();

  emit("instance:log", { name, line: "[web preview] Minecraft was not started." });

  setTimeout(() => {
    instance.running = false;
    persist();
    emit("instance:exit", { name, code: 0 });
  }, 8000);

  return {
    launched: true,
    name,
    pid: 0,
    online: Boolean(state.account),
    playerName: state.account?.name ?? PLAYER_NAME,
  };
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

async function signIn() {
  state.account = { name: PLAYER_NAME, uuid: "00000000000000000000000000000000" };
  persist();

  return {
    name: PLAYER_NAME,
    uuid: state.account.uuid,
    skin: makeSampleSkin(),
  };
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
    findInstance(name).running = false;
    persist();
    emit("instance:exit", { name, code: 0 });
    return { stopped: name };
  },
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
  getAccount: async () => state.account,
  clearAccount: async () => {
    state.account = null;
    persist();
    return true;
  },

  onProgress: (callback: Listener) => subscribe("instance:progress", callback),
  onModProgress: (callback: Listener) => subscribe("instance:modProgress", callback),
  onLog: (callback: Listener) => subscribe("instance:log", callback),
  onExit: (callback: Listener) => subscribe("instance:exit", callback),
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
];

const installedGameMods: Record<string, InstalledMod[]> = {};

const modBridge = {
  getGames: async () => sampleGames,
  refreshGames: async () => sampleGames.length,
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
  saved: async () => [],
  save: needsDesktop,
  useSaved: needsDesktop,
  deleteSaved: needsDesktop,
};

if (!window.launcherAPI) {
  const target = window as unknown as Record<string, unknown>;
  target.launcherAPI = withFallback("launcherAPI", launcherBridge);
  target.instanceAPI = withFallback("instanceAPI", instanceBridge);
  target.modAPI = withFallback("modAPI", modBridge);
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
