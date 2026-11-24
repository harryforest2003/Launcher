import { CF_CLASS_IDS, CF_LOADER_TYPES, curseForgeType, modrinthType, usesLoader } from "./contentTypes.mjs";

/*
 * Browses Modrinth and CurseForge as one list, a page at a time. Nothing is fetched
 * until a page is asked for. Each site reports how many results it has, which gives
 * the page count, and a page's mods are requested when someone opens that page.
 *
 * A project on both sites takes one place in the list, so a page's position depends
 * on how many pairs came before it. Pages near what's been seen are found by walking
 * forward, which is exact. Far jumps work out the position instead of downloading
 * everything before it, so they can land a few places off.
 */

export const PAGE_SIZE = 25;

// CurseForge rejects any request reaching past this many results for one search.
export const CURSEFORGE_LIMIT = 10000;

const BATCH_SIZES = { modrinth: 100, curseforge: 50 };
const MAX_WALK_PAGES = 20;
const LOOKUPS_AT_ONCE = 5;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 8;

const SORT_FIELDS = {
  relevance: { modrinth: "relevance", curseforge: 2 },
  downloads: { modrinth: "downloads", curseforge: 6 },
  newest: { modrinth: "newest", curseforge: 11 },
};

/* ---------------- telling whether two listings are one project ---------------- */

// Words a title may or may not carry on either site, which don't change what it is.
const FILLER_BY_TYPE = {
  shader: /\bshaders?\b/g,
  resourcepack: /\b(resource ?pack|texture ?pack)s?\b|\bpack\s*$/g,
  datapack: /\b(data ?pack)s?\b/g,
  modpack: /\bmod ?pack\s*$/g,
  mod: /\bmod\s*$/g,
};

const LOADER_WORDS = /\b(neoforge|forge|fabric|quilt)\b/g;

function compact(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeTitle(title, type) {
  let plain = title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\(+[^()]*\)+/g, " ")
    .replace(/\s+(for|on)\s+(fabric|forge|neoforge|quilt)\s*$/, " ")
    .replace(/[\s/|&,+-]*\bv?\d+(\.\d+)+\s*$/, " ");

  // A loader only counts as filler at the end, as in "Entity Culling Fabric/Forge".
  // "Forge Labs" stays as it is.
  for (let tail = plain; ; plain = tail) {
    tail = plain.replace(/[\s/|&,+()-]*\b(neoforge|forge|fabric|quilt)\b[\s)]*$/, " ");
    if (tail === plain) break;
  }

  const core = compact(plain.replace(FILLER_BY_TYPE[type] ?? /$^/g, " "));
  return core || compact(plain) || title.toLowerCase();
}

/** Two titles naming different loaders are separate builds, whatever else they share. */
function loadersConflict(a, b) {
  const first = new Set(a.toLowerCase().match(LOADER_WORDS) ?? []);
  const second = new Set(b.toLowerCase().match(LOADER_WORDS) ?? []);
  return first.size > 0 && second.size > 0 && ![...first].some((tag) => second.has(tag));
}

function authorsOverlap(a, b) {
  const first = (a ?? "").split(",").map(compact).filter((name) => name.length >= 3);
  const second = (b ?? "").split(",").map(compact).filter((name) => name.length >= 3);
  return first.some((x) => second.some((y) => x.includes(y) || y.includes(x)));
}

/*
 * A shared name alone isn't enough, because different projects do share names. It
 * also needs the same type and either a shared author or the same slug. Merging two
 * different projects would hide one and could install the wrong one, while missing a
 * pair only leaves two cards, so when in doubt this leaves two cards.
 */
export function isSameProject(a, b) {
  return (
    a.type === b.type &&
    normalizeTitle(a.name, a.type) === normalizeTitle(b.name, b.type) &&
    !loadersConflict(a.name, b.name) &&
    (authorsOverlap(a.author, b.author) || (Boolean(a.slug) && compact(a.slug) === compact(b.slug ?? "")))
  );
}

/* ---------------- talking to each site ---------------- */

function modrinthSearchPath(filters, offset, limit) {
  const params = new URLSearchParams({
    query: filters.query,
    limit: String(limit),
    offset: String(offset),
    index: SORT_FIELDS[filters.sort].modrinth,
  });

  const facets = [];
  if (filters.mcVersion) facets.push([`versions:${filters.mcVersion}`]);
  if (filters.type) facets.push([`project_type:${filters.type}`]);

  // Only mods and modpacks have a loader. With no type chosen, the kinds without
  // one stay in the results instead of being filtered out.
  if (filters.loader) {
    const category = `categories:${filters.loader}`;
    if (!filters.type) {
      facets.push([category, "project_type:resourcepack", "project_type:shader", "project_type:datapack"]);
    } else if (usesLoader(filters.type)) {
      facets.push([category]);
    }
  }

  if (facets.length) params.set("facets", JSON.stringify(facets));
  return `/search?${params}`;
}

