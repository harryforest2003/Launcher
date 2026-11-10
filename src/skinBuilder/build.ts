import { displayForGripShift, profileFor, type ItemProfile } from "./catalog";
import { halveRgba } from "./encode";
import type { BuildParams, DisplayTable, ModelElement, ModelFace } from "./types";

/*
 * Turns an approved cut-out into a Minecraft model.
 *
 * Keeping the atlas cost low drives the design:
 * - The item is stood upright before it is rasterised, and diagonal items are
 *   turned back by one -45 degree element rotation. An upright item needs a narrow
 *   texture such as 32x128 instead of 128x128. Its straight edges also merge into
 *   long boxes, and -45 is a rotation every supported game version accepts.
 * - The front and back share the same texels, and the sides reuse the outermost
 *   texels, so one small texture is all a skin ever needs.
 * - Both texture sides are powers of two and at least 16. A smaller or odd sprite
 *   would lower the mipmap level of the whole atlas, for every pack loaded.
 *
 * Looks and element count are kept apart. Sharp outlines come from the texture's
 * transparency, not from more boxes. Flat areas merge into big blocks, and only
 * cells where the image has real detail become small raised or sunken voxels.
 */

const EPSILON_INSET = 0.25;

export type FrameRaster = {
  /** Straight (not premultiplied) colour, with RGB filled into transparent texels. */
  rgba: Uint8ClampedArray;
  /** 0-255 share of each texel covered by the cut-out. */
  coverage: Uint8ClampedArray;
  width: number;
  height: number;
  /** Size of the item within the texture, in texels. */
  itemWidth: number;
  itemHeight: number;
};

export type ThicknessMap = {
  cellsWide: number;
  cellsHigh: number;
  texelsPerCell: number;
  /** Per cell: 0 for empty, otherwise a 1-based index into levelValues. */
  levels: Uint8Array;
  levelValues: number[];
  /** First row counted as handle, or cellsHigh when the item has none. */
  handleRow: number;
  /** True when voxel detail was cut back to stay within the element limit. */
  detailReduced: boolean;
};

/** The emissive layer: an animated strip, and a smaller frozen copy for the still twin. */
export type GlowLayer = {
  strip: Uint8ClampedArray;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  still: Uint8ClampedArray;
  stillWidth: number;
  stillHeight: number;
};

export type BuiltModel = {
  raster: FrameRaster;
  thickness: ThicknessMap;
  glow: GlowLayer | null;
  elements: ModelElement[];
  display: DisplayTable;
  faceCount: number;
  /** Texture pixels this skin adds to the item atlas. */
  atlasPixels: number;
};

function nextPowerOfTwo(value: number) {
  let result = 16;
  while (result < value) result *= 2;
  return result;
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This window could not create a 2D canvas.");
  return ctx;
}

function isOutlinePixel(mask: Uint8Array, width: number, height: number, i: number) {
  const x = i % width;
  const y = (i - x) / width;
  return (
    x === 0 ||
    y === 0 ||
    x === width - 1 ||
    y === height - 1 ||
    !mask[i - 1] ||
    !mask[i + 1] ||
    !mask[i - width] ||
    !mask[i + width]
  );
}

/** Spreads colour into transparent texels, so mipmaps and filtering pick up no dark halo. */
function bleedColor(rgba: Uint8ClampedArray, known: Uint8Array, width: number, height: number) {
  let frontier: number[] = [];
  for (let i = 0; i < known.length; i += 1) {
    if (known[i]) frontier.push(i);
  }

  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (known[n]) continue;
        known[n] = 1;
        rgba[n * 4] = rgba[i * 4];
        rgba[n * 4 + 1] = rgba[i * 4 + 1];
        rgba[n * 4 + 2] = rgba[i * 4 + 2];
        next.push(n);
      }
    }
    frontier = next;
  }
}

/**
 * Rotates and scales the cut-out into its smallest allowed texture. The mask is
 * solved at a fixed working size, while colour comes from `detail`, which can be
 * larger, so high resolution textures use the image's real detail.
 */
