/*
 * The theme engine: one colour in, the launcher's whole palette out.
 *
 * Everything is worked out in OKLCH, where moving L changes how light a colour looks and
 * nothing else. Surfaces are laid down first; every colour that has to be read on them (text,
 * links, icons, borders of inputs, focus rings) is then moved along L, keeping its hue, until
 * it clears its contrast target against EVERY background it is allowed on (CONTRAST_RULES).
 * Contrast is measured on the final #rrggbb values, so what is checked is what is shown.
 *
 * Pure functions only: the picker, the boot code and scripts/theme-check.mjs all use this file.
 */

import {
  clamp,
  composite,
  contrast,
  hexAlpha,
  hexToRgb,
  hueDelta,
  lerp,
  luminance,
  oklchToRgb,
  parseColor,
  quantize,
  rgbToHex,
  rgbToHsl,
  rgbToOklch,
  smoothstep,
  type OKLCH,
  type RGB,
} from "./color.ts";

export type Scheme = "dark" | "light";
/** "auto" follows the picked colour (pale colours give a light launcher); "system" follows the OS. */
export type ThemeMode = "auto" | "dark" | "light" | "system";
export type ThemeContrast = "standard" | "more";
/** Which kind of colour vision the status colours are tuned for. */
export type ColourVision = "standard" | "protanopia" | "deuteranopia" | "tritanopia";
/** The face used for everything people read. Verdana and Comic Sans are the British Dyslexia Association's suggestions. */
export type ReadingFont = "launcher" | "verdana" | "comic";
/** Letter, word and line spacing; "wide" is WCAG 1.4.12's text-spacing values. */
export type TextSpacing = "standard" | "roomy" | "wide";
/** A band that follows the pointer to keep your place in text: a tinted line, or dimming everything else. */
export type ReadingGuide = "off" | "line" | "focus";

export type ThemeSettings = {
  /** The colour the user picked, as #rrggbb. */
  seed: string;
  mode: ThemeMode;
  contrast: ThemeContrast;
  /** How strongly backgrounds take on the colour: 0 is neutral grey, 1 is deeply dyed. */
  tint: number;
  vision: ColourVision;
  font: ReadingFont;
  spacing: TextSpacing;
  guide: ReadingGuide;
};

/** Unity violet, taken from the logo. */
export const DEFAULT_SEED = "#7b34e6";

export const DEFAULT_THEME: ThemeSettings = {
  seed: DEFAULT_SEED,
  mode: "dark",
  contrast: "standard",
  tint: 0.2,
  vision: "standard",
  font: "launcher",
  spacing: "standard",
  guide: "off",
};

/** The settings that are about how someone sees and reads, not the launcher's look: Reset leaves them alone. */
export const ACCESS_KEYS = ["vision", "font", "spacing", "guide"] as const;

const STATUSES = ["success", "warning", "danger", "info"] as const;
export type Status = (typeof STATUSES)[number];

