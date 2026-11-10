import type { DisplayTable, DisplayTransform } from "./types";

/*
 * Which Minecraft items a skin can apply to, and how each kind of item is shaped
 * and held. The display numbers are vanilla's own, copied into each model rather
 * than inherited: before 1.21.5 a model whose parent chain reaches
 * builtin/generated has its elements ignored in favour of a flat sprite.
 */

type Vec3 = [number, number, number];

function transform(rotation: Vec3, translation: Vec3, scale: number | Vec3): DisplayTransform {
  return {
    rotation,
    translation,
    scale: typeof scale === "number" ? [scale, scale, scale] : scale,
  };
}

const GENERATED: DisplayTable = {
  ground: transform([0, 0, 0], [0, 2, 0], 0.5),
  head: transform([0, 180, 0], [0, 13, 7], 1),
  thirdperson_righthand: transform([0, 0, 0], [0, 3, 1], 0.55),
  firstperson_righthand: transform([0, -90, 25], [1.13, 3.2, 1.13], 0.68),
  fixed: transform([0, 180, 0], [0, 0, 0], 1),
};

const HANDHELD: DisplayTable = {
  ...GENERATED,
  thirdperson_righthand: transform([0, -90, 55], [0, 4, 0.5], 0.85),
  thirdperson_lefthand: transform([0, 90, -55], [0, 4, 0.5], 0.85),
  firstperson_righthand: transform([0, -90, 25], [1.13, 3.2, 1.13], 0.68),
  firstperson_lefthand: transform([0, 90, -25], [1.13, 3.2, 1.13], 0.68),
};

const HANDHELD_ROD: DisplayTable = {
  ...HANDHELD,
  thirdperson_righthand: transform([0, 90, 55], [0, 4, 2.5], 0.85),
  thirdperson_lefthand: transform([0, -90, -55], [0, 4, 2.5], 0.85),
  firstperson_righthand: transform([0, 90, 25], [0, 1.6, 0.8], 0.68),
  firstperson_lefthand: transform([0, -90, -25], [0, 1.6, 0.8], 0.68),
};

const HANDHELD_MACE: DisplayTable = {
  ...HANDHELD,
  thirdperson_righthand: transform([0, -90, 55], [0, 4, 1], 1),
  thirdperson_lefthand: transform([0, 90, -55], [0, 4, 1], 1),
  firstperson_righthand: transform([0, -90, 25], [0, 3, 0.8], 0.9),
  firstperson_lefthand: transform([0, 90, -25], [0, 3, 0.8], 0.9),
};

const BOW: DisplayTable = {
  ...GENERATED,
  thirdperson_righthand: transform([-80, 260, -40], [-1, -2, 2.5], 0.9),
  thirdperson_lefthand: transform([-80, -280, 40], [-1, -2, 2.5], 0.9),
  firstperson_righthand: transform([0, -90, 25], [1.13, 3.2, 1.13], 0.68),
  firstperson_lefthand: transform([0, 90, -25], [1.13, 3.2, 1.13], 0.68),
};

const CROSSBOW: DisplayTable = {
  ...GENERATED,
  thirdperson_righthand: transform([-90, 0, -60], [2, 0.1, -3], 0.9),
  thirdperson_lefthand: transform([-90, 0, 30], [2, 0.1, -3], 0.9),
  firstperson_righthand: transform([-90, 0, -55], [1.13, 3.2, 1.13], 0.68),
  firstperson_lefthand: transform([-90, 0, 35], [1.13, 3.2, 1.13], 0.68),
};

const SPEAR_IN_HAND: DisplayTable = {
  ...GENERATED,
  firstperson_righthand: transform([-20, 90, -35], [3.13, 2, 0.13], [1.36, 1.36, 0.68]),
  firstperson_lefthand: transform([-20, -90, 35], [3.13, 2, 0.13], [1.36, 1.36, 0.68]),
  thirdperson_righthand: transform([5, 270, -40], [0, 2, 2], [1.7, 1.7, 0.85]),
  thirdperson_lefthand: transform([5, -270, 40], [0, 2, 2], [1.7, 1.7, 0.85]),
};