export function rasterizeFrame(
  detail: HTMLCanvasElement,
  mask: Uint8Array,
  width: number,
  height: number,
  angle: number,
  flip: boolean,
  textureSize: number
): FrameRaster {
  const radians = ((angle + (flip ? 180 : 0)) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      for (const [px, py] of [
        [x, y],
        [x + 1, y + 1],
        [x + 1, y],
        [x, y + 1],
      ]) {
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      }
    }
  }

  if (!isFinite(minX)) throw new Error("The selection is empty. Mark something to keep first.");

  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const scale = textureSize / Math.max(boxWidth, boxHeight);
  const itemWidth = boxWidth * scale;
  const itemHeight = boxHeight * scale;
  const texWidth = nextPowerOfTwo(Math.ceil(itemWidth));
  const texHeight = nextPowerOfTwo(Math.ceil(itemHeight));

  // Colour comes from slightly inside the outline, where the old background has
  // not mixed into the pixels. The outline itself comes from the full mask.
  const silhouette = makeCanvas(width, height);
  const inner = makeCanvas(width, height);
  const silhouetteCtx = context2d(silhouette);
  const innerCtx = context2d(inner);

  const silhouetteData = silhouetteCtx.createImageData(width, height);
  const innerData = innerCtx.createImageData(width, height);
  for (let i = 0; i < mask.length; i += 1) {
    const keep = mask[i] ? 255 : 0;
    silhouetteData.data[i * 4] = 255;
    silhouetteData.data[i * 4 + 1] = 255;
    silhouetteData.data[i * 4 + 2] = 255;
    silhouetteData.data[i * 4 + 3] = keep;
    innerData.data[i * 4 + 3] = keep && !isOutlinePixel(mask, width, height, i) ? 255 : 0;
  }
  silhouetteCtx.putImageData(silhouetteData, 0, 0);
  innerCtx.putImageData(innerData, 0, 0);

  const colorLayer = makeCanvas(detail.width, detail.height);
  const colorCtx = context2d(colorLayer);
  colorCtx.imageSmoothingQuality = "high";
  colorCtx.drawImage(detail, 0, 0);
  colorCtx.globalCompositeOperation = "destination-in";
  colorCtx.drawImage(inner, 0, 0, detail.width, detail.height);

  const isRightAngle = Math.abs(sin) < 1e-6 || Math.abs(cos) < 1e-6;
  const keepPixelsCrisp = (scale * width) / detail.width >= 2 && isRightAngle;

  const draw = (layer: HTMLCanvasElement) => {
    const target = makeCanvas(texWidth, texHeight);
    const ctx = context2d(target);
    ctx.imageSmoothingEnabled = !keepPixelsCrisp;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(texWidth / 2, texHeight / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    ctx.rotate(radians);
    ctx.drawImage(layer, 0, 0, width, height);
    return ctx.getImageData(0, 0, texWidth, texHeight).data;
  };

  const coveragePixels = draw(silhouette);
  const rgba = draw(colorLayer);

  const coverage = new Uint8ClampedArray(texWidth * texHeight);
  const known = new Uint8Array(texWidth * texHeight);
  for (let i = 0; i < coverage.length; i += 1) {
    coverage[i] = coveragePixels[i * 4 + 3];
    known[i] = rgba[i * 4 + 3] >= 8 ? 1 : 0;
  }
  bleedColor(rgba, known, texWidth, texHeight);

  return { rgba, coverage, width: texWidth, height: texHeight, itemWidth, itemHeight };
}

/** Marks a cell solid when the cut-out covers enough of it, dropping loose specks. */
function solidCells(raster: FrameRaster, k: number, minCoverage: number) {
  const cellsWide = Math.max(1, Math.floor(raster.width / k));
  const cellsHigh = Math.max(1, Math.floor(raster.height / k));
  const solid = new Uint8Array(cellsWide * cellsHigh);

  for (let cy = 0; cy < cellsHigh; cy += 1) {
    for (let cx = 0; cx < cellsWide; cx += 1) {
      let sum = 0;
      for (let y = 0; y < k; y += 1) {
        for (let x = 0; x < k; x += 1) {
          sum += raster.coverage[(cy * k + y) * raster.width + cx * k + x];
        }
      }
      solid[cy * cellsWide + cx] = sum / (k * k) >= minCoverage ? 1 : 0;
    }
  }

  const seen = new Uint8Array(solid.length);
  const pieces: number[][] = [];
  for (let start = 0; start < solid.length; start += 1) {
    if (!solid[start] || seen[start]) continue;
    const piece: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      piece.push(i);
      const x = i % cellsWide;
      for (const n of [x > 0 ? i - 1 : -1, x < cellsWide - 1 ? i + 1 : -1, i - cellsWide, i + cellsWide]) {
        if (n >= 0 && n < solid.length && solid[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    pieces.push(piece);
  }

  const largest = pieces.reduce((max, piece) => Math.max(max, piece.length), 0);
  for (const piece of pieces) {
    if (piece.length < 3 && piece.length < largest) {
      for (const i of piece) solid[i] = 0;
    }
  }

  return { solid, cellsWide, cellsHigh };
}

/** Exact distance from every solid cell to the nearest empty one (Felzenszwalb). */
function distanceToEdge(solid: Uint8Array, width: number, height: number) {
  const INF = 1e12;
  const field = new Float64Array(solid.length);
  for (let i = 0; i < solid.length; i += 1) field[i] = solid[i] ? INF : 0;

  const transform1d = (f: Float64Array, n: number) => {
    const out = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q += 1) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
      while (z[k + 1] < q) k += 1;
      const d = q - v[k];
      out[q] = d * d + f[v[k]];
    }
    return out;
  };

  // A one-cell empty border lets edges of the grid count as the item's outline.
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const padded = new Float64Array(paddedWidth * paddedHeight);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      padded[(y + 1) * paddedWidth + x + 1] = field[y * width + x];
    }
  }

  const column = new Float64Array(paddedHeight);
  for (let x = 0; x < paddedWidth; x += 1) {
    for (let y = 0; y < paddedHeight; y += 1) column[y] = padded[y * paddedWidth + x];
    const result = transform1d(column, paddedHeight);
    for (let y = 0; y < paddedHeight; y += 1) padded[y * paddedWidth + x] = result[y];
  }

  const row = new Float64Array(paddedWidth);
  for (let y = 0; y < paddedHeight; y += 1) {
    for (let x = 0; x < paddedWidth; x += 1) row[x] = padded[y * paddedWidth + x];
    const result = transform1d(row, paddedWidth);
    for (let x = 0; x < paddedWidth; x += 1) padded[y * paddedWidth + x] = result[x];
  }

  const distance = new Float32Array(solid.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      distance[y * width + x] = Math.sqrt(padded[(y + 1) * paddedWidth + x + 1]);
    }
  }
  return distance;
}

