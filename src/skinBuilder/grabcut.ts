import { FlowGraph } from "./maxflow";

/**
 * Local background removal: GrabCut (Rother, Kolmogorov and Blake, 2004).
 *
 * Foreground and background are each modelled as a mix of colours, and a min-cut
 * finds the outline that best separates them while preferring to follow real
 * colour edges. Keep/remove marks become hard constraints on the same graph, which
 * is why touching up a selection needs no separate code path.
 */

export const HINT_NONE = 0;
export const HINT_KEEP = 1;
export const HINT_REMOVE = 2;

const BGD = 0;
const FGD = 1;
const PROBABLE_BGD = 2;
const PROBABLE_FGD = 3;

const COMPONENTS = 5;
const GAMMA = 50;
const LAMBDA = 450;
const ITERATIONS = 3;

export type CutoutInput = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  hints?: Uint8Array | null;
};

/** Small seeded generator, so re-running on the same marks gives the same result. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kMeans(colors: Float64Array, count: number, k: number, random: () => number) {
  const centers = new Float64Array(k * 3);
  const labels = new Uint8Array(count);
  const minDist = new Float64Array(count).fill(Infinity);

  // k-means++ seeding: each new centre favours colours far from existing ones.
  let pick = Math.floor(random() * count);
  for (let c = 0; c < k; c += 1) {
    centers[c * 3] = colors[pick * 3];
    centers[c * 3 + 1] = colors[pick * 3 + 1];
    centers[c * 3 + 2] = colors[pick * 3 + 2];

    let total = 0;
    for (let i = 0; i < count; i += 1) {
      const dr = colors[i * 3] - centers[c * 3];
      const dg = colors[i * 3 + 1] - centers[c * 3 + 1];
      const db = colors[i * 3 + 2] - centers[c * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < minDist[i]) minDist[i] = d;
      total += minDist[i];
    }

    let target = random() * total;
    pick = 0;
    for (let i = 0; i < count; i += 1) {
      target -= minDist[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
  }

  const sums = new Float64Array(k * 3);
  const sizes = new Float64Array(k);

  for (let iteration = 0; iteration < 6; iteration += 1) {
    sums.fill(0);
    sizes.fill(0);

    for (let i = 0; i < count; i += 1) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c += 1) {
        const dr = colors[i * 3] - centers[c * 3];
        const dg = colors[i * 3 + 1] - centers[c * 3 + 1];
        const db = colors[i * 3 + 2] - centers[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      labels[i] = best;
      sizes[best] += 1;
      sums[best * 3] += colors[i * 3];
      sums[best * 3 + 1] += colors[i * 3 + 1];
      sums[best * 3 + 2] += colors[i * 3 + 2];
    }

    for (let c = 0; c < k; c += 1) {
      if (sizes[c] === 0) continue;
      centers[c * 3] = sums[c * 3] / sizes[c];
      centers[c * 3 + 1] = sums[c * 3 + 1] / sizes[c];
      centers[c * 3 + 2] = sums[c * 3 + 2] / sizes[c];
    }
  }

  return { centers, labels, sizes };
}

class ColorModel {
  readonly weight = new Float64Array(COMPONENTS);
  readonly mean = new Float64Array(COMPONENTS * 3);
  readonly inverse = new Float64Array(COMPONENTS * 9);
  readonly norm = new Float64Array(COMPONENTS);
  private readonly sums = new Float64Array(COMPONENTS * 3);
  private readonly products = new Float64Array(COMPONENTS * 9);
  private readonly counts = new Float64Array(COMPONENTS);
  private total = 0;

  beginLearning() {
    this.sums.fill(0);
    this.products.fill(0);
    this.counts.fill(0);
    this.total = 0;
  }

  addSample(component: number, r: number, g: number, b: number) {
    const s = component * 3;
    const p = component * 9;
    this.sums[s] += r;
    this.sums[s + 1] += g;
    this.sums[s + 2] += b;
    this.products[p] += r * r;
    this.products[p + 1] += r * g;
    this.products[p + 2] += r * b;
    this.products[p + 3] += g * r;
    this.products[p + 4] += g * g;
    this.products[p + 5] += g * b;
    this.products[p + 6] += b * r;
    this.products[p + 7] += b * g;
    this.products[p + 8] += b * b;
    this.counts[component] += 1;
    this.total += 1;
  }

  endLearning() {
    for (let c = 0; c < COMPONENTS; c += 1) {
      const n = this.counts[c];
      this.weight[c] = this.total > 0 ? n / this.total : 0;
      if (n === 0) continue;

      const m0 = this.sums[c * 3] / n;
      const m1 = this.sums[c * 3 + 1] / n;
      const m2 = this.sums[c * 3 + 2] / n;
      this.mean[c * 3] = m0;
      this.mean[c * 3 + 1] = m1;
      this.mean[c * 3 + 2] = m2;

      const p = c * 9;
      let a = this.products[p] / n - m0 * m0;
      const b = this.products[p + 1] / n - m0 * m1;
      const d = this.products[p + 2] / n - m0 * m2;
      let e = this.products[p + 4] / n - m1 * m1;
      const f = this.products[p + 5] / n - m1 * m2;
      let i = this.products[p + 8] / n - m2 * m2;

      // A flat colour has no spread; a small floor keeps the matrix invertible.
      a += 0.01;
      e += 0.01;
      i += 0.01;

      const c00 = e * i - f * f;
      const c01 = d * f - b * i;
      const c02 = b * f - d * e;
      const det = a * c00 + b * c01 + d * c02;

      const inv = this.inverse;
      inv[p] = c00 / det;
      inv[p + 1] = c01 / det;
      inv[p + 2] = c02 / det;
      inv[p + 3] = c01 / det;
      inv[p + 4] = (a * i - d * d) / det;
      inv[p + 5] = (b * d - a * f) / det;
      inv[p + 6] = c02 / det;
      inv[p + 7] = (b * d - a * f) / det;
      inv[p + 8] = (a * e - b * b) / det;

      this.norm[c] = 1 / Math.sqrt(Math.max(det, 1e-12));
    }
  }

  componentDensity(c: number, r: number, g: number, b: number) {
    if (this.weight[c] === 0) return 0;
    const dr = r - this.mean[c * 3];
    const dg = g - this.mean[c * 3 + 1];
    const db = b - this.mean[c * 3 + 2];
    const inv = this.inverse;
    const p = c * 9;
    const q =
      dr * (dr * inv[p] + dg * inv[p + 3] + db * inv[p + 6]) +
      dg * (dr * inv[p + 1] + dg * inv[p + 4] + db * inv[p + 7]) +
      db * (dr * inv[p + 2] + dg * inv[p + 5] + db * inv[p + 8]);
    return this.norm[c] * Math.exp(-0.5 * q);
  }

  density(r: number, g: number, b: number) {
    let sum = 0;
    for (let c = 0; c < COMPONENTS; c += 1) {
      sum += this.weight[c] * this.componentDensity(c, r, g, b);
    }
    return sum;
  }

  bestComponent(r: number, g: number, b: number) {
    let best = 0;
    let bestValue = -1;
    for (let c = 0; c < COMPONENTS; c += 1) {
      const value = this.componentDensity(c, r, g, b);
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    return best;
  }
}

function otsu(values: Float64Array, max: number) {
  const bins = new Float64Array(256);
  for (let i = 0; i < values.length; i += 1) {
    bins[Math.min(255, Math.floor((values[i] / max) * 255))] += 1;
  }

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * bins[i];

  let sumBack = 0;
  let weightBack = 0;
  let best = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i += 1) {
    weightBack += bins[i];
    if (weightBack === 0) continue;
    const weightFore = values.length - weightBack;
    if (weightFore === 0) break;
    sumBack += i * bins[i];
    const meanBack = sumBack / weightBack;
    const meanFore = (sum - sumBack) / weightFore;
    const between = weightBack * weightFore * (meanBack - meanFore) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }

  return (threshold / 255) * max;
}

/**
 * First guess with no user input: whatever matches the image border's colours is
 * probably background. Pixels on the border itself are only forced to background
 * when they match its main colour, so an item touching the frame is not clipped.
 */
