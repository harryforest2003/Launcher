/*
 * Colour maths for the theme engine and the colour picker. No DOM, no dependencies, so the
 * contrast test (scripts/theme-check.mjs) runs the very same code in Node.
 *
 * RGB values here are gamma-encoded sRGB in 0..1, the way CSS and the screen see them.
 * OKLCH is the perceptual space the engine moves colours around in: L (0..1) is how light a
 * colour looks, C its colourfulness, h its hue in degrees.
 */

export type RGB = { r: number; g: number; b: number };
export type OKLCH = { l: number; c: number; h: number };
export type HSV = { h: number; s: number; v: number };
export type HSL = { h: number; s: number; l: number };

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 below edge0, 1 above edge1, smooth in between (edges may be given in either order). */
export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.sign(x) * Math.abs(x) ** (1 / 2.4) - 0.055);

/* ---------------- OKLab / OKLCH (Björn Ottosson) ---------------- */

export function rgbToOklch({ r, g, b }: RGB): OKLCH {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(A, B);
  const h = c < 1e-7 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH to sRGB without bringing it into gamut (channels may fall outside 0..1). */
export function oklchToRgbUnclamped({ l: L, c, h }: OKLCH): RGB {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);

  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** Whether OKLab (L, a, b) lands inside sRGB. Checked in linear light, which has the same bounds. */
function labInGamut(L: number, A: number, B: number) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const eps = 1e-5;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  if (r < -eps || r > 1 + eps) return false;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  if (g < -eps || g > 1 + eps) return false;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return b >= -eps && b <= 1 + eps;
}

/**
 * OKLCH to a displayable sRGB colour. Out-of-gamut colours keep their lightness and hue and
 * lose just enough colourfulness to fit, so a requested lightness is always honoured.
 */
export function oklchToRgb(lch: OKLCH): RGB {
  const l = clamp(lch.l, 0, 1);
  const cos = Math.cos((lch.h * Math.PI) / 180);
  const sin = Math.sin((lch.h * Math.PI) / 180);
  let c = Math.max(0, lch.c);
  if (!labInGamut(l, c * cos, c * sin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 13; i++) {
      const mid = (lo + hi) / 2;
      if (labInGamut(l, mid * cos, mid * sin)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const rgb = oklchToRgbUnclamped({ l, c, h: lch.h });
  return { r: clamp(rgb.r, 0, 1), g: clamp(rgb.g, 0, 1), b: clamp(rgb.b, 0, 1) };
}

/* ---------------- hex ---------------- */

const byte = (x: number) => Math.round(clamp(x, 0, 1) * 255);
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export function rgbToHex({ r, g, b }: RGB, alpha?: number) {
  const base = `#${hex2(byte(r))}${hex2(byte(g))}${hex2(byte(b))}`;
  return alpha === undefined ? base : base + hex2(byte(alpha));
}

/** Reads #rgb, #rgba, #rrggbb and #rrggbbaa (the # is optional). Alpha is dropped. */
export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  if (h.length <= 4) h = [...h].map((ch) => ch + ch).join("");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** The alpha of an 8-digit hex colour, 1 for the others. */
export function hexAlpha(hex: string) {
  const h = hex.replace(/^#/, "");
  return h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
}

/** Rounds a colour to what a #rrggbb string can hold, which is what the screen shows. */
export const quantize = ({ r, g, b }: RGB): RGB => ({ r: byte(r) / 255, g: byte(g) / 255, b: byte(b) / 255 });

export const oklchToHex = (lch: OKLCH) => rgbToHex(oklchToRgb(lch));
export const hexToOklch = (hex: string) => rgbToOklch(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });

/* ---------------- WCAG 2 contrast ---------------- */

export function luminance({ r, g, b }: RGB) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: RGB, b: RGB) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A translucent colour over an opaque one, blended the way browsers do (in gamma space), as shown on screen. */
export function composite(top: RGB, alpha: number, under: RGB): RGB {
  const a = byte(alpha) / 255;
  return quantize({
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
  });
}

/* ---------------- HSV / HSL (for the picker) ---------------- */

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

export function rgbToHsl(rgb: RGB): HSL {
  const { h, s, v } = rgbToHsv(rgb);
  const l = v * (1 - s / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h, s: v === 0 ? 0 : 2 * (1 - l / v), v });
}

/* ---------------- parsing what people type ---------------- */

const num = (part: string, scale: number) => {
  const p = part.trim();
  if (p.endsWith("%")) return (parseFloat(p) / 100) * scale;
  return parseFloat(p);
};

const hueOf = (part: string) => {
  const p = part.trim().toLowerCase();
  const n = parseFloat(p);
  if (p.endsWith("turn")) return n * 360;
  if (p.endsWith("rad")) return (n * 180) / Math.PI;
  if (p.endsWith("grad")) return n * 0.9;
  return n;
};

/**
 * Reads a colour as people write it: hex (with or without #), rgb(), hsl(), hsv()/hsb() and
 * oklch(). Returns null for anything else; the picker then asks the browser (named colours).
 */
export function parseColor(input: string): RGB | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const hex = hexToRgb(text);
  if (hex) return hex;

  const fn = /^([a-z]+)\(\s*([^)]*)\)$/.exec(text);
  if (!fn) return null;

  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.slice(0, 3).some((p) => Number.isNaN(parseFloat(p)))) return null;

  switch (fn[1]) {
    case "rgb":
    case "rgba":
      return {
        r: clamp(num(parts[0], 255) / 255, 0, 1),
        g: clamp(num(parts[1], 255) / 255, 0, 1),
        b: clamp(num(parts[2], 255) / 255, 0, 1),
      };
    case "hsl":
    case "hsla":
      return hslToRgb({
        h: ((hueOf(parts[0]) % 360) + 360) % 360,
        s: clamp(parseFloat(parts[1]) / 100, 0, 1),
        l: clamp(parseFloat(parts[2]) / 100, 0, 1),
      });
    case "hsv":
    case "hsb":
      return hsvToRgb({
        h: ((hueOf(parts[0]) % 360) + 360) % 360,
        s: clamp(parseFloat(parts[1]) / 100, 0, 1),
        v: clamp(parseFloat(parts[2]) / 100, 0, 1),
      });
    case "oklch":
      return oklchToRgb({
        l: clamp(parts[0].trim().endsWith("%") ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]), 0, 1),
        c: Math.max(0, parts[1].trim().endsWith("%") ? (parseFloat(parts[1]) / 100) * 0.4 : parseFloat(parts[1])),
        h: ((hueOf(parts[2]) % 360) + 360) % 360,
      });
    default:
      return null;
  }
}

/** Signed difference between two hues, in -180..180. */
export function hueDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/* A plain-words name for a hue, for screen readers and the code field's help. */
export function hueName(h: number, s: number, v: number) {
  if (v < 0.12) return "black";
  if (s < 0.1) return v > 0.92 ? "white" : "grey";
  const names: [number, string][] = [
    [12, "red"], [40, "orange"], [65, "yellow"], [90, "lime"], [150, "green"], [175, "teal"],
    [200, "cyan"], [250, "blue"], [280, "violet"], [310, "purple"], [340, "pink"], [360, "red"],
  ];
  return names.find(([limit]) => h < limit)?.[1] ?? "red";
}