/**
 * The tallest distance near each cell. Dividing by it gives a 0 to 1 position
 * across the local width, so a narrow tip and a wide head both reach full
 * thickness at their own centre line.
 */
function localRidge(distance: Float32Array, width: number, height: number) {
  const ridge = new Float32Array(distance.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      const radius = Math.ceil(distance[i] * 1.5) + 1;
      let best = distance[i];
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      for (let ny = y0; ny <= y1; ny += 1) {
        for (let nx = x0; nx <= x1; nx += 1) {
          const d = distance[ny * width + nx];
          if (d > best) best = d;
        }
      }
      ridge[i] = best;
    }
  }
  return ridge;
}

/**
 * How far each cell's brightness stands out from its surroundings, in standard
 * deviations. Near zero means a flat area, which should stay part of a big block.
 * Brightness is lifted the same way as in the cut-out, so dark art still registers.
 */
function detailMap(
  raster: FrameRaster,
  solid: Uint8Array,
  distance: Float32Array,
  width: number,
  height: number,
  k: number
) {
  const brightness = new Float32Array(solid.length);

  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const cell = cy * width + cx;
      if (!solid[cell]) continue;
      let sum = 0;
      for (let y = 0; y < k; y += 1) {
        for (let x = 0; x < k; x += 1) {
          const p = ((cy * k + y) * raster.width + cx * k + x) * 4;
          sum += Math.sqrt((raster.rgba[p] * 0.3 + raster.rgba[p + 1] * 0.59 + raster.rgba[p + 2] * 0.11) / 255);
        }
      }
      brightness[cell] = sum / (k * k);
    }
  }

  // Summed-area tables give each cell's local average over solid cells cheaply.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  const counts = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      const here = (y + 1) * stride + x + 1;
      sums[here] = brightness[cell] + sums[here - 1] + sums[here - stride] - sums[here - stride - 1];
      counts[here] = solid[cell] + counts[here - 1] + counts[here - stride] - counts[here - stride - 1];
    }
  }

  const radius = Math.max(2, Math.round(Math.max(width, height) / 24));
  const deviation = new Float32Array(solid.length);
  let squares = 0;
  let total = 0;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      if (!solid[cell]) continue;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
      const count = counts[y1 * stride + x1] - counts[y0 * stride + x1] - counts[y1 * stride + x0] + counts[y0 * stride + x0];
      const value = brightness[cell] - sum / Math.max(1, count);
      deviation[cell] = value;
      squares += value * value;
      total += 1;
    }
  }

  const spread = Math.sqrt(squares / Math.max(1, total)) || 1;
  for (let i = 0; i < deviation.length; i += 1) {
    // The outline stays as it is, so sharp edges are not roughened.
    deviation[i] = distance[i] < 1.5 ? 0 : deviation[i] / spread;
  }
  return deviation;
}

/** -1, 0, 1 or 2 voxel steps per cell. A lone cell is noise, so it needs a neighbour. */
function voxelSteps(deviation: Float32Array, width: number, height: number, threshold: number) {
  const raw = new Int8Array(deviation.length);
  for (let i = 0; i < raw.length; i += 1) {
    const value = deviation[i];
    raw[i] = value > threshold * 2 ? 2 : value > threshold ? 1 : value < -threshold ? -1 : 0;
  }

  const steps = new Int8Array(raw.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      if (raw[cell] === 0) continue;
      search: for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (Math.sign(raw[ny * width + nx]) === Math.sign(raw[cell])) {
            steps[cell] = raw[cell];
            break search;
          }
        }
      }
    }
  }
  return steps;
}