function curseForgeSearchPath(filters, index, pageSize) {
  const params = new URLSearchParams({
    gameId: "432",
    index: String(index),
    pageSize: String(pageSize),
    sortField: String(SORT_FIELDS[filters.sort].curseforge),
    sortOrder: "desc",
  });

  if (filters.type) params.set("classId", String(CF_CLASS_IDS[filters.type]));
  if (filters.query) params.set("searchFilter", filters.query);
  if (filters.mcVersion) params.set("gameVersion", filters.mcVersion);

  // Sending a loader for any other kind of content returns nothing, because those
  // files aren't tagged with one.
  if (filters.loader && CF_LOADER_TYPES[filters.loader] !== undefined && (!filters.type || usesLoader(filters.type))) {
    params.set("modLoaderType", String(CF_LOADER_TYPES[filters.loader]));
  }

  return `/mods/search?${params}`;
}

function fromModrinth(hit, wanted) {
  // A project can be several kinds. The tab it was found under says which is meant.
  const type = wanted && (hit.all_project_types ?? []).includes(wanted) ? wanted : modrinthType(hit);

  return {
    source: "modrinth",
    type,
    id: hit.project_id ?? hit.id,
    slug: hit.slug,
    name: hit.title,
    summary: hit.description,
    author: hit.author ?? "",
    downloads: hit.downloads ?? 0,
    icon: hit.icon_url || null,
    url: `https://modrinth.com/project/${hit.slug}`,
    installable: true,
    date: hit.date_created ?? hit.published ?? null,
    // A server plugin can match a mod search but can't run in an instance.
    hidden: type === "plugin",
  };
}

function fromCurseForge(mod) {
  const type = curseForgeType(mod.classId);

  return {
    source: "curseforge",
    type,
    id: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    summary: mod.summary,
    author: (mod.authors ?? []).map((author) => author.name).join(", "),
    downloads: mod.downloadCount ?? 0,
    icon: mod.logo?.url ?? null,
    url: mod.links?.websiteUrl ?? null,
    // Authors can forbid third-party downloads.
    installable: mod.allowModDistribution !== false,
    date: mod.dateReleased ?? mod.dateCreated ?? null,
    // Worlds, server plugins and the like, which only appear with no type chosen.
    hidden: type === "other",
  };
}

const itemKey = (item) => `${item.source}:${item.id}`;
const titleKey = (item) => `${item.type}/${normalizeTitle(item.name, item.type)}`;

/* ---------------- one site's results, fetched only when reached ---------------- */

function createStream(batchSize, maxItems, fetchBatch, onItems) {
  const batches = new Map();

  const stream = {
    total: null,
    capped: false,
    problem: null,
    note: null,

    count: () => (stream.total === null ? Infinity : Math.min(stream.total, maxItems)),

    async at(position) {
      if (position >= stream.count()) return undefined;

      const start = position - (position % batchSize);

      if (!batches.has(start)) {
        batches.set(
          start,
          fetchBatch(start, Math.min(batchSize, maxItems - start))
            .then(({ items, total }) => {
              stream.total = total;
              stream.capped = total >= maxItems;

              // The site reported more than it could actually return.
              if (items.length < batchSize && start + items.length < stream.count()) {
                stream.total = start + items.length;
              }

              onItems(items);
              return items;
            })
            .catch((error) => {
              if (error?.code === "NO_API_KEY") {
                stream.total = 0;
                stream.note = error.message;
                return [];
              }

              // Not kept, so opening the page again retries it.
              batches.delete(start);
              stream.problem = error;
              return [];
            })
        );
      }

      const items = await batches.get(start);
      return items[position - start];
    },
  };

  return stream;
}

/* ---------------- a search's pages ---------------- */