function initialLabels(rgba: Uint8ClampedArray, width: number, height: number, random: () => number) {
  const labels = new Uint8Array(width * height);
  const margin = Math.max(2, Math.round(Math.max(width, height) * 0.012));

  const ringIndexes: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < margin || y < margin || x >= width - margin || y >= height - margin) {
        ringIndexes.push(y * width + x);
      }
    }
  }

  const ring = new Float64Array(ringIndexes.length * 3);
  ringIndexes.forEach((index, i) => {
    ring[i * 3] = rgba[index * 4];
    ring[i * 3 + 1] = rgba[index * 4 + 1];
    ring[i * 3 + 2] = rgba[index * 4 + 2];
  });

  const clusters = kMeans(ring, ringIndexes.length, 3, random);
  const palette: number[] = [];
  let dominant = 0;
  for (let c = 0; c < 3; c += 1) {
    if (clusters.sizes[c] > clusters.sizes[dominant]) dominant = c;
    if (clusters.sizes[c] >= ringIndexes.length * 0.2) palette.push(c);
  }
  if (palette.length === 0) palette.push(dominant);

  const distances = new Float64Array(width * height);
  const distanceTo = (index: number, c: number) => {
    const dr = rgba[index * 4] - clusters.centers[c * 3];
    const dg = rgba[index * 4 + 1] - clusters.centers[c * 3 + 1];
    const db = rgba[index * 4 + 2] - clusters.centers[c * 3 + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  for (let i = 0; i < distances.length; i += 1) {
    let best = Infinity;
    for (const c of palette) best = Math.min(best, distanceTo(i, c));
    distances[i] = best;
  }

  // Otsu splits on the image's strongest contrast, which leaves dark parts behind
  // when bright parts dominate. The background's own spread catches those too. The
  // floor keeps JPEG noise on a plain background from counting as an object.
  // It is measured below the 70th percentile so lines crossing the border don't count.
  const ringDistances = Float64Array.from(ringIndexes, (index) => distances[index]).sort();
  const backgroundSpread = ringDistances[Math.floor(ringDistances.length * 0.7)];
  const threshold = Math.max(14, Math.min(otsu(distances, 442), backgroundSpread * 1.6 + 8));

  let foreground = 0;
  for (let i = 0; i < labels.length; i += 1) {
    if (distances[i] > threshold) {
      labels[i] = PROBABLE_FGD;
      foreground += 1;
    } else {
      labels[i] = PROBABLE_BGD;
    }
  }

  // Nothing stands out from the border (a busy photo): assume a centred subject.
  const share = foreground / labels.length;
  if (share < 0.002 || share > 0.92) {
    const insetX = Math.round(width * 0.08);
    const insetY = Math.round(height * 0.08);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = x >= insetX && y >= insetY && x < width - insetX && y < height - insetY;
        labels[y * width + x] = inside ? PROBABLE_FGD : PROBABLE_BGD;
      }
    }
  }

  for (const index of ringIndexes) {
    if (distanceTo(index, dominant) <= threshold) labels[index] = BGD;
  }

  return labels;
}

