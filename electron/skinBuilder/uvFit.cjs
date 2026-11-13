/*
 * Makes a Blockbench project's UV size match its textures' real sizes, so each texture
 * shows in Blockbench exactly as it is, one UV unit to a pixel. The faces' UVs are
 * scaled to match, so the model looks the same. Files saved before the UV size followed
 * the texture (16 by 16, whatever the image) open correctly this way too.
 */

const PNG_DATA_URL = /^data:image\/png;base64,/;

/* A PNG's size from its header, or null if it isn't one. */
function pngSize(dataUrl) {
    if (typeof dataUrl !== "string" || !PNG_DATA_URL.test(dataUrl)) return null;
    const head = Buffer.from(dataUrl.replace(PNG_DATA_URL, "").slice(0, 44), "base64");
    if (head.length < 24 || head.toString("latin1", 12, 16) !== "IHDR") return null;
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    return width && height ? { width, height } : null;
}

const round = (value) => +value.toFixed(4);

/* Scales a face's UVs: [u1, v1, u2, v2] on a cube, { vertex: [u, v] } on a mesh. */
function scaleUv(uv, sx, sy) {
    if (Array.isArray(uv)) return uv.map((value, i) => (typeof value === "number" ? round(value * (i % 2 === 0 ? sx : sy)) : value));
    if (uv && typeof uv === "object") {
        return Object.fromEntries(Object.entries(uv).map(([key, pair]) => [key, Array.isArray(pair) ? [round(pair[0] * sx), round(pair[1] * sy)] : pair]));
    }
    return uv;
}

/* The project with its UV size fitted to its textures (changed in place, and returned). */
function fitUvToTextures(project) {
    const textures = Array.isArray(project?.textures) ? project.textures : [];
    if (!textures.length) return project;

    const resolution = { width: project.resolution?.width || 16, height: project.resolution?.height || 16 };
    const scales = textures.map((texture) => {
        const size = pngSize(texture.source) ?? (texture.width && texture.height ? { width: texture.width, height: texture.height } : null);
        const from = { width: texture.uv_width || resolution.width, height: texture.uv_height || resolution.height };
        if (!size) return { sx: 1, sy: 1, size: from };
        return { sx: size.width / from.width, sy: size.height / from.height, size };
    });

    // The project's own UV size (used by faces with no texture) follows its first texture.
    const main = scales[0].size;
    const projectScale = { sx: main.width / resolution.width, sy: main.height / resolution.height };

    for (const element of project.elements ?? []) {
        for (const face of Object.values(element.faces ?? {})) {
            if (!face) continue;
            const index = typeof face.texture === "number" ? face.texture : null;
            const { sx, sy } = index !== null && scales[index] ? scales[index] : projectScale;
            if (sx !== 1 || sy !== 1) face.uv = scaleUv(face.uv, sx, sy);
        }
        // Box UV places a cube by one corner, in the project's UV size.
        if (Array.isArray(element.uv_offset) && (projectScale.sx !== 1 || projectScale.sy !== 1)) {
            element.uv_offset = [round(element.uv_offset[0] * projectScale.sx), round(element.uv_offset[1] * projectScale.sy)];
        }
    }

    textures.forEach((texture, i) => {
        texture.width = scales[i].size.width;
        texture.height = scales[i].size.height;
        texture.uv_width = scales[i].size.width;
        texture.uv_height = scales[i].size.height;
    });
    project.resolution = { width: main.width, height: main.height };
    return project;
}

module.exports = { fitUvToTextures, pngSize };
