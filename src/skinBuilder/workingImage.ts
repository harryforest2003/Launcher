import { OLDER_SKIN_DEFAULTS, defaultParams, guessOrientation, type BuiltModel } from "./build";
import { buildBbmodel } from "./bbmodel";
import { profileFor } from "./catalog";
import { encodeMapPng, encodePng } from "./encode";
import type { BuildParams, SkinMeta } from "./types";

/** The cut-out is solved and edited at this size, which keeps re-running it fast. */
const WORKING_SIZE = 512;
/** Colour for the texture comes from a copy up to this size, for high resolution skins. */
const DETAIL_SIZE = 2048;

export type Draft = {
  /** Set when editing a saved skin, so saving replaces it. */
  id: string | null;
  createdAt: string | null;
  name: string;
  groupId: string | null;
  /** The image at working size. The mask and marks line up with this. */
  source: HTMLCanvasElement;
  /** The image at the best size kept, used for the texture's colour. */
  detail: HTMLCanvasElement;
  mask: Uint8Array;
  hints: Uint8Array;
  params: BuildParams | null;
};

function readableName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const name = base ? base[0].toUpperCase() + base.slice(1) : "New skin";
  return name.slice(0, 40);
}

export function canvasOf(image: ImageBitmap, maxSize = Infinity) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This window could not create a 2D canvas.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function imageDataOf(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This window could not create a 2D canvas.");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function loadWorkingImage(file: File) {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error(`"${file.name}" could not be read as an image. Try a PNG, JPEG or WebP.`);
  }

  const source = canvasOf(image, WORKING_SIZE);
  const detail = canvasOf(image, DETAIL_SIZE);
  image.close();
  return { source, detail, name: readableName(file.name) };
}

/** Reads a mask or marks PNG back into its small integer values. */
async function decodeMap(bytes: Uint8Array, divisor: number) {
  const image = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  const canvas = canvasOf(image);
  image.close();
  const { data } = imageDataOf(canvas);
  const map = new Uint8Array(data.length / 4);
  for (let i = 0; i < map.length; i += 1) map[i] = Math.round(data[i * 4] / divisor);
  return map;
}

export async function loadDraft(meta: SkinMeta): Promise<Draft> {
  const api = window.skinBuilderAPI;
  const [sourceBytes, maskBytes, hintBytes] = await Promise.all([
    api.readSkinFile(meta.id, "source.png"),
    api.readSkinFile(meta.id, "mask.png"),
    api.readSkinFile(meta.id, "hints.png"),
  ]);

  const image = await createImageBitmap(new Blob([sourceBytes as BlobPart], { type: "image/png" }));
  const source = canvasOf(image, WORKING_SIZE);
  const detail = canvasOf(image);
  image.close();

  return {
    id: meta.id,
    createdAt: meta.createdAt,
    name: meta.name,
    groupId: meta.groupId,
    source,
    detail,
    mask: await decodeMap(maskBytes, 255),
    hints: await decodeMap(hintBytes, 100),
    params: { ...OLDER_SKIN_DEFAULTS, ...meta.params },
  };
}

export function firstParams(draft: Draft, itemId: string) {
  return defaultParams(itemId, guessOrientation(draft.mask, draft.source.width, draft.source.height, itemId));
}

/** A small icon of the finished item, drawn the way it sits in an inventory slot. */
async function renderThumb(built: BuiltModel, diagonal: boolean) {
  const SIZE = 128;
  const { raster } = built;

  const texture = document.createElement("canvas");
  texture.width = raster.width;
  texture.height = raster.height;
  texture.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba), raster.width, raster.height), 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This window could not create a 2D canvas.");

  const extent = diagonal
    ? (raster.itemWidth + raster.itemHeight) / Math.SQRT2
    : Math.max(raster.itemWidth, raster.itemHeight);
  const scale = (SIZE * 0.95) / extent;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(SIZE / 2, SIZE / 2);
  if (diagonal) ctx.rotate(Math.PI / 4);
  ctx.scale(scale, scale);
  ctx.drawImage(texture, -raster.width / 2, -raster.height / 2);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The preview icon could not be created.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function canvasPng(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be saved.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Writes everything a saved skin needs: the working files, the texture and the Blockbench file. */
export async function saveDraft(draft: Draft, built: BuiltModel, params: BuildParams) {
  const profile = profileFor(params.itemId);
  const { raster, elements, display, glow } = built;
  const texturePng = await encodePng(raster.rgba, raster.width, raster.height);
  const glowStillPng = glow ? await encodePng(glow.still, glow.stillWidth, glow.stillHeight) : null;
  const glowFiles: Record<string, Uint8Array> =
    glow && glowStillPng
      ? {
          "glow.png": await encodePng(glow.strip, glow.frameWidth, glow.frameHeight * glow.frames),
          "glow_still.png": glowStillPng,
        }
      : {};

  const bbmodel = buildBbmodel({
    name: draft.name,
    elements,
    display,
    texturePng,
    textureWidth: raster.width,
    textureHeight: raster.height,
    glow: glow && glowStillPng ? { stillPng: glowStillPng, width: glow.stillWidth, height: glow.stillHeight } : null,
  });

  const encoder = new TextEncoder();
  const now = new Date().toISOString();

  const meta: SkinMeta = {
    id: draft.id ?? crypto.randomUUID(),
    name: draft.name,
    itemId: params.itemId,
    groupId: draft.groupId,
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
    textureWidth: raster.width,
    textureHeight: raster.height,
    elementCount: elements.length,
    atlasPixels: built.atlasPixels,
    params,
  };

  const glowInfo = glow ? { frames: glow.frames, frameWidth: glow.frameWidth, frameHeight: glow.frameHeight } : undefined;

  return window.skinBuilderAPI.saveSkin(meta, {
    "source.png": await canvasPng(draft.detail),
    "mask.png": await encodeMapPng(draft.mask, draft.source.width, draft.source.height, 255),
    "hints.png": await encodeMapPng(draft.hints, draft.source.width, draft.source.height, 100),
    "texture.png": texturePng,
    "model.json": encoder.encode(JSON.stringify({ elements, display, glow: glowInfo })),
    ...glowFiles,
    "skin.bbmodel": encoder.encode(JSON.stringify(bbmodel)),
    "thumb.png": await renderThumb(built, profile.frame === "diagonal"),
  });
}
