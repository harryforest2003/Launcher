import { pngDataUrl } from "./encode";
import type { DisplayTable, ModelElement } from "./types";

/*
 * A Blockbench project in its generic ("free") format with the textures embedded,
 * so the file opens on its own. UVs stay on Minecraft's 0-16 scale, which works
 * for a non-square texture because uv_width and uv_height describe that scale
 * rather than the image's size.
 *
 * The glow is embedded as its still frame. Blockbench assumes an animation's frames
 * are square, and a skin's usually aren't.
 */

const FACE_NAMES = ["north", "east", "south", "west", "up", "down"] as const;

function uuid() {
  return crypto.randomUUID();
}

function textureEntry(name: string, id: number, png: Uint8Array, width: number, height: number, emissive: boolean) {
  return {
    path: "",
    name,
    folder: "item",
    namespace: "skin_builder",
    id: String(id),
    width,
    height,
    uv_width: 16,
    uv_height: 16,
    particle: id === 0,
    use_as_default: false,
    layers_enabled: false,
    sync_to_project: "",
    render_mode: emissive ? "emissive" : "default",
    render_sides: "auto",
    frame_time: 1,
    frame_order_type: "loop",
    frame_order: "",
    frame_interpolate: false,
    visible: true,
    internal: true,
    saved: false,
    uuid: uuid(),
    relative_path: "",
    source: pngDataUrl(png),
  };
}

export function buildBbmodel(options: {
  name: string;
  elements: ModelElement[];
  display: DisplayTable;
  texturePng: Uint8Array;
  textureWidth: number;
  textureHeight: number;
  glow?: { stillPng: Uint8Array; width: number; height: number } | null;
}) {
  const { name, elements, display, texturePng, textureWidth, textureHeight, glow } = options;

  const cubes = elements.map((element, index) => {
    const isGlow = Boolean(element.light_emission);
    const faces: Record<string, { uv: number[]; texture: number | null }> = {};
    for (const faceName of FACE_NAMES) {
      const face = element.faces[faceName];
      // A face the game does not draw is switched off, not given a blank texture.
      faces[faceName] = face
        ? { uv: face.uv, texture: face.texture === "#g" ? 1 : 0 }
        : { uv: [0, 0, 0, 0], texture: null };
    }

    return {
      name: `${isGlow ? "glow" : "part"}_${index}`,
      box_uv: false,
      rescale: false,
      locked: false,
      light_emission: element.light_emission ?? 0,
      shade: element.shade ?? true,
      render_order: "default",
      allow_mirror_modeling: true,
      from: element.from,
      to: element.to,
      autouv: 0,
      color: isGlow ? 5 : 0,
      origin: element.rotation?.origin ?? [8, 8, 8],
      rotation: element.rotation ? [0, 0, element.rotation.angle] : [0, 0, 0],
      faces,
      type: "cube",
      uuid: uuid(),
    };
  });

  const textures = [textureEntry("texture.png", 0, texturePng, textureWidth, textureHeight, false)];
  if (glow) textures.push(textureEntry("glow.png", 1, glow.stillPng, glow.width, glow.height, true));

  return {
    meta: { format_version: "4.10", model_format: "free", box_uv: false },
    name,
    model_identifier: name,
    visible_box: [2, 3, 0],
    variable_placeholders: "",
    variable_placeholder_buttons: [],
    timeline_setups: [],
    unhandled_root_fields: {},
    resolution: { width: 16, height: 16 },
    elements: cubes,
    outliner: [
      {
        name,
        origin: [8, 8, 8],
        color: 0,
        uuid: uuid(),
        export: true,
        mirror_uv: false,
        isOpen: true,
        locked: false,
        visibility: true,
        autouv: 0,
        children: cubes.map((cube) => cube.uuid),
      },
    ],
    textures,
    display,
  };
}