function initModels(
  rgba: Uint8ClampedArray,
  labels: Uint8Array,
  background: ColorModel,
  foreground: ColorModel,
  random: () => number
) {
  const MAX_SAMPLES = 6000;

  const seed = (isForeground: boolean, model: ColorModel) => {
    const indexes: number[] = [];
    for (let i = 0; i < labels.length; i += 1) {
      const fg = labels[i] === FGD || labels[i] === PROBABLE_FGD;
      if (fg === isForeground) indexes.push(i);
    }

    model.beginLearning();
    if (indexes.length === 0) {
      model.endLearning();
      return;
    }

    const count = Math.min(MAX_SAMPLES, indexes.length);
    const colors = new Float64Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const index = indexes[Math.floor((i * indexes.length) / count)];
      colors[i * 3] = rgba[index * 4];
      colors[i * 3 + 1] = rgba[index * 4 + 1];
      colors[i * 3 + 2] = rgba[index * 4 + 2];
    }

    const clusters = kMeans(colors, count, COMPONENTS, random);
    for (let i = 0; i < count; i += 1) {
      model.addSample(clusters.labels[i], colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
    }
    model.endLearning();
  };

  seed(false, background);
  seed(true, foreground);
}

/** City-block distance from every pixel to the nearest seed, in two sweeps. */
function cityBlockDistance(seeds: Uint8Array, width: number, height: number) {
  const FAR = width + height;
  const distance = new Int32Array(seeds.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (seeds[i]) continue;
      const left = x > 0 ? distance[i - 1] : FAR;
      const up = y > 0 ? distance[i - width] : FAR;
      distance[i] = Math.min(left, up) + 1;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      const right = x < width - 1 ? distance[i + 1] : FAR;
      const down = y < height - 1 ? distance[i + width] : FAR;
      distance[i] = Math.min(distance[i], Math.min(right, down) + 1);
    }
  }

  return distance;
}