/** Every colour token. Each becomes the CSS custom property --color-<name>. */
export const COLOR_TOKENS = [
  // Surfaces, from the bottom of the window up.
  "bg",
  "chrome",
  "surface",
  "surface-raised",
  "surface-sunken",
  // Translucent layers laid over a surface while a transparent control is hovered or pressed.
  "hover",
  "pressed",
  "border",
  "border-strong",
  "text",
  "text-secondary",
  "text-muted",
  "text-disabled",
  "accent",
  "accent-hover",
  "accent-pressed",
  "on-accent",
  "accent-text",
  "accent-line",
  "accent-subtle",
  "accent-subtle-hover",
  "accent-glow",
  "focus",
  ...STATUSES.flatMap((s) => [`${s}-text`, `${s}-bg`, `${s}-border`, `${s}-solid`, `${s}-solid-hover`, `on-${s}`] as const),
  "scrim",
  "shadow",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export type Palette = {
  scheme: Scheme;
  colors: Record<ColorToken, string>;
  /** A CSS filter that turns the violet logo to the picked colour. */
  logoFilter: string;
};

/* ---------------- which colour may sit on which ---------------- */

/** "x+hover" means surface x with the hover layer laid over it. */
export type BackgroundRef = ColorToken | `${ColorToken}+${"hover" | "pressed"}`;

export const SOLID_SURFACES = ["bg", "chrome", "surface", "surface-raised", "surface-sunken"] as const satisfies ColorToken[];

const STATE_SURFACES = SOLID_SURFACES.flatMap((s) => [`${s}+hover`, `${s}+pressed`] as const);

/** Every background that ordinary text may be put on. */
export const TEXT_BACKGROUNDS: BackgroundRef[] = [
  ...SOLID_SURFACES,
  ...STATE_SURFACES,
  "accent-subtle",
  "accent-subtle-hover",
  ...STATUSES.map((s) => `${s}-bg` as const),
];

const LINE_BACKGROUNDS: BackgroundRef[] = [...SOLID_SURFACES, "accent-subtle", "accent-subtle-hover"];

export type ContrastRule = {
  fg: ColorToken;
  on: BackgroundRef[];
  /** WCAG AA: 4.5 for text, 3 for large text and the parts of controls that carry meaning. */
  min: number;
  /** The target when the user asks for more contrast (AAA for text). */
  minMore: number;
  kind: "text" | "ui";
};

/**
 * The full list of foreground/background pairs the tokens allow. Anything not listed here
 * (text on --color-accent, say) is not allowed: use the matching on-* token instead.
 */
export const CONTRAST_RULES: ContrastRule[] = [
  ...(["text", "text-secondary", "text-muted", "accent-text", "focus", ...STATUSES.map((s) => `${s}-text` as const)] as const).map(
    (fg): ContrastRule => ({ fg, on: TEXT_BACKGROUNDS, min: 4.5, minMore: 7, kind: "text" }),
  ),
  { fg: "on-accent", on: ["accent", "accent-hover", "accent-pressed"], min: 4.5, minMore: 7, kind: "text" },
  ...STATUSES.map(
    (s): ContrastRule => ({ fg: `on-${s}`, on: [`${s}-solid`, `${s}-solid-hover`], min: 4.5, minMore: 7, kind: "text" }),
  ),
  { fg: "border-strong", on: [...SOLID_SURFACES], min: 3, minMore: 4.5, kind: "ui" },
  { fg: "accent-line", on: LINE_BACKGROUNDS, min: 3, minMore: 4.5, kind: "ui" },
  // Disabled controls are exempt from WCAG contrast; the launcher still keeps them readable.
  { fg: "text-disabled", on: [...SOLID_SURFACES], min: 3, minMore: 3, kind: "ui" },
  ...STATUSES.map(
    (s): ContrastRule => ({ fg: `${s}-border`, on: [...SOLID_SURFACES, `${s}-bg`], min: 3, minMore: 4.5, kind: "ui" }),
  ),
];

/* ---------------- helpers ---------------- */

const rgbOf = (hex: string) => hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };

/** The lowest contrast a colour of relative luminance `y` has against any of the given luminances. */
function minContrastY(y: number, bgYs: number[]) {
  let worst = Infinity;
  for (const by of bgYs) worst = Math.min(worst, (Math.max(y, by) + 0.05) / (Math.min(y, by) + 0.05));
  return worst;
}

/**
 * Moves a colour's lightness (keeping hue) the least distance in `dir` that makes it reach
 * `target` against every background. It must start on the far side of all of them (lighter
 * than every background for dir 1, darker for -1), so contrast only grows along the way.
 */
function fit(start: OKLCH, bgs: RGB[], target: number, dir: 1 | -1): OKLCH {
  const bgYs = bgs.map(luminance);
  const ok = (l: number) => minContrastY(luminance(quantize(oklchToRgb({ ...start, l }))), bgYs) >= target;
  const from = clamp(start.l, 0, 1);
  if (ok(from)) return { ...start, l: from };

  const end = dir > 0 ? 1 : 0;
  if (!ok(end)) return { ...start, l: end };

  let lo = from;
  let hi = end;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return { ...start, l: hi };
}

