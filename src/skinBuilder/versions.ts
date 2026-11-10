/*
 * Minecraft releases and what their resource packs need. Custom model data arrived
 * in 1.14, so that is the oldest a skin can target.
 *
 * Formats are from the Minecraft Wiki's pack format table, and checked against the
 * version.json of the 1.21.1, 1.21.4, 1.21.11, 26.2 and 26.3 client jars.
 */

const RELEASES_BY_FORMAT: [number, string[]][] = [
  [4, ["1.14", "1.14.1", "1.14.2", "1.14.3", "1.14.4"]],
  [5, ["1.15", "1.15.1", "1.15.2", "1.16", "1.16.1"]],
  [6, ["1.16.2", "1.16.3", "1.16.4", "1.16.5"]],
  [7, ["1.17", "1.17.1"]],
  [8, ["1.18", "1.18.1", "1.18.2"]],
  [9, ["1.19", "1.19.1", "1.19.2"]],
  [12, ["1.19.3"]],
  [13, ["1.19.4"]],
  [15, ["1.20", "1.20.1"]],
  [18, ["1.20.2"]],
  [22, ["1.20.3", "1.20.4"]],
  [32, ["1.20.5", "1.20.6"]],
  [34, ["1.21", "1.21.1"]],
  [42, ["1.21.2", "1.21.3"]],
  [46, ["1.21.4"]],
  [55, ["1.21.5"]],
  [63, ["1.21.6"]],
  [64, ["1.21.7", "1.21.8"]],
  [69, ["1.21.9", "1.21.10"]],
  [75, ["1.21.11"]],
  [84, ["26.1", "26.1.1", "26.1.2"]],
  [88, ["26.2"]],
  [97, ["26.3"]],
];

export type McVersion = {
  id: string;
  format: number;
  /** Position in release order, oldest first. */
  order: number;
};

export const MC_VERSIONS: McVersion[] = RELEASES_BY_FORMAT.flatMap(([format, ids]) =>
  ids.map((id) => ({ id, format, order: 0 }))
).map((version, order) => ({ ...version, order }));

export const NEWEST_VERSION = MC_VERSIONS[MC_VERSIONS.length - 1].id;

const VERSION_BY_ID = new Map(MC_VERSIONS.map((version) => [version.id, version]));

export function findVersion(id: string): McVersion {
  const version = VERSION_BY_ID.get(id);
  if (!version) throw new Error(`Minecraft ${id} is not a version the Skin Builder knows.`);
  return version;
}

/** Item definitions (assets/minecraft/items) replaced model overrides at this format. */
export const FIRST_ITEM_DEFINITION_FORMAT = 46;
/** custom_model_data became an item component here, instead of NBT. */
const FIRST_COMPONENT_FORMAT = 32;
/** The on_shelf display context first exists in 1.21.9. */
export const FIRST_ON_SHELF_FORMAT = 69;

/** Newest format before pack.mcmeta moved to min_format and max_format. */
const LAST_OLD_FORMAT = 64;
/** supported_formats is read from here on; earlier games only read pack_format. */
const FIRST_SUPPORTED_FORMATS_FORMAT = 18;
/** The lowest pack_format that newer games accept in a pack spanning versions. */
const LOWEST_MULTI_VERSION_PACK_FORMAT = 15;

/**
 * The pack section of pack.mcmeta for a range of formats.
 *
 * These rules are the ones in 26.2's PackFormat$IntermediaryFormat validator. A
 * pack only for new versions must not mention supported_formats, or the game calls
 * it incompatible. A pack reaching back past format 64 needs all four fields.
 */
export function packSection(minFormat: number, maxFormat: number, description: string) {
  if (minFormat > LAST_OLD_FORMAT) {
    return { description, min_format: minFormat, max_format: maxFormat };
  }

  if (maxFormat > LAST_OLD_FORMAT) {
    return {
      description,
      pack_format: Math.max(minFormat, LOWEST_MULTI_VERSION_PACK_FORMAT),
      supported_formats: [minFormat, maxFormat],
      min_format: minFormat,
      max_format: maxFormat,
    };
  }

  if (minFormat === maxFormat || maxFormat < FIRST_SUPPORTED_FORMATS_FORMAT) {
    return { description, pack_format: minFormat };
  }

  return {
    description,
    pack_format: minFormat,
    supported_formats: [minFormat, maxFormat],
  };
}

/** The command that gives a player this skin on a given version. */
export function giveCommand(itemId: string, customModelData: number, version: McVersion, nameKey?: string) {
  if (version.format >= FIRST_ITEM_DEFINITION_FORMAT) {
    const name = nameKey ? `,minecraft:item_name={translate:"${nameKey}"}` : "";
    return `/give @s minecraft:${itemId}[minecraft:custom_model_data={floats:[${customModelData}f]}${name}]`;
  }
  if (version.format >= FIRST_COMPONENT_FORMAT) {
    return `/give @s minecraft:${itemId}[minecraft:custom_model_data=${customModelData}]`;
  }
  return `/give @s minecraft:${itemId}{CustomModelData:${customModelData}}`;
}