/**
 * Settles pixels far from anything that might be foreground, so the solver only
 * works near the outline. Most of a picture of a single item is plain background,
 * and leaving it out of the graph is what makes re-running after a brush stroke fast.
 * Returns 1 for pixels still to be solved.
 */
function settleFarBackground(labels: Uint8Array, width: number, height: number) {
  const isForeground = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    isForeground[i] = labels[i] === FGD || labels[i] === PROBABLE_FGD ? 1 : 0;
  }

  // Lone specks of noise should not each keep a patch of background in the graph.
  const smallest = Math.max(12, labels.length * 0.0001);
  for (const region of regions(isForeground, width, height, 1)) {
    if (region.area >= smallest) continue;
    for (const i of region.pixels) {
      if (labels[i] === PROBABLE_FGD) {
        labels[i] = PROBABLE_BGD;
        isForeground[i] = 0;
      }
    }
  }

  const distance = cityBlockDistance(isForeground, width, height);
  const band = Math.max(8, Math.round(Math.max(width, height) * 0.04));
  const active = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    if (distance[i] > band && labels[i] === PROBABLE_BGD) labels[i] = BGD;
    active[i] = distance[i] > band ? 0 : 1;
  }
  return active;
}

function runGraphCut(rgba: Uint8ClampedArray, labels: Uint8Array, width: number, height: number, random: () => number) {
  const active = settleFarBackground(labels, width, height);

  const background = new ColorModel();
  const foreground = new ColorModel();
  initModels(rgba, labels, background, foreground, random);

  // How strongly neighbours stick together follows the image's typical contrast.
  let contrast = 0;
  let pairs = 0;
  const colorDiff = (a: number, b: number) => {
    const dr = rgba[a * 4] - rgba[b * 4];
    const dg = rgba[a * 4 + 1] - rgba[b * 4 + 1];
    const db = rgba[a * 4 + 2] - rgba[b * 4 + 2];
    return dr * dr + dg * dg + db * db;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) {
        contrast += colorDiff(i, i - 1);
        pairs += 1;
      }
      if (y > 0) {
        contrast += colorDiff(i, i - width);
        pairs += 1;
        if (x > 0) {
          contrast += colorDiff(i, i - width - 1);
          pairs += 1;
        }
        if (x < width - 1) {
          contrast += colorDiff(i, i - width + 1);
          pairs += 1;
        }
      }
    }
  }
  const beta = contrast > 0 ? pairs / (2 * contrast) : 0;
  const diagonalWeight = GAMMA / Math.SQRT2;

  const graph = new FlowGraph(width * height, width * height * 4);
  const assignments = new Uint8Array(width * height);

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    // Refit both colour models to the current labelling.
    for (let i = 0; i < labels.length; i += 1) {
      const fg = labels[i] === FGD || labels[i] === PROBABLE_FGD;
      assignments[i] = (fg ? foreground : background).bestComponent(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    }

    background.beginLearning();
    foreground.beginLearning();
    for (let i = 0; i < labels.length; i += 1) {
      const fg = labels[i] === FGD || labels[i] === PROBABLE_FGD;
      (fg ? foreground : background).addSample(assignments[i], rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    }
    background.endLearning();
    foreground.endLearning();

    graph.reset();

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (!active[i]) continue;
        const label = labels[i];

        let fromSource = 0;
        let toSink = 0;
        if (label === BGD) {
          toSink = LAMBDA;
        } else if (label === FGD) {
          fromSource = LAMBDA;
        } else {
          const r = rgba[i * 4];
          const g = rgba[i * 4 + 1];
          const b = rgba[i * 4 + 2];
          fromSource = -Math.log(Math.max(background.density(r, g, b), 1e-300));
          toSink = -Math.log(Math.max(foreground.density(r, g, b), 1e-300));
        }
        graph.addTerminal(i, fromSource, toSink);

        if (x > 0 && active[i - 1]) {
          const w = GAMMA * Math.exp(-beta * colorDiff(i, i - 1));
          graph.addEdge(i, i - 1, w, w);
        }
        if (y > 0) {
          if (active[i - width]) {
            const up = GAMMA * Math.exp(-beta * colorDiff(i, i - width));
            graph.addEdge(i, i - width, up, up);
          }
          if (x > 0 && active[i - width - 1]) {
            const w = diagonalWeight * Math.exp(-beta * colorDiff(i, i - width - 1));
            graph.addEdge(i, i - width - 1, w, w);
          }
          if (x < width - 1 && active[i - width + 1]) {
            const w = diagonalWeight * Math.exp(-beta * colorDiff(i, i - width + 1));
            graph.addEdge(i, i - width + 1, w, w);
          }
        }
      }
    }

    graph.maxFlow();

    let changed = 0;
    for (let i = 0; i < labels.length; i += 1) {
      if (!active[i] || labels[i] === BGD || labels[i] === FGD) continue;
      const next = graph.inSource(i) ? PROBABLE_FGD : PROBABLE_BGD;
      if (next !== labels[i]) {
        labels[i] = next;
        changed += 1;
      }
    }

    // The outline has settled, so another pass would only repeat this one.
    if (changed < labels.length * 0.0005) break;
  }
}