/** v rotated by Minecraft's display Euler order, then scaled. */
function rotateAndScale(v: Vec3, rotation: Vec3, scale: Vec3): Vec3 {
  const [rx, ry, rz] = rotation.map((degrees) => (degrees * Math.PI) / 180);
  let x = v[0] * scale[0];
  let y = v[1] * scale[1];
  let z = v[2] * scale[2];

  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];

  return [x, y, z];
}

/**
 * Vanilla's shield numbers place a special renderer whose origin is the model's
 * corner. A skin's plate is centred on (8, 8, 8) instead, so each translation is
 * shifted to land the plate in the same spot.
 */
function recentreForCentredModel(table: DisplayTable): DisplayTable {
  const out: DisplayTable = {};
  for (const [context, entry] of Object.entries(table)) {
    const rotation = entry.rotation ?? [0, 0, 0];
    const scale = entry.scale ?? [1, 1, 1];
    const translation = entry.translation ?? [0, 0, 0];
    const shift = rotateAndScale([-8, -8, -8], rotation, scale);
    out[context] = {
      rotation,
      scale,
      translation: [
        Math.round((translation[0] + shift[0]) * 1000) / 1000,
        Math.round((translation[1] + shift[1]) * 1000) / 1000,
        Math.round((translation[2] + shift[2]) * 1000) / 1000,
      ],
    };
  }
  return out;
}

/**
 * A smaller diagonal item is kept with its handle in the hand, which moves its
 * middle off-centre by this many units along the item. Where the item is not being
 * held (inventory, item frame, on the ground) it is moved back to the centre.
 */
export function displayForGripShift(table: DisplayTable, gripShift: number): DisplayTable {
  if (gripShift <= 0) return table;

  const along = gripShift * Math.SQRT1_2;
  const out: DisplayTable = { ...table };

  for (const context of ["gui", "fixed", "ground"]) {
    const entry = table[context] ?? {};
    const rotation = entry.rotation ?? [0, 0, 0];
    const scale = entry.scale ?? [1, 1, 1];
    const translation = entry.translation ?? [0, 0, 0];
    const shift = rotateAndScale([along, along, 0], rotation, scale);
    out[context] = {
      rotation,
      scale,
      translation: [
        Math.round((translation[0] + shift[0]) * 1000) / 1000,
        Math.round((translation[1] + shift[1]) * 1000) / 1000,
        Math.round((translation[2] + shift[2]) * 1000) / 1000,
      ],
    };
  }

  return out;
}

const SHIELD: DisplayTable = recentreForCentredModel({
  thirdperson_righthand: transform([0, 90, 0], [10, 6, -4], 1),
  thirdperson_lefthand: transform([0, 90, 0], [10, 6, 12], 1),
  firstperson_righthand: transform([0, 180, 5], [-10, 1.75, -10], 1.25),
  firstperson_lefthand: transform([0, 180, 5], [10, 0, -10], 1.25),
  gui: transform([15, -25, -5], [2, 3, 0], 0.65),
  fixed: transform([0, 180, 0], [-4.5, 4.5, -5], 0.55),
  on_shelf: transform([0, 0, 0], [11, 18.5, 8.7], 1.4),
  ground: transform([0, 0, 0], [2, 4, 2], 0.25),
});

export type ThicknessShape =
  /** Thin sharp edges that thicken toward the middle. */
  | "blade"
  /** Thick throughout, rounding off only slightly. */
  | "round"
  /** An even plate with softened edges. */
  | "plate";

export type ItemProfile = {
  key: string;
  label: string;
  /** Diagonal items are modelled upright, then the whole model is turned 45 degrees. */
  frame: "diagonal" | "upright";
  shape: ThicknessShape;
  display: DisplayTable;
  /** Longest side of the item, in model units. */
  length: number;
  /** Widest the item may be, in model units. */
  maxWidth: number;
  edge: number;
  middle: number;
  handle: number;
  handleFraction: number;
  /** Shown beside the item choice when something about it is worth knowing. */
  note?: string;
};

const WORN_NOTE = "Changes how it looks in hand and in the inventory. The worn armour stays vanilla.";

