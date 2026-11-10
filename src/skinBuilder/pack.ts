import { familyOf, findItem, profileFor } from "./catalog";
import definitions from "./data/vanillaItemDefinitions.json";
import legacyModels from "./data/vanillaLegacyModels.json";
import { buildZip, decodeOwnPng, encodePng, halveRgba, type ZipEntry } from "./encode";
import {
  FIRST_ITEM_DEFINITION_FORMAT,
  FIRST_ON_SHELF_FORMAT,
  findVersion,
  giveCommand,
  packSection,
} from "./versions";
import type { DisplayTable, GlowInfo, ModelElement, SkinMeta } from "./types";

/*
 * Builds a resource pack from saved skins, in the same layout as Cyber Arsenal so
 * that OPworks reads it without any setup:
 *
 *   assets/<ns>/models/item/<skin>/<skin>.json        the whole item, in one model
 *   assets/<ns>/models/item/<skin>/<skin>_still.json  the same, with a frozen glow
 *   assets/<ns>/textures/item/<skin>.png, _glow.png, _glow_still.png
 *   assets/<ns>/lang/en_us.json                       item.<ns>.<skin> and one per model
 *   assets/minecraft/items/<item>.json                custom model data N, and N + 1 for still
 *
 * OPworks folds N and N + 1 into one card only when they share a shape, exactly one
 * of them is animated, and the still model's id is the animated id plus "_still".
 *
 * data/vanillaItemDefinitions.json holds the 26.2 client's assets/minecraft/items
 * files, and data/vanillaLegacyModels.json the 1.21.1 client's models/item files.
 * A pack replaces each item's whole definition, so vanilla's copy is what it falls
 * back to when an item has no custom model data.
 */

const encoder = new TextEncoder();

/** The largest item atlas Minecraft can make, in pixels. */
export const ATLAS_PIXELS = 16384 * 16384;

/** Below this a sprite would lower the mipmap level of the whole atlas. */
const SMALLEST_SIDE = 16;

export type PackSkin = {
  meta: SkinMeta;
  texturePng: Uint8Array;
  elements: ModelElement[];
  /** Saved with the skin, because a smaller model adjusts it. Older skins have none. */
  display?: DisplayTable;
  glow?: {
    info: GlowInfo;
    stripPng: Uint8Array;
    stillPng: Uint8Array;
  };
};

export type PackOptions = {
  name: string;
  description: string;
  minVersion: string;
  maxVersion: string;
  /** The first custom model data number used on each item. */
  firstCustomModelData: number;
  /** The largest share of the item atlas the pack may take, as a percentage. */
  atlasBudgetPercent: number;
  skins: PackSkin[];
  /** A 64x64-ish PNG for the pack list. Optional. */
  icon?: Uint8Array;
};

export type PackAssignment = {
  skinId: string;
  skinName: string;
  itemId: string;
  itemLabel: string;
  itemCount: number;
  customModelData: number;
  command: string;
  /** The still twin's command, for a skin with a glow layer. */
  stillCommand?: string;
};

export type BuiltPack = {
  fileName: string;
  zip: Uint8Array;
  namespace: string;
  assignments: PackAssignment[];
  warnings: string[];
  files: string[];
  atlasPixels: number;
  /** Skins whose textures were made smaller to fit the budget. */
  shrunk: string[];
};

function slugify(name: string, fallback: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}

/** The pack's own namespace, so two packs with same-named skins can't collide. */
export function packNamespace(name: string) {
  const namespace = slugify(name, "skins");
  return namespace === "minecraft" ? "minecraft_skins" : namespace;
}

export function packFileName(name: string) {
  const clean = name.replace(/[^A-Za-z0-9 ._()-]+/g, "").trim().replace(/^\.+/, "");
  return `${clean || "Skin Pack"}.zip`;
}

function json(value: unknown) {
  return encoder.encode(JSON.stringify(value, null, 2));
}

