/** What the user chose for one skin. Saved with it so it can be edited later. */
export type BuildParams = {
  itemId: string;
  /** Clockwise rotation, in degrees, that stands the source image upright. */
  angle: number;
  /** Turns the item end over, for when the handle was detected at the wrong end. */
  flip: boolean;
  /** Longest side of the texture in pixels. */
  textureSize: 64 | 128 | 256 | 512 | 1024;
  /** Geometry cells along the longest side. More rows mean more elements. */
  rows: 32 | 64 | 128 | 256;
  /** Thickness in model units, where 16 units is one block. */
  edge: number;
  middle: number;
  handle: number;
  /** Share of the item's length, from its bottom, that counts as handle. */
  handleFraction: number;
  /** How many thickness steps the big blocks of the model may use. */
  levels: number;
  /** Size in-game, where 1 is the item's normal size. */
  modelScale: number;
  /** 0 to 1: how readily detail in the image becomes raised or sunken voxels. */
  surfaceDetail: number;
  /** Cuts the outline at texture resolution, so it stays smooth on bigger boxes. */
  smoothOutline: boolean;
  /** Voxel detail is reduced until the model fits within this many elements. */
  maxElements: number;
  /** Adds an emissive layer, with an animated skin and a still twin of it. */
  glow: boolean;
  /** 0 to 1: how much of the item's brightest colour glows. */
  glowAmount: number;
  /** Applies the skin to every material of the item, such as all swords. */
  allMaterials: boolean;
};

export type ModelFace = {
  uv: [number, number, number, number];
  /** #s is the item's texture, and #g its glow layer. */
  texture: "#s" | "#g";
};

export type ModelElement = {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "z"; angle: number };
  shade?: boolean;
  light_emission?: number;
  faces: Partial<Record<"north" | "east" | "south" | "west" | "up" | "down", ModelFace>>;
};

/** How a saved skin's glow.png strip divides into frames. */
export type GlowInfo = {
  frames: number;
  frameWidth: number;
  frameHeight: number;
};

export type DisplayTransform = {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
};

export type DisplayTable = Record<string, DisplayTransform>;

export type SkinGroup = {
  id: string;
  name: string;
  createdAt: string;
};

export type SkinMeta = {
  id: string;
  name: string;
  itemId: string;
  /** null means the skin is a single, outside any group. */
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
  textureWidth: number;
  textureHeight: number;
  elementCount: number;
  /** Texture pixels this skin takes in the item atlas, including any glow. */
  atlasPixels: number;
  params: BuildParams;
  /** Small preview as a data URL. Added by the store when the library is read. */
  thumb?: string;
};

export type SkinLibrary = {
  groups: SkinGroup[];
  skins: SkinMeta[];
};

export type WritePackResult =
  | { written: true; path: string }
  | { written: false; exists: true; path: string };

/** Implemented by electron/skinBuilder/ipc.cjs, and by the web preview's mock. */
export type SkinBuilderAPI = {
  getLibrary(): Promise<SkinLibrary>;
  saveSkin(meta: SkinMeta, files: Record<string, Uint8Array>): Promise<SkinMeta>;
  readSkinFile(id: string, file: string): Promise<Uint8Array>;
  updateSkin(id: string, patch: { name?: string; groupId?: string | null }): Promise<SkinMeta>;
  deleteSkin(id: string): Promise<void>;

  createGroup(name: string): Promise<SkinGroup>;
  renameGroup(id: string, name: string): Promise<SkinGroup>;
  /** Skins in the group become singles; they are not deleted. */
  deleteGroup(id: string): Promise<void>;

  /** The remembered output folder, or "" if none has been chosen yet. */
  getOutputFolder(): Promise<string>;
  pickOutputFolder(): Promise<string | null>;
  writePack(fileName: string, bytes: Uint8Array, overwrite?: boolean): Promise<WritePackResult>;

  revealPath(path: string): Promise<void>;
  /** Resolves when the editor closes, with what was saved last, or null. */
  editInBlockbench(id: string): Promise<BlockbenchModelSave | null>;
};

declare global {
  interface Window {
    skinBuilderAPI: SkinBuilderAPI;
  }
}

/** What Blockbench sends back for a model: the project file and its textures, by name. */
export type BlockbenchModelSave = {
  model: string;
  textures: { name: string; image: string }[];
};