export const PROFILES: Record<string, ItemProfile> = {
  sword: { key: "sword", label: "Sword", frame: "diagonal", shape: "blade", display: HANDHELD, length: 20, maxWidth: 12, edge: 0.12, middle: 1.1, handle: 1.3, handleFraction: 0.24 },
  axe: { key: "axe", label: "Axe", frame: "diagonal", shape: "blade", display: HANDHELD, length: 19, maxWidth: 13, edge: 0.15, middle: 1.5, handle: 1.2, handleFraction: 0.55 },
  pickaxe: { key: "pickaxe", label: "Pickaxe", frame: "diagonal", shape: "blade", display: HANDHELD, length: 19, maxWidth: 15, edge: 0.15, middle: 1.4, handle: 1.2, handleFraction: 0.65 },
  hoe: { key: "hoe", label: "Hoe", frame: "diagonal", shape: "blade", display: HANDHELD, length: 19, maxWidth: 13, edge: 0.15, middle: 1.2, handle: 1.2, handleFraction: 0.65 },
  shovel: { key: "shovel", label: "Shovel", frame: "diagonal", shape: "blade", display: HANDHELD, length: 19, maxWidth: 8, edge: 0.15, middle: 1.2, handle: 1.2, handleFraction: 0.6 },
  spear: { key: "spear", label: "Spear", frame: "diagonal", shape: "blade", display: SPEAR_IN_HAND, length: 20, maxWidth: 8, edge: 0.1, middle: 0.8, handle: 0.9, handleFraction: 0.72 },
  trident: { key: "trident", label: "Trident", frame: "diagonal", shape: "blade", display: HANDHELD, length: 20, maxWidth: 10, edge: 0.12, middle: 0.9, handle: 0.95, handleFraction: 0.62, note: "A thrown trident keeps the vanilla entity model." },
  mace: { key: "mace", label: "Mace", frame: "diagonal", shape: "plate", display: HANDHELD_MACE, length: 19, maxWidth: 12, edge: 0.6, middle: 2.2, handle: 1.2, handleFraction: 0.55 },
  rod: { key: "rod", label: "Fishing rod", frame: "diagonal", shape: "round", display: HANDHELD_ROD, length: 20, maxWidth: 8, edge: 0.9, middle: 1.1, handle: 1.4, handleFraction: 0.3, note: "Casting keeps this model, so the reel does not change when cast." },
  stick: { key: "stick", label: "Stick-like", frame: "diagonal", shape: "round", display: HANDHELD, length: 19, maxWidth: 8, edge: 0.8, middle: 1, handle: 1.2, handleFraction: 0.3 },
  bow: { key: "bow", label: "Bow", frame: "upright", shape: "round", display: BOW, length: 16, maxWidth: 16, edge: 0.5, middle: 1, handle: 1.2, handleFraction: 0, note: "Drawing keeps this model, so the pull stages do not animate." },
  crossbow: { key: "crossbow", label: "Crossbow", frame: "upright", shape: "plate", display: CROSSBOW, length: 16, maxWidth: 16, edge: 0.6, middle: 1.5, handle: 1.4, handleFraction: 0, note: "Loading keeps this model, so the pull stages do not animate." },
  shield: { key: "shield", label: "Shield", frame: "upright", shape: "plate", display: SHIELD, length: 22, maxWidth: 14, edge: 0.6, middle: 1.3, handle: 1.3, handleFraction: 0 },
  armor: { key: "armor", label: "Armour", frame: "upright", shape: "plate", display: GENERATED, length: 16, maxWidth: 16, edge: 0.5, middle: 1.4, handle: 1.2, handleFraction: 0, note: WORN_NOTE },
  flat: { key: "flat", label: "Other item", frame: "upright", shape: "plate", display: GENERATED, length: 16, maxWidth: 16, edge: 0.4, middle: 1, handle: 1, handleFraction: 0 },
};

export type SkinItem = {
  id: string;
  label: string;
  profile: string;
  group: string;
  /** First release that has this item. Omitted when every supported version does. */
  since?: string;
};

const TOOL_MATERIALS: [string, string, string?][] = [
  ["wooden", "Wooden"],
  ["stone", "Stone"],
  ["copper", "Copper", "1.21.9"],
  ["iron", "Iron"],
  ["golden", "Golden"],
  ["diamond", "Diamond"],
  ["netherite", "Netherite", "1.16"],
];