/** Connected regions of pixels equal to `value`, 4-connected. */
function regions(mask: Uint8Array, width: number, height: number, value: number) {
  const ids = new Int32Array(mask.length).fill(-1);
  const found: { area: number; touchesBorder: boolean; pixels: number[] }[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== value || ids[start] !== -1) continue;

    const id = found.length;
    const region = { area: 0, touchesBorder: false, pixels: [] as number[] };
    found.push(region);
    ids[start] = id;
    stack.push(start);

    while (stack.length > 0) {
      const i = stack.pop() as number;
      region.area += 1;
      region.pixels.push(i);

      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) region.touchesBorder = true;

      if (x > 0 && mask[i - 1] === value && ids[i - 1] === -1) {
        ids[i - 1] = id;
        stack.push(i - 1);
      }
      if (x < width - 1 && mask[i + 1] === value && ids[i + 1] === -1) {
        ids[i + 1] = id;
        stack.push(i + 1);
      }
      if (y > 0 && mask[i - width] === value && ids[i - width] === -1) {
        ids[i - width] = id;
        stack.push(i - width);
      }
      if (y < height - 1 && mask[i + width] === value && ids[i + width] === -1) {
        ids[i + width] = id;
        stack.push(i + width);
      }
    }
  }

  return found;
}

