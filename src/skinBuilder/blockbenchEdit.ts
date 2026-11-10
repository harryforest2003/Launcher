import { encodePng } from "./encode";
import { glowStrip, GLOW_FRAMES } from "./build";
import type { BlockbenchModelSave, SkinMeta } from "./types";

/*
 * Turns what Blockbench saved back into a Skin Builder skin: its model.json, texture
 * and glow, which are what packs are built from. The boxes come straight from the
 * Blockbench file, with each face pointing at #s (the skin) or #g (the glow) as before.
 */

type ModelFace = { uv: number[]; texture: string };
type ModelElement = {
  from: number[];
  to: number[];
  rotation?: { angle: number; axis: "x" | "y" | "z"; origin: number[] };
  faces: Record<string, ModelFace>;
};

const DIRECTIONS = ["north", "east", "south", "west", "up", "down"];

function pngBytes(dataUrl: string) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function decodePng(bytes: Uint8Array) {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This window could not create a 2D canvas.");
  ctx.drawImage(bitmap, 0, 0);
  return { rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
}

/* Nearest-neighbour scaling, so pixel art stays sharp. */
function scaleRgba(rgba: ArrayLike<number>, width: number, height: number, toWidth: number, toHeight: number) {
  const out = new Uint8ClampedArray(toWidth * toHeight * 4);
  for (let y = 0; y < toHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / toHeight));
    for (let x = 0; x < toWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x * width) / toWidth));
      out.set(Array.prototype.slice.call(rgba, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * toWidth + x) * 4);
    }
  }
  return out;
}

/* Java models turn a box about one axis, in steps of 22.5 degrees. */
function javaRotation(element: { rotation?: number[]; origin?: number[]; name?: string }) {
  const angles = element.rotation ?? [0, 0, 0];
  const turned = angles.map((angle, index) => ({ angle, axis: (["x", "y", "z"] as const)[index] })).filter((entry) => entry.angle);

  if (turned.length === 0) return undefined;

  const [only] = turned;
  if (turned.length > 1 || Math.abs(only.angle) > 45 || Math.abs(only.angle / 22.5 - Math.round(only.angle / 22.5)) > 1e-6) {
    throw new Error(
      `"${element.name ?? "A box"}" is turned in a way Minecraft item models can't show. ` +
        "Turn boxes about one axis only, by -45, -22.5, 22.5 or 45 degrees."
    );
  }

  return { angle: only.angle, axis: only.axis, origin: element.origin ?? [8, 8, 8] };
}

async function thumbnail(rgba: Uint8ClampedArray, width: number, height: number, diagonal: boolean) {
  const SIZE = 128;
  const texture = document.createElement("canvas");
  texture.width = width;
  texture.height = height;
  texture.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This window could not create a 2D canvas.");

  const extent = diagonal ? (width + height) / Math.SQRT2 : Math.max(width, height);
  const scale = (SIZE * 0.95) / extent;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(SIZE / 2, SIZE / 2);
  if (diagonal) ctx.rotate(Math.PI / 4);
  ctx.scale(scale, scale);
  ctx.drawImage(texture, -width / 2, -height / 2);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The preview icon could not be created.");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function applyBlockbenchEdit(meta: SkinMeta, saved: BlockbenchModelSave, diagonal: boolean) {
  const api = window.skinBuilderAPI;
  const original = JSON.parse(new TextDecoder().decode(await api.readSkinFile(meta.id, "model.json")));
  const project = JSON.parse(saved.model);

  // A face's texture is an index into the project's textures, which keep their names.
  const keyByIndex = (project.textures ?? []).map((texture: { name: string }) =>
    /glow/i.test(texture.name) ? "#g" : "#s"
  );

  const elements: ModelElement[] = (project.elements ?? [])
    .filter((element: { type?: string; visibility?: boolean }) => (element.type ?? "cube") === "cube" && element.visibility !== false)
    .map((element: {
      name?: string;
      from: number[];
      to: number[];
      origin?: number[];
      rotation?: number[];
      faces: Record<string, { uv: number[]; texture: number | null }>;
    }) => {
      const faces: Record<string, ModelFace> = {};

      for (const direction of DIRECTIONS) {
        const face = element.faces?.[direction];
        if (face && face.texture !== null && face.texture !== undefined && keyByIndex[face.texture]) {
          faces[direction] = { uv: face.uv, texture: keyByIndex[face.texture] };
        }
      }

      const rotation = javaRotation(element);
      return { from: element.from, to: element.to, ...(rotation ? { rotation } : {}), faces };
    })
    .filter((element: ModelElement) => Object.keys(element.faces).length > 0);

  if (elements.length === 0) throw new Error("The model came back from Blockbench with no boxes in it.");

  const byName = new Map(saved.textures.map((texture) => [texture.name, texture.image]));
  const textureImage = byName.get("texture.png") ?? saved.textures.find((texture) => !/glow/i.test(texture.name))?.image;
  if (!textureImage) throw new Error("The skin's texture didn't come back from Blockbench.");

  const texturePng = pngBytes(textureImage);
  const texture = await decodePng(texturePng);

  const files: Record<string, Uint8Array> = {
    "texture.png": texturePng,
    "skin.bbmodel": new TextEncoder().encode(saved.model),
    "thumb.png": await thumbnail(texture.rgba, texture.width, texture.height, diagonal),
  };

  // The glow comes back as its still frame. Its animation is rebuilt from that, the
  // same way the Skin Builder made it in the first place.
  const glowImage = byName.get("glow.png");
  let glowInfo = original.glow ?? null;
  let glowPixels = 0;

  if (glowImage && glowInfo) {
    const stillPng = pngBytes(glowImage);
    const still = await decodePng(stillPng);
    const frame = scaleRgba(still.rgba, still.width, still.height, glowInfo.frameWidth, glowInfo.frameHeight);

    files["glow_still.png"] = stillPng;
    files["glow.png"] = await encodePng(
      glowStrip(frame, glowInfo.frameWidth, glowInfo.frameHeight),
      glowInfo.frameWidth,
      glowInfo.frameHeight * GLOW_FRAMES
    );
    glowInfo = { ...glowInfo, frames: GLOW_FRAMES };
    glowPixels = glowInfo.frameWidth * glowInfo.frameHeight + still.width * still.height;
  }

  files["model.json"] = new TextEncoder().encode(
    JSON.stringify({ elements, display: project.display ?? original.display, glow: glowInfo })
  );

  return api.saveSkin(
    {
      ...meta,
      updatedAt: new Date().toISOString(),
      textureWidth: texture.width,
      textureHeight: texture.height,
      elementCount: elements.length,
      atlasPixels: texture.width * texture.height + glowPixels,
    },
    files
  );
}