export function buildThicknessMap(raster: FrameRaster, params: BuildParams, profile: ItemProfile): ThicknessMap {
  const longest = Math.max(raster.width, raster.height);
  const rows = Math.min(params.rows, longest);
  const texelsPerCell = Math.max(1, Math.round(longest / rows));
  // With a smooth outline the texture's transparency trims a box to shape, so a cell
  // only has to be partly covered. Otherwise the box itself is the outline.
  const minCoverage = params.smoothOutline && texelsPerCell > 1 ? 51 : 128;
  const { solid, cellsWide, cellsHigh } = solidCells(raster, texelsPerCell, minCoverage);

  const distance = distanceToEdge(solid, cellsWide, cellsHigh);
  const ridge = localRidge(distance, cellsWide, cellsHigh);

  let topRow = cellsHigh;
  let bottomRow = -1;
  for (let y = 0; y < cellsHigh; y += 1) {
    for (let x = 0; x < cellsWide; x += 1) {
      if (solid[y * cellsWide + x]) {
        if (y < topRow) topRow = y;
        if (y > bottomRow) bottomRow = y;
      }
    }
  }

  const itemRows = bottomRow - topRow + 1;
  const handleRow =
    params.handleFraction > 0 ? bottomRow + 1 - Math.round(itemRows * params.handleFraction) : cellsHigh;
  const blendRows = Math.max(1, Math.round(itemRows * 0.03));

  const thickness = new Float32Array(solid.length);
  let minThickness = Infinity;
  let maxThickness = 0;

  for (let y = 0; y < cellsHigh; y += 1) {
    const handleBlend =
      params.handleFraction > 0 ? Math.min(1, Math.max(0, (y - handleRow + blendRows) / blendRows)) : 0;

    for (let x = 0; x < cellsWide; x += 1) {
      const i = y * cellsWide + x;
      if (!solid[i]) continue;

      const position = ridge[i] > 0 ? Math.min(1, distance[i] / ridge[i]) : 1;
      // Cells on the outline sit half a cell in, so rescale to reach the true edge.
      const fromEdge = Math.min(1, Math.max(0, (position - 0.5 / Math.max(ridge[i], 1)) * 1.08));

      let body: number;
      if (profile.shape === "blade") {
        body = params.edge + (params.middle - params.edge) * Math.pow(fromEdge, 0.8);
      } else if (profile.shape === "round") {
        body = params.edge + (params.middle - params.edge) * Math.sqrt(fromEdge);
      } else {
        body = params.edge + (params.middle - params.edge) * Math.min(1, fromEdge * 2.2);
      }

      const handleBody = params.handle * Math.sqrt(0.5 + 0.5 * fromEdge);
      const value = body + (Math.max(body, handleBody) - body) * handleBlend;

      thickness[i] = value;
      if (value < minThickness) minThickness = value;
      if (value > maxThickness) maxThickness = value;
    }
  }

  const levelCount = Math.max(1, Math.round(params.levels));
  const span = maxThickness - minThickness;
  const step = levelCount > 1 ? span / (levelCount - 1) : 0;
  const blockValues: number[] = [];
  for (let l = 0; l < levelCount; l += 1) {
    blockValues.push(levelCount > 1 ? minThickness + step * l : maxThickness);
  }

  const blocks = new Uint8Array(solid.length);
  for (let i = 0; i < solid.length; i += 1) {
    if (!solid[i]) continue;
    blocks[i] = step > 0 ? Math.round((thickness[i] - minThickness) / step) + 1 : 1;
  }

  // Inner cells take their neighbours' middle value, removing single-cell steps
  // that would each cost an element. Outline cells stay so edges remain sharp.
  const smoothed = blocks.slice();
  const neighbours: number[] = [];
  for (let y = 1; y < cellsHigh - 1; y += 1) {
    for (let x = 1; x < cellsWide - 1; x += 1) {
      const i = y * cellsWide + x;
      if (!blocks[i] || distance[i] < 1.5) continue;
      neighbours.length = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const value = blocks[i + dy * cellsWide + dx];
          if (value) neighbours.push(value);
        }
      }
      neighbours.sort((a, b) => a - b);
      smoothed[i] = neighbours[neighbours.length >> 1];
    }
  }

  /*
   * Combines each cell's block with its voxel step into one sorted table of final
   * thicknesses. Sorting matters: an index comparison later has to mean "thinner".
   */
  const cellSize = texelsPerCell * unitsPerTexel(raster, profile, params);
  const voxelDepth = Math.min(0.6, Math.max(0.06, cellSize * 1.2));
  const smallest = Math.min(params.edge, 0.05) * params.modelScale;

  const compose = (steps: Int8Array | null) => {
    // Float64, because these values are looked up exactly in the map below.
    const finalThickness = new Float64Array(solid.length);
    const unique = new Set<number>();
    for (let i = 0; i < solid.length; i += 1) {
      if (!smoothed[i]) continue;
      const base = blockValues[smoothed[i] - 1] * params.modelScale;
      const value = round(Math.max(smallest, base + (steps ? steps[i] : 0) * voxelDepth));
      finalThickness[i] = value;
      unique.add(value);
    }

    const levelValues = [...unique].sort((a, b) => a - b);
    const indexOf = new Map(levelValues.map((value, index) => [value, index + 1]));
    const levels = new Uint8Array(solid.length);
    for (let i = 0; i < solid.length; i += 1) {
      if (smoothed[i]) levels[i] = indexOf.get(finalThickness[i]) ?? 0;
    }
    return { levels, levelValues };
  };

  let composed = compose(null);
  let detailReduced = false;

  if (params.surfaceDetail > 0) {
    const deviation = detailMap(raster, solid, distance, cellsWide, cellsHigh, texelsPerCell);
    const elementCount = (candidate: ReturnType<typeof compose>) =>
      mergeCells(candidate.levels, cellsWide, cellsHigh, candidate.levelValues.length).length;

    // Raise the bar for what counts as detail until the model fits the limit.
    const plain = composed;
    // A glow layer adds its own boxes, so leave room for them under the limit.
    const limit = params.glow ? params.maxElements * 0.7 : params.maxElements;
    let threshold = 2.4 - 1.8 * params.surfaceDetail;
    let attempt = compose(voxelSteps(deviation, cellsWide, cellsHigh, threshold));
    while (elementCount(attempt) > limit && threshold < 6) {
      threshold *= 1.3;
      detailReduced = true;
      attempt = compose(voxelSteps(deviation, cellsWide, cellsHigh, threshold));
    }
    composed = elementCount(attempt) <= limit || elementCount(attempt) <= elementCount(plain) ? attempt : plain;
  }

  return {
    cellsWide,
    cellsHigh,
    texelsPerCell,
    levels: composed.levels,
    levelValues: composed.levelValues,
    handleRow,
    detailReduced,
  };
}