function createSession(filters, api) {
  const session = {
    filters,
    api,
    streams: {},
    byTitle: new Map(),
    absorbed: new Set(),
    cardOf: new Map(),
    lookedUp: new Set(),
    pages: new Map(),
    // Where each exactly walked page starts. Index 0 is page 1.
    anchors: [{ m: 0, c: 0 }],
    exactPages: 0,
    // Where pages after a far jump start, so moving on from one carries on from it.
    jumpAnchors: new Map(),
    lastPage: null,
    queue: Promise.resolve(),
    usedAt: Date.now(),
  };

  const remember = (items) => {
    for (const item of items) {
      const key = titleKey(item);
      session.byTitle.set(key, [...(session.byTitle.get(key) ?? []), item]);
    }
  };

  if (filters.source !== "curseforge") {
    session.streams.modrinth = createStream(
      BATCH_SIZES.modrinth,
      Infinity,
      async (offset, limit) => {
        const data = await api.modrinth(modrinthSearchPath(filters, offset, limit));
        return { items: (data.hits ?? []).map((hit) => fromModrinth(hit, filters.type)), total: data.total_hits ?? 0 };
      },
      remember
    );
  }

  if (filters.source !== "modrinth") {
    session.streams.curseforge = createStream(
      BATCH_SIZES.curseforge,
      CURSEFORGE_LIMIT,
      async (index, pageSize) => {
        const data = await api.curseforge(curseForgeSearchPath(filters, index, pageSize));
        return { items: (data.data ?? []).map(fromCurseForge), total: data.pagination?.totalCount ?? 0 };
      },
      remember
    );
  }

  return session;
}

function rankOf(item, sort) {
  return sort === "newest" ? new Date(item.date ?? 0).getTime() : item.downloads;
}

async function nextItem(session, position) {
  const { modrinth, curseforge } = session.streams;
  const [first, second] = await Promise.all([modrinth?.at(position.m), curseforge?.at(position.c)]);

  let takeFirst;
  if (first === undefined && second === undefined) return undefined;
  if (first === undefined) takeFirst = false;
  else if (second === undefined) takeFirst = true;
  // Each site's own idea of relevance can't be compared, so they take turns.
  else if (session.filters.sort === "relevance") takeFirst = position.m <= position.c;
  else takeFirst = rankOf(first, session.filters.sort) >= rankOf(second, session.filters.sort);

  if (takeFirst) position.m += 1;
  else position.c += 1;

  return takeFirst ? first : second;
}

function sourceEntry(item) {
  return {
    source: item.source,
    id: item.id,
    downloads: item.downloads,
    installable: item.installable,
    url: item.url,
  };
}

/*
 * Which listing a card shows and installs from, where a project is on both sites.
 * Modrinth's, because its files can always be downloaded, except for modpacks: a
 * Modrinth pack can't carry CurseForge-only mods, so some authors put the full pack on
 * CurseForge and a lighter one on Modrinth under the same name. A pack comes from
 * CurseForge unless its authors forbid launchers downloading it there.
 */
function takesOver(card, item) {
  if (item.type !== "modpack") return item.source === "modrinth";
  return item.source === "curseforge" ? item.installable !== false : card.installable === false;
}

function addToCard(card, item) {
  const sources = [...card.sources, sourceEntry(item)].sort((a, b) => a.source.localeCompare(b.source)).reverse();
  if (takesOver(card, item)) Object.assign(card, item);
  card.sources = sources;
}

function findTwin(session, item) {
  return (session.byTitle.get(titleKey(item)) ?? []).find((other) => {
    if (other.source === item.source || session.absorbed.has(itemKey(other))) return false;
    const card = session.cardOf.get(itemKey(other));
    return !(card && card.sources.length > 1) && isSameProject(item, other);
  });
}

/* Puts two listings of a project on one card, or folds this one into its twin's. */
function pairUp(session, cards, card, twin) {
  const existing = session.cardOf.get(itemKey(twin));

  if (existing && existing !== card) {
    if (existing.sources.length > 1) return;
    addToCard(existing, card);
    session.cardOf.set(itemKey(card), existing);
    session.absorbed.add(itemKey(card));
    cards.splice(cards.indexOf(card), 1);
    return;
  }

  addToCard(card, twin);
  session.cardOf.set(itemKey(twin), card);
  session.absorbed.add(itemKey(twin));
}

async function inBatches(items, limit, work) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await work(queue.shift());
    })
  );
}

/*
 * A project's twin can be anywhere in the other site's list, so the cards on this page
 * are looked up by slug. A failed lookup only leaves a card showing one site.
 */