const hex = (lch: OKLCH) => rgbToHex(oklchToRgb(lch));
const hexA = (lch: OKLCH, alpha: number) => rgbToHex(oklchToRgb(lch), alpha);

/**
 * A filled colour and the text that goes on it. White-ish text is preferred (it reads as a
 * button on any background); the fill's lightness is nudged until the pair reaches `target`.
 * Hover and pressed shades move further from the text colour, so they only gain contrast.
 */
function fillPair(fill: OKLCH, tintHue: number, tintC: number, target: number, prefer: "light" | "dark" = "light") {
  const light: OKLCH = { l: 0.99, c: tintC * 0.08, h: tintHue };
  const dark: OKLCH = { l: 0.17, c: tintC * 0.3, h: tintHue };
  const lightRgb = quantize(oklchToRgb(light));
  const darkRgb = quantize(oklchToRgb(dark));

  const withLight = fit({ ...fill, l: Math.min(fill.l, 0.97) }, [lightRgb], target, -1);
  const withDark = fit({ ...fill, l: Math.max(fill.l, dark.l + 0.02) }, [darkRgb], target, 1);
  const moveLight = Math.abs(fill.l - withLight.l);
  const moveDark = Math.abs(withDark.l - fill.l);

  const useLight = prefer === "light" ? moveLight <= moveDark + 0.1 : moveLight + 0.1 < moveDark;
  const base = useLight ? withLight : withDark;
  const step = useLight ? -1 : 1;
  const shade = (by: number) => hex({ ...base, l: clamp(base.l + step * by, 0.03, 0.985) });

  return { fill: hex(base), hover: shade(0.05), pressed: shade(0.095), on: hex(useLight ? light : dark) };
}

/** Status hues stay recognisable (red is red) but lean a little towards the picked hue, or away when too close. */
const STATUS_HUES: Record<Status, number> = { danger: 25, warning: 78, success: 150, info: 252 };

/*
 * Status hues for each kind of colour blindness. Picked by simulating full-strength protanopia,
 * deuteranopia and tritanopia (Machado et al. 2009) on the launcher's own status shades and
 * keeping the hues as far apart as they can get, with the pairs that carry meaning (working vs
 * failed, warning vs failed) weighted over info. Red-green types get a blue "working" and a
 * yellow warning; blue-yellow types keep red and green and move info to cyan. These never lean
 * towards the picked colour, and lightness also differs (warning lighter, danger and info darker), which
 * no colour blindness takes away.
 */
const VISION_HUES: Record<Exclude<ColourVision, "standard">, Record<Status, number>> = {
  protanopia: { danger: 15, warning: 90, success: 220, info: 305 },
  deuteranopia: { danger: 15, warning: 68, success: 195, info: 245 },
  tritanopia: { danger: 15, warning: 90, success: 140, info: 200 },
};
const VISION_LIGHTNESS: Record<Status, number> = { danger: -0.05, warning: 0.07, success: 0, info: -0.08 };

function statusHue(base: number, seedHue: number, seedChroma: number) {
  const d = hueDelta(base, seedHue);
  const shift = Math.abs(d) < 30 ? -Math.sign(d || 1) * (30 - Math.abs(d)) * 0.4 : clamp(d * 0.12, -10, 10);
  return (base + shift * smoothstep(0.03, 0.1, seedChroma) + 360) % 360;
}

/** Which base the "auto" mode picks: pale colours (near-white, pastels, light greys) give a light launcher. */
export function autoScheme(seed: OKLCH): Scheme {
  return seed.l >= 0.8 && seed.c <= 0.13 ? "light" : "dark";
}

export function resolveScheme(settings: ThemeSettings, systemPrefersDark = true): Scheme {
  if (settings.mode === "dark" || settings.mode === "light") return settings.mode;
  if (settings.mode === "system") return systemPrefersDark ? "dark" : "light";
  return autoScheme(rgbToOklch(parseColor(settings.seed) ?? rgbOf(DEFAULT_SEED)));
}