type Rect = { x: number; y: number; w: number; h: number; level: number };

function greedyRects(levels: Uint8Array, width: number, height: number, tallFirst: boolean) {
  const used = new Uint8Array(levels.length);
  const rects: Rect[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = levels[y * width + x];
      if (level === 0 || used[y * width + x]) continue;

      const free = (cx: number, cy: number) => {
        const i = cy * width + cx;
        return levels[i] === level && !used[i];
      };

      let w = 1;
      let h = 1;

      if (tallFirst) {
        while (y + h < height && free(x, y + h)) h += 1;
        grow: while (x + w < width) {
          for (let row = y; row < y + h; row += 1) {
            if (!free(x + w, row)) break grow;
          }
          w += 1;
        }
      } else {
        while (x + w < width && free(x + w, y)) w += 1;
        grow: while (y + h < height) {
          for (let col = x; col < x + w; col += 1) {
            if (!free(col, y + h)) break grow;
          }
          h += 1;
        }
      }

      for (let row = y; row < y + h; row += 1) {
        for (let col = x; col < x + w; col += 1) used[row * width + col] = 1;
      }
      rects.push({ x, y, w, h, level });
    }
  }

  return rects;
}

function mergeCells(levels: Uint8Array, width: number, height: number, levelCount: number) {
  const tall = greedyRects(levels, width, height, true);
  const wide = greedyRects(levels, width, height, false);

  // Each thickness keeps whichever merge direction made fewer boxes for it.
  const tallCounts = new Int32Array(levelCount + 1);
  const wideCounts = new Int32Array(levelCount + 1);
  for (const rect of tall) tallCounts[rect.level] += 1;
  for (const rect of wide) wideCounts[rect.level] += 1;

  return [
    ...tall.filter((rect) => tallCounts[rect.level] <= wideCounts[rect.level]),
    ...wide.filter((rect) => tallCounts[rect.level] > wideCounts[rect.level]),
  ];
}

/** Model units per texture pixel at normal size, matching the vanilla item. */
function fullSizeUnitsPerTexel(raster: FrameRaster, profile: ItemProfile) {
  return Math.min(profile.length / raster.itemHeight, profile.maxWidth / raster.itemWidth);
}

/** Model units per texture pixel, after the user's chosen model size. */
export function unitsPerTexel(raster: FrameRaster, profile: ItemProfile, params: BuildParams) {
  return fullSizeUnitsPerTexel(raster, profile) * params.modelScale;
}

/** How far a shrunken diagonal item moves along itself to keep its handle in the hand. */
function gripShiftFor(raster: FrameRaster, profile: ItemProfile, params: BuildParams) {
  if (profile.frame !== "diagonal") return 0;
  return ((1 - params.modelScale) * raster.itemHeight * fullSizeUnitsPerTexel(raster, profile)) / 2;
}

/** A glow box sits this far outside the box under it, so the two never flicker. */
const GLOW_OFFSET = 0.012;