/** Drops specks and pinholes, while never overriding what the user marked. */
function cleanMask(mask: Uint8Array, width: number, height: number, hints: Uint8Array | null | undefined) {
  const smoothed = mask.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) count += mask[i + dy * width + dx];
      }
      smoothed[i] = count >= 5 ? 1 : 0;
    }
  }

  // One stray speck would stretch the texture to reach it, which costs atlas space.
  // So the largest piece stays, plus anything marked Keep, plus pieces close enough
  // to those to be part of the same item, such as a charm hanging from a handle.
  const solid = regions(smoothed, width, height, 1);
  const largest = solid.reduce((max, r) => Math.max(max, r.area), 0);
  const reach = Math.max(4, Math.round(Math.max(width, height) * 0.025));
  const kept = new Uint8Array(smoothed.length);
  const pending = new Set<(typeof solid)[number]>();

  for (const region of solid) {
    const marked = hints ? region.pixels.some((i) => hints[i] === HINT_KEEP) : false;
    if (region.area === largest || marked) {
      for (const i of region.pixels) kept[i] = 1;
    } else if (region.area >= largest * 0.002) {
      pending.add(region);
    }
  }

  let grew = pending.size > 0;
  while (grew) {
    grew = false;
    const distance = cityBlockDistance(kept, width, height);
    for (const region of pending) {
      if (region.pixels.some((i) => distance[i] <= reach)) {
        for (const i of region.pixels) kept[i] = 1;
        pending.delete(region);
        grew = true;
      }
    }
  }

  for (let i = 0; i < smoothed.length; i += 1) {
    if (!kept[i]) smoothed[i] = 0;
  }

  const holes = regions(smoothed, width, height, 0);
  for (const hole of holes) {
    if (hole.touchesBorder || hole.area >= largest * 0.002) continue;
    const marked = hints ? hole.pixels.some((i) => hints[i] === HINT_REMOVE) : false;
    if (!marked) {
      for (const i of hole.pixels) smoothed[i] = 1;
    }
  }

  if (hints) {
    for (let i = 0; i < smoothed.length; i += 1) {
      if (hints[i] === HINT_KEEP) smoothed[i] = 1;
      else if (hints[i] === HINT_REMOVE) smoothed[i] = 0;
    }
  }

  return smoothed;
}

/**
 * A copy of the image with tones near the background's stretched apart. A black
 * handle on a black backdrop differs by only a few levels in plain RGB, too little
 * for the colour models to separate. Only the solver sees this copy.
 */
function liftTowardBackground(rgba: Uint8ClampedArray, width: number, height: number) {
  let sum = 0;
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
      count += 3;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
      count += 3;
    }
  }
  const backgroundIsDark = sum / count < 128;

  const curve = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    const t = v / 255;
    curve[v] = 255 * (backgroundIsDark ? Math.sqrt(t) : t * t);
  }

  const lifted = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    lifted[i] = curve[rgba[i]];
    lifted[i + 1] = curve[rgba[i + 1]];
    lifted[i + 2] = curve[rgba[i + 2]];
    lifted[i + 3] = 255;
  }
  return lifted;
}

/** Returns 1 for each pixel to keep and 0 for each pixel to remove. */
export function cutOut({ rgba, width, height, hints }: CutoutInput): Uint8Array {
  const total = width * height;

  // A PNG that already has transparency has told us its outline.
  let transparent = 0;
  for (let i = 0; i < total; i += 1) {
    if (rgba[i * 4 + 3] < 16) transparent += 1;
  }

  if (transparent >= total * 0.02) {
    const mask = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    }
    return cleanMask(mask, width, height, hints);
  }

  const random = createRandom(0x51e7);
  const lifted = liftTowardBackground(rgba, width, height);
  const labels = initialLabels(lifted, width, height, random);

  if (hints) {
    for (let i = 0; i < total; i += 1) {
      if (hints[i] === HINT_KEEP) labels[i] = FGD;
      else if (hints[i] === HINT_REMOVE) labels[i] = BGD;
    }
  }

  runGraphCut(lifted, labels, width, height, random);

  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    mask[i] = labels[i] === FGD || labels[i] === PROBABLE_FGD ? 1 : 0;
  }

  return cleanMask(mask, width, height, hints);
}