const ARMOR_MATERIALS: [string, string, string?][] = [
  ["leather", "Leather"],
  ["chainmail", "Chainmail"],
  ["copper", "Copper", "1.21.9"],
  ["iron", "Iron"],
  ["golden", "Golden"],
  ["diamond", "Diamond"],
  ["netherite", "Netherite", "1.16"],
];

function toolFamily(suffix: string, label: string, profile: string, since?: string): SkinItem[] {
  return TOOL_MATERIALS.map(([material, materialLabel, materialSince]) => ({
    id: `${material}_${suffix}`,
    label: `${materialLabel} ${label}`,
    profile,
    group: `${label}s`,
    since: since ?? materialSince,
  }));
}

function armorFamily(suffix: string, label: string): SkinItem[] {
  return ARMOR_MATERIALS.map(([material, materialLabel, materialSince]) => ({
    id: `${material}_${suffix}`,
    label: `${materialLabel} ${label}`,
    profile: "armor",
    group: "Armour",
    since: materialSince,
  }));
}

export const SKIN_ITEMS: SkinItem[] = [
  ...toolFamily("sword", "Sword", "sword"),
  ...toolFamily("axe", "Axe", "axe"),
  ...toolFamily("pickaxe", "Pickaxe", "pickaxe"),
  ...toolFamily("hoe", "Hoe", "hoe"),
  ...toolFamily("shovel", "Shovel", "shovel"),
  ...toolFamily("spear", "Spear", "spear", "1.21.11"),
  { id: "fishing_rod", label: "Fishing Rod", profile: "rod", group: "Other tools" },
  { id: "bow", label: "Bow", profile: "bow", group: "Other tools" },
  { id: "crossbow", label: "Crossbow", profile: "crossbow", group: "Other tools" },
  { id: "trident", label: "Trident", profile: "trident", group: "Other tools" },
  { id: "mace", label: "Mace", profile: "mace", group: "Other tools", since: "1.21" },
  { id: "shield", label: "Shield", profile: "shield", group: "Other tools" },
  ...armorFamily("helmet", "Helmet"),
  { id: "turtle_helmet", label: "Turtle Shell", profile: "armor", group: "Armour" },
  ...armorFamily("chestplate", "Chestplate"),
  ...armorFamily("leggings", "Leggings"),
  ...armorFamily("boots", "Boots"),
  { id: "elytra", label: "Elytra", profile: "armor", group: "Armour" },
  { id: "carrot_on_a_stick", label: "Carrot on a Stick", profile: "rod", group: "Other items" },
  { id: "warped_fungus_on_a_stick", label: "Warped Fungus on a Stick", profile: "rod", group: "Other items", since: "1.16" },
  { id: "stick", label: "Stick", profile: "stick", group: "Other items" },
  { id: "blaze_rod", label: "Blaze Rod", profile: "stick", group: "Other items" },
  { id: "breeze_rod", label: "Breeze Rod", profile: "stick", group: "Other items", since: "1.21" },
  { id: "shears", label: "Shears", profile: "flat", group: "Other items" },
  { id: "brush", label: "Brush", profile: "stick", group: "Other items", since: "1.20" },
  { id: "flint_and_steel", label: "Flint and Steel", profile: "flat", group: "Other items" },
  { id: "totem_of_undying", label: "Totem of Undying", profile: "flat", group: "Other items" },
];

const ITEM_BY_ID = new Map(SKIN_ITEMS.map((item) => [item.id, item]));

export function findItem(itemId: string): SkinItem {
  return ITEM_BY_ID.get(itemId) ?? SKIN_ITEMS[0];
}

export function profileFor(itemId: string): ItemProfile {
  return PROFILES[findItem(itemId).profile] ?? PROFILES.flat;
}

/** Every material of this item, such as all swords. Just itself when it has no family. */
export function familyOf(itemId: string): SkinItem[] {
  const item = findItem(itemId);
  const underscore = item.id.indexOf("_");
  if (underscore < 0) return [item];

  const suffix = item.id.slice(underscore);
  const family = SKIN_ITEMS.filter(
    (candidate) => candidate.profile === item.profile && candidate.id.endsWith(suffix)
  );
  return family.length > 0 ? family : [item];
}