/** Older games fail on a display context they have never heard of. */
function withoutOnShelf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutOnShelf);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        key === "when" && Array.isArray(value)
          ? value.filter((context) => context !== "on_shelf")
          : withoutOnShelf(value);
    }
    return out;
  }
  return node;
}

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

type Sprite = {
  skin: PackSkin;
  kind: "texture" | "strip" | "still";
  width: number;
  height: number;
  frames: number;
};

function spritesOf(skin: PackSkin): Sprite[] {
  const texture = pngSize(skin.texturePng);
  const sprites: Sprite[] = [{ skin, kind: "texture", ...texture, frames: 1 }];

  if (skin.glow) {
    const { info, stillPng } = skin.glow;
    sprites.push({ skin, kind: "strip", width: info.frameWidth, height: info.frameHeight, frames: info.frames });
    sprites.push({ skin, kind: "still", ...pngSize(stillPng), frames: 1 });
  }
  return sprites;
}

async function halveSprite(sprite: Sprite) {
  const { skin, kind, frames } = sprite;
  const source = kind === "texture" ? skin.texturePng : kind === "strip" ? skin.glow!.stripPng : skin.glow!.stillPng;
  const decoded = await decodeOwnPng(source);
  const halved = halveRgba(decoded.rgba, decoded.width, decoded.height);
  const png = await encodePng(halved.rgba, halved.width, halved.height);

  if (kind === "texture") skin.texturePng = png;
  else if (kind === "still") skin.glow!.stillPng = png;
  else {
    skin.glow!.stripPng = png;
    skin.glow!.info = { frames, frameWidth: halved.width, frameHeight: halved.height / frames };
  }

  sprite.width = sprite.width >> 1;
  sprite.height = sprite.height >> 1;
}

/**
 * Halves the biggest textures until the pack fits its budget. A model's UVs run from
 * 0 to 16 whatever the texture's size, so this never changes a model's shape. Only
 * an animation's atlas cost is one frame, which is why a strip counts as one.
 */
async function fitToBudget(skins: PackSkin[], budgetPixels: number) {
  const sprites = skins.flatMap(spritesOf);
  const area = (sprite: Sprite) => sprite.width * sprite.height;
  const shrunk = new Set<string>();
  let total = sprites.reduce((sum, sprite) => sum + area(sprite), 0);

  while (total > budgetPixels) {
    let biggest: Sprite | null = null;
    for (const sprite of sprites) {
      if (Math.min(sprite.width, sprite.height) < SMALLEST_SIDE * 2) continue;
      if (!biggest || area(sprite) > area(biggest)) biggest = sprite;
    }
    if (!biggest) break;

    const before = area(biggest);
    await halveSprite(biggest);
    total -= before - area(biggest);
    shrunk.add(biggest.skin.meta.name);
  }

  return { total, shrunk: [...shrunk], fits: total <= budgetPixels };
}

function modelFile(skin: PackSkin, ns: string, slug: string) {
  // Skins saved before the glow layer existed named their only texture #0.
  const elements = JSON.parse(JSON.stringify(skin.elements).replaceAll('"#0"', '"#s"'));
  const texture = `${ns}:item/${slug}`;

  return {
    credit: "Made with the Unity Launcher Skin Builder",
    textures: {
      s: texture,
      ...(skin.glow ? { g: `${ns}:item/${slug}_glow` } : {}),
      particle: texture,
    },
    gui_light: "front",
    elements,
    display: skin.display ?? profileFor(skin.meta.itemId).display,
  };
}