function buildElements(
  raster: FrameRaster,
  thickness: ThicknessMap,
  profile: ItemProfile,
  params: BuildParams,
  cellGlows: Uint8Array | null
) {
  const { levels, cellsWide, cellsHigh, texelsPerCell: k, levelValues } = thickness;
  const scale = unitsPerTexel(raster, profile, params);
  const gripShift = gripShiftFor(raster, profile, params);
  const texelU = 16 / raster.width;
  const texelV = 16 / raster.height;
  const rects = mergeCells(levels, cellsWide, cellsHigh, levelValues.length);

  // With a smooth outline the outermost texels of a box may be transparent, so its
  // sides sample from the middle of the cell, where colour is more likely to exist.
  const sideInset = params.smoothOutline && k > 1 ? Math.floor(k / 2) : 0;

  const levelAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cellsWide || y >= cellsHigh) return 0;
    return levels[y * cellsWide + x];
  };

  const rotation =
    profile.frame === "diagonal"
      ? { origin: [8, 8, 8] as [number, number, number], axis: "z" as const, angle: -45 }
      : undefined;

  let faceCount = 0;

  const makeElement = (rect: Rect, texture: ModelFace["texture"], grow: number): ModelElement => {
    const depth = levelValues[rect.level - 1];

    const x0 = 8 + (rect.x * k - raster.width / 2) * scale;
    const x1 = 8 + ((rect.x + rect.w) * k - raster.width / 2) * scale;
    const yTop = 8 + (raster.height / 2 - rect.y * k) * scale - gripShift;
    const yBottom = 8 + (raster.height / 2 - (rect.y + rect.h) * k) * scale - gripShift;

    const u0 = round(rect.x * k * texelU);
    const u1 = round((rect.x + rect.w) * k * texelU);
    const v0 = round(rect.y * k * texelV);
    const v1 = round((rect.y + rect.h) * k * texelV);

    const faces: ModelElement["faces"] = {
      south: { uv: [u0, v0, u1, v1], texture },
      north: { uv: [u1, v0, u0, v1], texture },
    };

    // A side is only drawn if some neighbour is thinner. It samples a strip inside
    // the outermost texels, so it stays clear of the transparent ones beyond them.
    const exposedAlongRow = (y: number) => {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        if (levelAt(x, y) < rect.level) return true;
      }
      return false;
    };
    const exposedAlongColumn = (x: number) => {
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        if (levelAt(x, y) < rect.level) return true;
      }
      return false;
    };

    const edgeU = (texels: number) => round(texels * texelU);
    const edgeV = (texels: number) => round(texels * texelV);

    // With a smooth outline, a box can reach past the visible shape. A side there
    // would stick out as a thin spike, so it is only drawn where the cut-out reaches.
    const reachesEdge = (x0T: number, y0T: number, x1T: number, y1T: number) => {
      if (!params.smoothOutline || k === 1) return true;
      let covered = 0;
      for (let y = y0T; y < y1T; y += 1) {
        for (let x = x0T; x < x1T; x += 1) {
          if (raster.coverage[y * raster.width + x] >= 128) covered += 1;
        }
      }
      return covered * 2 >= (x1T - x0T) * (y1T - y0T);
    };
    const leftT = rect.x * k;
    const rightT = (rect.x + rect.w) * k;
    const topT = rect.y * k;
    const bottomT = (rect.y + rect.h) * k;

    if (exposedAlongColumn(rect.x + rect.w) && reachesEdge(rightT - k, topT, rightT, bottomT)) {
      const right = (rect.x + rect.w) * k - sideInset;
      const strip: ModelFace = {
        uv: [edgeU(right - 1 + EPSILON_INSET), v0, edgeU(right - EPSILON_INSET), v1],
        texture,
      };
      faces.east = strip;
    }
    if (exposedAlongColumn(rect.x - 1) && reachesEdge(leftT, topT, leftT + k, bottomT)) {
      const left = rect.x * k + sideInset;
      faces.west = {
        uv: [edgeU(left + EPSILON_INSET), v0, edgeU(left + 1 - EPSILON_INSET), v1],
        texture,
      };
    }
    if (exposedAlongRow(rect.y - 1) && reachesEdge(leftT, topT, rightT, topT + k)) {
      const top = rect.y * k + sideInset;
      faces.up = {
        uv: [u0, edgeV(top + EPSILON_INSET), u1, edgeV(top + 1 - EPSILON_INSET)],
        texture,
      };
    }
    if (exposedAlongRow(rect.y + rect.h) && reachesEdge(leftT, bottomT - k, rightT, bottomT)) {
      const bottom = (rect.y + rect.h) * k - sideInset;
      faces.down = {
        uv: [u0, edgeV(bottom - 1 + EPSILON_INSET), u1, edgeV(bottom - EPSILON_INSET)],
        texture,
      };
    }

    faceCount += Object.keys(faces).length;

    const element: ModelElement = {
      from: [round(x0 - grow), round(yBottom - grow), round(8 - depth / 2 - grow)],
      to: [round(x1 + grow), round(yTop + grow), round(8 + depth / 2 + grow)],
      faces,
    };
    if (rotation) element.rotation = rotation;
    return element;
  };

  const elements = rects.map((rect) => makeElement(rect, "#s", 0));

  // The glow layer is its own set of boxes, over only the cells that have any glow.
  if (cellGlows) {
    const glowLevels = levels.map((level, cell) => (cellGlows[cell] ? level : 0));
    for (const rect of mergeCells(glowLevels, cellsWide, cellsHigh, levelValues.length)) {
      const element = makeElement(rect, "#g", GLOW_OFFSET);
      element.shade = false;
      element.light_emission = 15;
      elements.push(element);
    }
  }

  return { elements, faceCount };
}

export const GLOW_FRAMES = 16;

/** Picks the texels that look lit, and builds the animated and still glow textures. */
/** The animated glow: a slow bright band travels up the item. Each frame shows for 4 ticks. */
export function glowStrip(rgba: ArrayLike<number>, frameWidth: number, frameHeight: number) {
  const strip = new Uint8ClampedArray(frameWidth * frameHeight * GLOW_FRAMES * 4);
  for (let frame = 0; frame < GLOW_FRAMES; frame += 1) {
    const centre = 1 - frame / GLOW_FRAMES;
    for (let y = 0; y < frameHeight; y += 1) {
      const along = Math.abs(y / frameHeight - centre);
      const wrapped = Math.min(along, 1 - along);
      const brightness = 0.78 + 0.6 * Math.exp(-((wrapped / 0.14) ** 2));
      for (let x = 0; x < frameWidth; x += 1) {
        const from = (y * frameWidth + x) * 4;
        const to = ((frame * frameHeight + y) * frameWidth + x) * 4;
        strip[to] = rgba[from] * brightness;
        strip[to + 1] = rgba[from + 1] * brightness;
        strip[to + 2] = rgba[from + 2] * brightness;
        strip[to + 3] = rgba[from + 3];
      }
    }
  }
  return strip;
}