/** Makes stored or typed settings safe to use. */
export function normaliseTheme(raw: unknown): ThemeSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ThemeSettings, unknown>>;
  const parsed = typeof value.seed === "string" ? parseColor(value.seed) : null;
  return {
    seed: parsed ? rgbToHex(parsed) : DEFAULT_THEME.seed,
    mode: (["auto", "dark", "light", "system"] as const).find((m) => m === value.mode) ?? DEFAULT_THEME.mode,
    contrast: value.contrast === "more" ? "more" : "standard",
    tint: typeof value.tint === "number" && Number.isFinite(value.tint) ? clamp(value.tint, 0, 1) : DEFAULT_THEME.tint,
    vision: (["standard", "protanopia", "deuteranopia", "tritanopia"] as const).find((v) => v === value.vision) ?? DEFAULT_THEME.vision,
    font: (["launcher", "verdana", "comic"] as const).find((f) => f === value.font) ?? DEFAULT_THEME.font,
    spacing: (["standard", "roomy", "wide"] as const).find((v) => v === value.spacing) ?? DEFAULT_THEME.spacing,
    guide: (["off", "line", "focus"] as const).find((g) => g === value.guide) ?? DEFAULT_THEME.guide,
  };
}

/* ---------------- the palette ---------------- */

export function buildPalette(input: ThemeSettings, systemPrefersDark = true): Palette {
  const settings = normaliseTheme(input);
  const seedRgb = rgbOf(settings.seed);
  const seed = rgbToOklch(seedRgb);
  const scheme = resolveScheme(settings, systemPrefersDark);
  const dark = scheme === "dark";
  const more = settings.contrast === "more";
  const tint = settings.tint;
  const dir: 1 | -1 = dark ? 1 : -1;

  const H = seed.h;
  const C = seed.c;
  // 0 for greys, 1 for anything with a clear hue.
  const hueful = smoothstep(0.02, 0.07, C);

  // Targets carry a little headroom over the WCAG minimum for browsers' own rounding.
  const TEXT = (more ? 7 : 4.5) + 0.05;
  const UI = (more ? 4.5 : 3) + 0.05;

  const colors = {} as Record<ColorToken, string>;
  const put = (token: ColorToken, lch: OKLCH) => (colors[token] = hex(lch));

  /* Surfaces. A very dark pick in dark mode (navy, near-black) becomes the background itself;
     a very pale pick in light mode (cream, ice) does the same. Otherwise backgrounds are a
     neutral dyed with the hue, as strongly as the tint setting says. */
  let b: number;
  let bc: number;
  if (dark) {
    const follow = smoothstep(0.42, 0.22, seed.l);
    b = lerp(0.195, clamp(seed.l, 0.12, 0.26), follow) - (more ? 0.03 : 0);
    bc = lerp(Math.min(C, 0.16) * 0.3 * tint, Math.min(C, 0.09) * (0.35 + 0.65 * tint), follow);
    put("bg", { l: b, c: bc, h: H });
    put("chrome", { l: b - 0.025, c: bc, h: H });
    put("surface-sunken", { l: b - 0.04, c: bc * 0.9, h: H });
    put("surface", { l: b + 0.04, c: bc, h: H });
    put("surface-raised", { l: b + 0.08, c: bc, h: H });
    put("accent-subtle", { l: b + 0.075, c: Math.min(C, 0.14) * 0.45, h: H });
    put("accent-subtle-hover", { l: b + 0.11, c: Math.min(C, 0.14) * 0.5, h: H });
    colors.hover = hexA({ l: 0.98, c: Math.min(C, 0.1) * 0.2, h: H }, 0.07);
    colors.pressed = hexA({ l: 0.98, c: Math.min(C, 0.1) * 0.2, h: H }, 0.12);
  } else {
    const follow = smoothstep(0.86, 0.95, seed.l);
    b = Math.min(0.985, lerp(0.968, clamp(seed.l, 0.93, 0.975), follow) + (more ? 0.01 : 0));
    bc = lerp(Math.min(C, 0.16) * 0.14 * tint, Math.min(C, 0.045) * (0.4 + 0.6 * tint), follow);
    put("bg", { l: b, c: bc, h: H });
    put("chrome", { l: b - 0.03, c: bc, h: H });
    put("surface-sunken", { l: b - 0.04, c: bc, h: H });
    put("surface", { l: Math.min(1, b + 0.022), c: bc * 0.6, h: H });
    put("surface-raised", { l: Math.min(1, b + 0.032), c: bc * 0.4, h: H });
    put("accent-subtle", { l: b - 0.045, c: Math.min(C, 0.14) * 0.4, h: H });
    put("accent-subtle-hover", { l: b - 0.075, c: Math.min(C, 0.14) * 0.45, h: H });
    colors.hover = hexA({ l: 0.25, c: Math.min(C, 0.1) * 0.3, h: H }, 0.06);
    colors.pressed = hexA({ l: 0.25, c: Math.min(C, 0.1) * 0.3, h: H }, 0.1);
  }

  const vision = settings.vision === "standard" ? null : VISION_HUES[settings.vision];
  const statusHues = Object.fromEntries(STATUSES.map((s) => [s, vision ? vision[s] : statusHue(STATUS_HUES[s], H, C)])) as Record<Status, number>;
  // Under a colour-vision setting the statuses also step apart in lightness.
  const stepL = (s: Status) => (vision ? VISION_LIGHTNESS[s] : 0);
  for (const s of STATUSES) {
    put(`${s}-bg`, dark ? { l: b + 0.055, c: 0.045, h: statusHues[s] } : { l: b - 0.03, c: 0.04, h: statusHues[s] });
  }

  const resolve = (ref: BackgroundRef) => backgroundRgb(colors, ref);
  const textBgs = TEXT_BACKGROUNDS.map(resolve);
  const solidBgs = SOLID_SURFACES.map(resolve);
  const lineBgs = LINE_BACKGROUNDS.map(resolve);

  /* Text: each level starts where the design wants it and is only ever pushed further
     from the backgrounds, never closer, until it clears the target on all of them. */
  const textC = Math.min(C, 0.12);
  const text = fit({ l: dark ? 0.965 : 0.2, c: textC * 0.1, h: H }, textBgs, more ? 12 : 7, dir);
  colors.text = hex(text);
  put("text-secondary", fit({ l: dark ? 0.83 : 0.38, c: textC * 0.22, h: H }, textBgs, TEXT, dir));
  put("text-muted", fit({ l: dark ? 0.7 : 0.5, c: textC * 0.28, h: H }, textBgs, TEXT, dir));
  put("text-disabled", fit({ l: dark ? b + 0.22 : b - 0.32, c: textC * 0.2, h: H }, solidBgs, 3.05, dir));

  put("border", { l: dark ? b + 0.1 : b - 0.11, c: bc * 1.2, h: H });
  put("border-strong", fit({ l: dark ? b + 0.27 : b - 0.36, c: Math.max(bc * 1.5, textC * 0.2), h: H }, solidBgs, UI, dir));

  /* Accent. The fill is the picked colour, nudged only as far as its text needs. Greys
     pick a near-white (dark mode) or near-black (light mode) fill: a monochrome launcher. */
  const fillL = dark
    ? clamp(Math.max(seed.l, lerp(0.86, 0.5, hueful)), 0, 0.93)
    : clamp(Math.min(seed.l, lerp(0.28, 0.62, hueful)), 0.18, 1);
  // A colour moved lighter (or darker, in light mode) than the pick keeps its strength
  // relative to what that lightness can hold, so a navy pick gives a blue, not a slate grey.
  const lift = (l: number) => C * clamp(dark ? l / Math.max(seed.l, 0.05) : (1 - l) / Math.max(1 - seed.l, 0.05), 1, 2.5);
  const accent = fillPair({ l: fillL, c: lift(fillL), h: H }, H, Math.min(C, 0.1), TEXT);
  colors.accent = accent.fill;
  colors["accent-hover"] = accent.hover;
  colors["accent-pressed"] = accent.pressed;
  colors["on-accent"] = accent.on;

  const accentTextL = dark ? Math.max(seed.l, 0.74) : Math.min(seed.l, 0.5);
  const accentText = fit(
    { l: accentTextL, c: Math.min(lift(accentTextL), 0.2), h: H },
    textBgs,
    TEXT,
    dir,
  );
  colors["accent-text"] = hex(accentText);
  colors.focus = colors["accent-text"];

  const accentLineL = dark ? Math.max(seed.l, 0.62) : Math.min(seed.l, 0.56);
  const accentLine = fit({ l: accentLineL, c: Math.min(lift(accentLineL), 0.22), h: H }, lineBgs, UI, dir);
  colors["accent-line"] = hex(accentLine);
  colors["accent-glow"] = hexA(accentLine, 0.35);

  /* Status colours. */
  for (const s of STATUSES) {
    const h = statusHues[s];
    put(`${s}-text`, fit({ l: (dark ? 0.8 : 0.5) + stepL(s) * (dark ? 1 : -1), c: dark ? 0.14 : 0.17, h }, textBgs, TEXT, dir));
    const own = resolve(`${s}-bg`);
    put(`${s}-border`, fit({ l: dark ? 0.62 : 0.6, c: 0.13, h }, [...solidBgs, own], UI, dir));
    // Amber reads as a warning only while it stays bright, so it carries dark text.
    const solid = fillPair({ l: (dark ? 0.66 : 0.56) + stepL(s), c: dark ? 0.17 : 0.18, h }, h, 0.05, TEXT, s === "warning" ? "dark" : "light");
    colors[`${s}-solid`] = solid.fill;
    colors[`${s}-solid-hover`] = solid.hover;
    colors[`on-${s}`] = solid.on;
  }

  colors.scrim = dark ? hexA({ l: 0.08, c: bc, h: H }, 0.62) : hexA({ l: 0.22, c: bc, h: H }, 0.42);
  colors.shadow = dark ? hexA({ l: 0.06, c: bc, h: H }, 0.5) : hexA({ l: 0.25, c: Math.min(C, 0.1) * 0.4, h: H }, 0.16);

  /* The logo is drawn in Unity violet; turn it to the picked hue, and grey for greys. */
  const rotate = Math.round(hueDelta(rgbToHsl(rgbOf(DEFAULT_SEED)).h, rgbToHsl(seedRgb).h));
  const saturate = Math.round(clamp(C / 0.18, 0, 1) * hueful * 100) / 100;
  const logoFilter = `hue-rotate(${rotate}deg) saturate(${saturate})`;

  return { scheme, colors, logoFilter };
}