async function lookUpTwins(session, cards) {
  const { modrinth, curseforge } = session.streams;
  if (!modrinth || !curseforge) return;

  const pending = cards.filter((card) => card.sources.length === 1 && !session.lookedUp.has(itemKey(card)));
  for (const card of pending) session.lookedUp.add(itemKey(card));

  const onCurseForge = pending.filter((card) => card.source === "curseforge" && card.slug);
  const onModrinth = curseforge.note
    ? []
    : pending.filter((card) => card.source === "modrinth" && card.slug && CF_CLASS_IDS[card.type]);

  if (onCurseForge.length) {
    const ids = encodeURIComponent(JSON.stringify(onCurseForge.map((card) => card.slug)));
    const projects = await session.api.modrinth(`/projects?ids=${ids}`).catch(() => []);
    const bySlug = new Map(projects.map((project) => [project.slug, fromModrinth(project)]));

    for (const card of onCurseForge) {
      const twin = bySlug.get(card.slug);
      if (twin && cards.includes(card) && isSameProject(card, twin)) pairUp(session, cards, card, twin);
    }
  }

  await inBatches(onModrinth, LOOKUPS_AT_ONCE, async (card) => {
    const params = new URLSearchParams({ gameId: "432", classId: String(CF_CLASS_IDS[card.type]), slug: card.slug });
    const data = await session.api.curseforge(`/mods/search?${params}`).catch(() => null);
    const twin = data?.data?.[0] && fromCurseForge(data.data[0]);
    if (twin && cards.includes(card) && isSameProject(card, twin)) pairUp(session, cards, card, twin);
  });
}

async function buildPage(session, start) {
  const position = { ...start };
  const cards = [];
  let ended = false;

  while (cards.length < PAGE_SIZE && !ended) {
    while (cards.length < PAGE_SIZE) {
      const item = await nextItem(session, position);
      if (item === undefined) {
        ended = true;
        break;
      }

      const key = itemKey(item);
      if (item.hidden || session.absorbed.has(key)) continue;

      // Already on a card, from a page reached by a far jump.
      const listed = session.cardOf.get(key);
      if (listed) {
        if (!cards.includes(listed)) cards.push(listed);
        continue;
      }

      const card = { ...item, sources: [sourceEntry(item)] };
      session.cardOf.set(key, card);
      cards.push(card);

      const twin = findTwin(session, item);
      if (twin) pairUp(session, cards, card, twin);
    }

    await lookUpTwins(session, cards);
  }

  return { cards, position, ended };
}

function hasProblem(session) {
  return Object.values(session.streams).some((stream) => stream.problem);
}

// How many list positions the exactly walked pages used up beyond their cards.
function foldedSoFar(session) {
  const anchor = session.anchors[session.exactPages];
  return Math.max(0, anchor.m + anchor.c - session.exactPages * PAGE_SIZE);
}

function totalPositions(session) {
  const { modrinth, curseforge } = session.streams;
  return (modrinth ? modrinth.count() : 0) + (curseforge ? curseforge.count() : 0);
}