function buildGlow(raster: FrameRaster, thickness: ThicknessMap, params: BuildParams) {
  const { rgba, width, height } = raster;
  const { cellsWide, cellsHigh, texelsPerCell: k } = thickness;

  // Saturated, bright colour is what reads as lit, so neon glows and pale metal doesn't.
  const scores = new Float32Array(width * height);
  const opaqueScores: number[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    if (rgba[i * 4 + 3] < 128) continue;
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max > 0 ? (max - min) / max : 0;
    scores[i] = (max / 255) * (0.35 + 0.65 * saturation);
    opaqueScores.push(scores[i]);
  }
  if (opaqueScores.length === 0) return null;

  opaqueScores.sort((a, b) => a - b);
  const share = params.glowAmount * 0.45;
  const percentile = opaqueScores[Math.min(opaqueScores.length - 1, Math.floor(opaqueScores.length * (1 - share)))];
  // A floor keeps a dull image from glowing just because something has to rank first.
  const cutoff = Math.max(0.3, percentile);

  const full = new Uint8ClampedArray(rgba.length);
  const cellGlows = new Uint8Array(cellsWide * cellsHigh);
  let glowing = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const lit = rgba[i * 4 + 3] >= 128 && scores[i] >= cutoff;
      full[i * 4] = rgba[i * 4];
      full[i * 4 + 1] = rgba[i * 4 + 1];
      full[i * 4 + 2] = rgba[i * 4 + 2];
      full[i * 4 + 3] = lit ? 255 : 0;
      if (lit) {
        glowing += 1;
        const cx = Math.min(cellsWide - 1, Math.floor(x / k));
        const cy = Math.min(cellsHigh - 1, Math.floor(y / k));
        cellGlows[cy * cellsWide + cx] = 1;
      }
    }
  }
  if (glowing === 0) return null;

  // Half size for the animated layer and a quarter for the still one, while both
  // sides stay at 16 or more. Glow is soft to the eye, and this keeps the atlas lean.
  const canHalve = (w: number, h: number) => Math.min(w, h) >= 32;
  let layer = { rgba: full, width, height };
  if (canHalve(width, height)) layer = halveRgba(full, width, height);
  const stillLayer = canHalve(layer.width, layer.height) ? halveRgba(layer.rgba, layer.width, layer.height) : layer;

  const { width: frameWidth, height: frameHeight } = layer;
  const strip = glowStrip(layer.rgba, frameWidth, frameHeight);

  const glow: GlowLayer = {
    strip,
    frameWidth,
    frameHeight,
    frames: GLOW_FRAMES,
    still: stillLayer.rgba,
    stillWidth: stillLayer.width,
    stillHeight: stillLayer.height,
  };
  return { glow, cellGlows };
}

/**
 * Final texture alpha. A texel is opaque where the model has geometry there. With a
 * smooth outline it must also be inside the cut-out, which trims each box to shape.
 */
function applyAlpha(raster: FrameRaster, thickness: ThicknessMap, smoothOutline: boolean) {
  const { levels, cellsWide, cellsHigh, texelsPerCell: k } = thickness;
  const { rgba, coverage } = raster;

  for (let y = 0; y < raster.height; y += 1) {
    const cy = Math.min(cellsHigh - 1, Math.floor(y / k));
    for (let x = 0; x < raster.width; x += 1) {
      const cx = Math.min(cellsWide - 1, Math.floor(x / k));
      const texel = y * raster.width + x;
      const hasGeometry = levels[cy * cellsWide + cx] > 0;
      const inside = !smoothOutline || k === 1 || coverage[texel] >= 128;
      rgba[texel * 4 + 3] = hasGeometry && inside ? 255 : 0;
    }
  }
}

export function buildModel(
  detail: HTMLCanvasElement,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  params: BuildParams
): BuiltModel {
  const profile = profileFor(params.itemId);
  const raster = rasterizeFrame(detail, mask, maskWidth, maskHeight, params.angle, params.flip, params.textureSize);
  const thickness = buildThicknessMap(raster, params, profile);
  applyAlpha(raster, thickness, params.smoothOutline);
  const glowBuild = params.glow ? buildGlow(raster, thickness, params) : null;
  const glow = glowBuild?.glow ?? null;
  const { elements, faceCount } = buildElements(raster, thickness, profile, params, glowBuild?.cellGlows ?? null);

  return {
    raster,
    thickness,
    glow,
    elements,
    display: displayForGripShift(profile.display, gripShiftFor(raster, profile, params)),
    faceCount,
    // An animated strip takes one frame's space in the atlas, not the whole strip.
    atlasPixels:
      raster.width * raster.height +
      (glow ? glow.frameWidth * glow.frameHeight + glow.stillWidth * glow.stillHeight : 0),
  };
}

/* ---------------- first guesses for a new image ---------------- */

