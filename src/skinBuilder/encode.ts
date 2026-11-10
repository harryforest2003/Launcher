/*
 * PNG and ZIP writers. Canvas PNG export is avoided for textures because a canvas
 * stores premultiplied colour, which would wipe the RGB bled into transparent
 * texels. That colour is what stops a dark fringe appearing in the atlas mipmaps.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function compress(bytes: Uint8Array, format: "deflate" | "deflate-raw") {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function encodePng(rgba: ArrayLike<number>, width: number, height: number) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < stride; x += 1) raw[rowStart + 1 + x] = rgba[y * stride + x];
  }

  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i += 1) body[i] = type.charCodeAt(i);
    body.set(data, 4);

    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA

  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", await compress(raw, "deflate")),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Reads back a PNG written by encodePng, keeping the RGB under transparent texels.
 * Canvas decoding would lose that colour, so this only handles encodePng's format.
 */
export async function decodeOwnPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (bytes[24] !== 8 || bytes[25] !== 6) throw new Error("This texture is not in the expected format.");

  const compressed: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === "IDAT") compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const stream = new Blob(compressed as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const stride = width * 4;
  const rgba = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    if (raw[rowStart] !== 0) throw new Error("This texture is not in the expected format.");
    rgba.set(raw.subarray(rowStart + 1, rowStart + 1 + stride), y * stride);
  }
  return { rgba, width, height };
}

/**
 * Half the size in both directions. Colour averages the opaque texels, so the
 * transparent background never darkens an edge. Alpha stays fully on or off.
 */
export function halveRgba(rgba: ArrayLike<number>, width: number, height: number) {
  const outWidth = width >> 1;
  const outHeight = height >> 1;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let opaque = 0;
      const opaqueSum = [0, 0, 0];
      const allSum = [0, 0, 0];
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const p = ((y * 2 + dy) * width + x * 2 + dx) * 4;
          const isOpaque = rgba[p + 3] >= 128;
          if (isOpaque) opaque += 1;
          for (let c = 0; c < 3; c += 1) {
            allSum[c] += rgba[p + c];
            if (isOpaque) opaqueSum[c] += rgba[p + c];
          }
        }
      }
      const q = (y * outWidth + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        out[q + c] = opaque > 0 ? opaqueSum[c] / opaque : allSum[c] / 4;
      }
      out[q + 3] = opaque >= 2 ? 255 : 0;
    }
  }

  return { rgba: out, width: outWidth, height: outHeight };
}

/** A single-channel map (mask or marks) as a compact greyscale-in-RGBA PNG. */
export function encodeMapPng(map: Uint8Array, width: number, height: number, multiplier: number) {
  const rgba = new Uint8Array(map.length * 4);
  for (let i = 0; i < map.length; i += 1) {
    const value = map[i] * multiplier;
    rgba[i * 4] = value;
    rgba[i * 4 + 1] = value;
    rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(rgba, width, height);
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function pngDataUrl(bytes: Uint8Array) {
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}

export type ZipEntry = {
  path: string;
  data: Uint8Array;
};

/** PNGs are stored as they are; anything else is deflated. */
export async function buildZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  // 2026-01-01 00:00, so rebuilding identical skins gives an identical zip.
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const store = entry.path.endsWith(".png");
    const body = store ? entry.data : await compress(entry.data, "deflate-raw");
    const method = store ? 0 : 8;

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 names
    localView.setUint16(8, method, true);
    localView.setUint16(10, DOS_TIME, true);
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, method, true);
    centralView.setUint16(12, DOS_TIME, true);
    centralView.setUint16(14, DOS_DATE, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    localParts.push(local, body);
    centralParts.push(central);
    offset += local.length + body.length;
  }

  const centralBytes = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, offset, true);

  return concatBytes([...localParts, centralBytes, end]);
}