/** The colour shown for a background reference ("surface+hover" is the hover layer over surface). */
export function backgroundRgb(colors: Record<ColorToken, string>, ref: BackgroundRef): RGB {
  const [base, layer] = ref.split("+") as [ColorToken, ColorToken | undefined];
  const under = rgbOf(colors[base]);
  if (!layer) return under;
  return composite(rgbOf(colors[layer]), hexAlpha(colors[layer]), under);
}

export type ContrastFailure = { fg: ColorToken; on: BackgroundRef; ratio: number; min: number };

/** Every allowed pair that misses its target. Empty means the palette is safe. */
export function checkPalette(palette: Palette, more = false): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const rule of CONTRAST_RULES) {
    const fg = rgbOf(palette.colors[rule.fg]);
    const min = more ? rule.minMore : rule.min;
    for (const on of rule.on) {
      const ratio = contrast(fg, backgroundRgb(palette.colors, on));
      if (ratio < min) failures.push({ fg: rule.fg, on, ratio, min });
    }
  }
  return failures;
}

/** The custom properties a palette sets on :root. */
export function paletteToCssVars(palette: Palette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const token of COLOR_TOKENS) vars[`--color-${token}`] = palette.colors[token];
  vars["--logo-filter"] = palette.logoFilter;
  return vars;
}