/** Samples the cut-out into a small grid, rotated by an angle, as width-per-row runs. */
function outlineCost(mask: Uint8Array, width: number, height: number, degrees: number) {
  const GRID = 64;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 256));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!mask[y * width + x]) continue;
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
  }

  const size = Math.max(maxX - minX, maxY - minY, 1);
  const left = new Float64Array(GRID).fill(Infinity);
  const right = new Float64Array(GRID).fill(-Infinity);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!mask[y * width + x]) continue;
      const rx = ((x * cos - y * sin - minX) / size) * (GRID - 1);
      const ry = Math.round(((x * sin + y * cos - minY) / size) * (GRID - 1));
      if (rx < left[ry]) left[ry] = rx;
      if (rx > right[ry]) right[ry] = rx;
    }
  }

  // Outline wander between rows: what keeps boxes from merging into long runs.
  let cost = 0;
  let previous = -1;
  for (let row = 0; row < GRID; row += 1) {
    if (!isFinite(left[row])) continue;
    if (previous >= 0) {
      cost += Math.abs(left[row] - left[previous]) + Math.abs(right[row] - right[previous]);
    }
    previous = row;
  }
  return cost;
}

function principalAngle(mask: Uint8Array, width: number, height: number) {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        count += 1;
        sumX += x;
        sumY += y;
      }
    }
  }
  if (count === 0) return 0;

  const meanX = sumX / count;
  const meanY = sumY / count;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        xx += (x - meanX) ** 2;
        xy += (x - meanX) * (y - meanY);
        yy += (y - meanY) ** 2;
      }
    }
  }

  // Direction of the long axis, then the rotation that makes it vertical.
  const axis = 0.5 * Math.atan2(2 * xy, xx - yy);
  return 90 - (axis * 180) / Math.PI;
}

/** Width of the item per row from top to bottom, once rotated by this angle. */
function rowWidths(mask: Uint8Array, width: number, height: number, degrees: number) {
  const ROWS = 96;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      const ry = x * sin + y * cos;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
  }

  const span = Math.max(maxY - minY, 1);
  const counts = new Float64Array(ROWS);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      const row = Math.min(ROWS - 1, Math.floor(((x * sin + y * cos - minY) / span) * ROWS));
      counts[row] += 1;
    }
  }

  return Array.from(counts, (count) => count / (span / ROWS));
}

/** How far a constant narrow run extends in from one end of the item. */
function shaftLength(widths: number[]) {
  const sample = widths.slice(0, 6).sort((a, b) => a - b);
  const typical = Math.max(sample[3], 1);
  let length = 0;
  while (length < widths.length && widths[length] <= typical * 1.6 && widths[length] >= typical * 0.4) {
    length += 1;
  }
  return length;
}

export type Orientation = {
  angle: number;
  flip: boolean;
  handleFraction: number;
};

/**
 * Stands the item upright with its handle at the bottom, and estimates how long
 * the handle is. Every value is only a first guess that the user can change.
 */
export function guessOrientation(mask: Uint8Array, width: number, height: number, itemId: string): Orientation {
  const profile = profileFor(itemId);

  if (profile.frame === "upright") {
    return { angle: 0, flip: false, handleFraction: profile.handleFraction };
  }

  // Keep the rotation within a quarter turn, so what is at the top of the image
  // stays at the top. Most pictures of tools already have the handle at the bottom.
  const normalize = (degrees: number) => ((((degrees + 90) % 180) + 180) % 180) - 90;

  // Heavy heads pull the long axis off the handle, so a whole-number lean that
  // gives straighter edges beats the computed axis.
  const pca = normalize(principalAngle(mask, width, height));
  const candidates = [pca, 0, 45, -45, 90];
  let angle = pca;
  let bestCost = Infinity;
  for (const candidate of candidates) {
    const leanFromAxis = Math.abs(normalize(candidate - pca));
    if (leanFromAxis > 35) continue;
    const cost = outlineCost(mask, width, height, candidate) * (1 + leanFromAxis / 120);
    if (cost < bestCost) {
      bestCost = cost;
      angle = candidate;
    }
  }

  const widths = rowWidths(mask, width, height, angle);
  const fromBottom = widths.slice().reverse();

  const bottomShaft = shaftLength(fromBottom);
  const topShaft = shaftLength(widths);

  // The handle is the end with a long, constant, narrow run. A blade tapers
  // instead, so its tip scores short even though it is just as narrow.
  const flip = topShaft > bottomShaft * 1.5;
  const shaft = flip ? topShaft : bottomShaft;

  const detected = shaft / widths.length;
  const handleFraction =
    profile.handleFraction > 0
      ? Math.round(Math.min(0.85, Math.max(0.12, detected > 0.08 ? detected : profile.handleFraction)) * 100) / 100
      : 0;

  return { angle: Math.round(angle * 10) / 10, flip, handleFraction };
}

export function defaultParams(itemId: string, orientation: Orientation): BuildParams {
  const profile = profileFor(itemId);
  return {
    itemId,
    angle: orientation.angle,
    flip: orientation.flip,
    textureSize: 256,
    rows: 64,
    edge: profile.edge,
    middle: profile.middle,
    handle: profile.handle,
    handleFraction: orientation.handleFraction,
    levels: 4,
    modelScale: 1,
    surfaceDetail: 0.4,
    smoothOutline: true,
    maxElements: 800,
    glow: false,
    glowAmount: 0.4,
    allMaterials: true,
  };
}

/** Settings a skin saved before these options existed needs, to look the way it did. */
export const OLDER_SKIN_DEFAULTS = {
  modelScale: 1,
  surfaceDetail: 0,
  smoothOutline: false,
  maxElements: 800,
  glow: false,
  glowAmount: 0.4,
  allMaterials: false,
} satisfies Partial<BuildParams>;