async function positionFor(session, page) {
  const { modrinth, curseforge } = session.streams;
  const wanted = Math.min((page - 1) * PAGE_SIZE + foldedSoFar(session), totalPositions(session));

  if (!curseforge) return { m: wanted, c: 0 };
  if (!modrinth) return { m: 0, c: wanted };

  const modrinthCount = modrinth.count();
  const curseCount = curseforge.count();

  if (session.filters.sort === "relevance") {
    const c = Math.min(curseCount, Math.floor(wanted / 2));
    const m = Math.min(modrinthCount, wanted - c);
    return { m, c: wanted - m };
  }

  // Sorted lists: finds how many of the wanted positions each site accounts for.
  let low = Math.max(0, wanted - curseCount);
  let high = Math.min(wanted, modrinthCount);

  while (high - low > PAGE_SIZE) {
    const middle = Math.floor((low + high) / 2);
    const [first, second] = await Promise.all([modrinth.at(middle), curseforge.at(wanted - middle - 1)]);

    if (first && second && rankOf(first, session.filters.sort) >= rankOf(second, session.filters.sort)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return { m: low, c: wanted - low };
}

async function cardsForPage(session, page) {
  if (page <= session.exactPages) return session.pages.get(page);

  if (page <= session.exactPages + MAX_WALK_PAGES) {
    let cards = [];

    for (let current = session.exactPages + 1; current <= page; current += 1) {
      const built = await buildPage(session, session.anchors[current - 1]);
      cards = built.cards;

      // Pages missing a site's results aren't kept, so opening them again retries.
      if (hasProblem(session)) return cards;

      session.anchors[current] = built.position;
      session.exactPages = current;
      session.pages.set(current, cards);

      if (built.ended) {
        session.lastPage = cards.length > 0 || current === 1 ? current : current - 1;
        break;
      }
    }

    return cards;
  }

  if (session.pages.has(page)) return session.pages.get(page);

  const built = await buildPage(session, session.jumpAnchors.get(page) ?? (await positionFor(session, page)));

  if (!hasProblem(session)) {
    session.pages.set(page, built.cards);
    session.jumpAnchors.set(page + 1, built.position);
  }

  return built.cards;
}

function cleanFilters({ query, type, mcVersion, loader, sort, source }) {
  const loaderName = (loader ?? "").toLowerCase();

  return {
    query: (query ?? "").trim(),
    type: type || null,
    mcVersion: mcVersion || null,
    loader: loaderName && loaderName !== "vanilla" ? loaderName : null,
    sort: SORT_FIELDS[sort] ? sort : "relevance",
    source: source === "modrinth" || source === "curseforge" ? source : null,
  };
}

/* Pages of a search load one at a time, so a stuck request would hold up all the rest. */
function withTimeout(request) {
  return async (path) => {
    let timer;

    try {
      return await Promise.race([
        request(path),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("The request timed out.")), REQUEST_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createCatalog({ modrinth, curseforge }) {
  const api = { modrinth: withTimeout(modrinth), curseforge: withTimeout(curseforge) };
  const sessions = new Map();

  function sessionFor(filters) {
    const key = JSON.stringify(filters);
    const now = Date.now();

    for (const [otherKey, other] of sessions) {
      if (now - other.usedAt > SESSION_LIFETIME_MS) sessions.delete(otherKey);
    }

    let session = sessions.get(key);

    if (!session) {
      session = createSession(filters, api);
      sessions.set(key, session);
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    }

    session.usedAt = now;
    return session;
  }

  async function openPage(session, requested) {
    const streams = Object.entries(session.streams);
    for (const [, stream] of streams) stream.problem = null;

    // The totals decide the page count, so they're needed before anything else.
    await Promise.all(streams.map(([, stream]) => stream.at(0)));

    const countPages = () =>
      session.lastPage ?? Math.max(1, Math.ceil((totalPositions(session) - foldedSoFar(session)) / PAGE_SIZE));

    let page = Math.min(Math.max(1, Math.floor(requested) || 1), countPages());
    let cards = await cardsForPage(session, page);

    // Pairs found on the way can use up the last positions before reaching this page.
    if (cards.length === 0 && page > 1 && !hasProblem(session)) {
      page = countPages();
      cards = await cardsForPage(session, page);
    }

    const warnings = [];
    const labels = { modrinth: "Modrinth", curseforge: "CurseForge" };

    for (const [name, stream] of streams) {
      if (stream.note) warnings.push(`${labels[name]}: ${stream.note}`);
      if (stream.problem) {
        const message = stream.problem.message;
        // A message that already names the site, like "CurseForge is busy...", stands alone.
        warnings.push(message.startsWith(labels[name]) ? message : `${labels[name]}: ${message}`);
      }
    }

    return {
      items: cards,
      page,
      pageCount: countPages(),
      pageSize: PAGE_SIZE,
      totals: {
        modrinth: session.streams.modrinth?.total ?? 0,
        curseforge: session.streams.curseforge?.total ?? 0,
        curseforgeCapped: Boolean(session.streams.curseforge?.capped),
      },
      warnings,
    };
  }

  return {
    browse(options) {
      const session = sessionFor(cleanFilters(options));
      // One at a time per search, since pages build on the ones before them.
      const result = session.queue.then(() => openPage(session, options.page ?? 1));
      session.queue = result.catch(() => {});
      return result;
    },

    /* The project a link points at, or null if it's nothing this app can show. */
    async resolveProjectLink({ source, slug, id, type }) {
      if (source === "modrinth") {
        const project = await api.modrinth(`/project/${encodeURIComponent(slug)}`);
        return modrinthType(project) === "plugin" ? null : { source, id: project.id };
      }

      let mod;

      if (id) {
        mod = (await api.curseforge(`/mods/${encodeURIComponent(id)}`)).data;
      } else {
        const params = new URLSearchParams({ gameId: "432", slug });
        if (CF_CLASS_IDS[type]) params.set("classId", String(CF_CLASS_IDS[type]));
        mod = (await api.curseforge(`/mods/search?${params}`)).data?.[0];
      }

      return !mod || curseForgeType(mod.classId) === "other" ? null : { source, id: String(mod.id) };
    },

    reset() {
      sessions.clear();
    },
  };
}