export async function buildPack(options: PackOptions): Promise<BuiltPack> {
  const min = findVersion(options.minVersion);
  const max = findVersion(options.maxVersion);
  if (min.order > max.order) {
    throw new Error(`The range runs backwards: ${min.id} is newer than ${max.id}.`);
  }
  if (options.skins.length === 0) {
    throw new Error("Pick at least one skin for the pack.");
  }

  const ns = packNamespace(options.name);
  const entries: ZipEntry[] = [];
  const warnings: string[] = [];
  const assignments: PackAssignment[] = [];
  const langEntries: Record<string, string> = {};
  const usedSlugs = new Set<string>();
  const perItem = new Map<string, { modelId: string; customModelData: number }[]>();
  const nextNumber = new Map<string, number>();

  entries.push({
    path: "pack.mcmeta",
    data: json({ pack: packSection(min.format, max.format, options.description) }),
  });
  if (options.icon) entries.push({ path: "pack.png", data: options.icon });

  const ordered = options.skins
    .slice()
    .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt) || a.meta.id.localeCompare(b.meta.id));

  const included: PackSkin[] = [];
  const targets = new Map<PackSkin, string[]>();

  for (const skin of ordered) {
    const chosen = findItem(skin.meta.itemId);
    const family = skin.meta.params.allMaterials ? familyOf(chosen.id) : [chosen];

    const available = family.filter((item) => !item.since || findVersion(item.since).order <= max.order);
    if (available.length === 0) {
      const since = chosen.since ? findVersion(chosen.since).id : "a later version";
      warnings.push(`Left out "${skin.meta.name}": ${chosen.label} does not exist until ${since}.`);
      continue;
    }
    if (chosen.since && findVersion(chosen.since).order > min.order) {
      warnings.push(`"${skin.meta.name}" only shows from ${chosen.since}, the first version with ${chosen.label}.`);
    }

    included.push(skin);
    targets.set(skin, available.map((item) => item.id));
  }

  if (included.length === 0) {
    throw new Error("None of these skins exist in the chosen versions.");
  }

  const fitted = await fitToBudget(included, (ATLAS_PIXELS * options.atlasBudgetPercent) / 100);
  if (!fitted.fits) {
    warnings.push(
      `This pack still takes ${((fitted.total / ATLAS_PIXELS) * 100).toFixed(2)}% of the atlas, with every texture at its smallest.`
    );
  }

  for (const skin of included) {
    const itemIds = targets.get(skin) ?? [];
    const item = findItem(skin.meta.itemId);

    let slug = slugify(skin.meta.name, "skin");
    for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${slugify(skin.meta.name, "skin")}_${n}`;
    usedSlugs.add(slug);

    const textures = `assets/${ns}/textures/item`;
    const models = `assets/${ns}/models/item/${slug}`;
    const modelId = `${ns}:item/${slug}/${slug}`;

    entries.push({ path: `${textures}/${slug}.png`, data: skin.texturePng });
    // Compact, since a model holds hundreds of elements nobody edits by hand.
    entries.push({ path: `${models}/${slug}.json`, data: encoder.encode(JSON.stringify(modelFile(skin, ns, slug))) });

    langEntries[`item.${ns}.${slug}`] = skin.meta.name;
    langEntries[`item.${ns}.item.${slug}.${slug}`] = skin.meta.name;

    if (skin.glow) {
      const { info } = skin.glow;
      entries.push({ path: `${textures}/${slug}_glow.png`, data: skin.glow.stripPng });
      entries.push({
        path: `${textures}/${slug}_glow.png.mcmeta`,
        data: json({
          animation: { frametime: 4, interpolate: false, width: info.frameWidth, height: info.frameHeight },
        }),
      });
      entries.push({ path: `${textures}/${slug}_glow_still.png`, data: skin.glow.stillPng });
      entries.push({
        path: `${models}/${slug}_still.json`,
        data: json({ parent: modelId, textures: { g: `${ns}:item/${slug}_glow_still` } }),
      });

      const stillName = `${skin.meta.name} §8(still)`;
      langEntries[`item.${ns}.${slug}_still`] = stillName;
      langEntries[`item.${ns}.item.${slug}.${slug}_still`] = stillName;
    }

    // One number per skin across all its items, so a skin is the same value on each.
    const customModelData = Math.max(
      options.firstCustomModelData,
      ...itemIds.map((id) => nextNumber.get(id) ?? options.firstCustomModelData)
    );
    for (const id of itemIds) {
      const onItem = perItem.get(id) ?? [];
      onItem.push({ modelId, customModelData });
      if (skin.glow) onItem.push({ modelId: `${modelId}_still`, customModelData: customModelData + 1 });
      perItem.set(id, onItem);
      nextNumber.set(id, customModelData + (skin.glow ? 2 : 1));
    }

    assignments.push({
      skinId: skin.meta.id,
      skinName: skin.meta.name,
      itemId: item.id,
      itemLabel: item.label,
      itemCount: itemIds.length,
      customModelData,
      command: giveCommand(item.id, customModelData, max, `item.${ns}.${slug}`),
      stillCommand: skin.glow
        ? giveCommand(item.id, customModelData + 1, max, `item.${ns}.${slug}_still`)
        : undefined,
    });
  }

  entries.push({ path: `assets/${ns}/lang/en_us.json`, data: json(langEntries) });

  const vanillaDefinitions = definitions as Record<string, { model: unknown }>;
  const vanillaModels = legacyModels as Record<string, { overrides?: unknown[] }>;

  for (const [itemId, skins] of perItem) {
    if (max.format >= FIRST_ITEM_DEFINITION_FORMAT) {
      const vanilla = vanillaDefinitions[itemId];
      if (!vanilla) throw new Error(`No vanilla definition is bundled for ${itemId}.`);

      const definition = min.format < FIRST_ON_SHELF_FORMAT ? (withoutOnShelf(vanilla) as typeof vanilla) : vanilla;

      entries.push({
        path: `assets/minecraft/items/${itemId}.json`,
        data: json({
          ...definition,
          model: {
            type: "minecraft:range_dispatch",
            property: "minecraft:custom_model_data",
            index: 0,
            entries: skins.map((skin) => ({
              threshold: skin.customModelData,
              model: { type: "minecraft:model", model: skin.modelId },
            })),
            fallback: definition.model,
          },
        }),
      });
    }

    if (min.format < FIRST_ITEM_DEFINITION_FORMAT) {
      const vanilla = vanillaModels[itemId];
      // Items newer than 1.21.1 have no such file, and those older games lack them.
      if (vanilla) {
        entries.push({
          path: `assets/minecraft/models/item/${itemId}.json`,
          data: json({
            ...vanilla,
            overrides: [
              ...(vanilla.overrides ?? []),
              ...skins.map((skin) => ({
                predicate: { custom_model_data: skin.customModelData },
                model: skin.modelId,
              })),
            ],
          }),
        });
      }
    }
  }

  const overview = [
    options.name,
    `Minecraft ${min.id === max.id ? min.id : `${min.id} to ${max.id}`}`,
    "",
    ...assignments.flatMap((assignment) => {
      const applies =
        assignment.itemCount > 1 ? `every ${assignment.itemLabel.split(" ").pop()?.toLowerCase()}` : assignment.itemLabel;
      const lines = [`${assignment.skinName} (${applies}), custom model data ${assignment.customModelData}`];
      lines.push(`  ${assignment.command}`);
      if (assignment.stillCommand) lines.push(`  Still: ${assignment.stillCommand}`);
      if (min.id !== max.id) {
        const older = giveCommand(assignment.itemId, assignment.customModelData, min);
        if (older !== assignment.command) lines.push(`  On ${min.id}: ${older}`);
      }
      return lines;
    }),
    "",
  ].join("\n");
  entries.push({ path: "skins.txt", data: encoder.encode(overview) });

  return {
    fileName: packFileName(options.name),
    zip: await buildZip(entries),
    namespace: ns,
    assignments,
    warnings,
    files: entries.map((entry) => entry.path),
    atlasPixels: fitted.total,
    shrunk: fitted.shrunk,
  };
}
