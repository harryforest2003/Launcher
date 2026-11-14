#!/usr/bin/env node
/*
 * Checks the launcher's colour system. Runs the real theme engine (src/theme/engine.ts;
 * Node strips its types), so no build step and no extra packages.
 *
 *   node scripts/theme-check.mjs                 contrast sweep: thousands of picked colours, in
 *                                                every base (auto, dark, light), both contrast
 *                                                levels and three tint strengths; every allowed
 *                                                text/background pair must meet WCAG AA (AAA for
 *                                                text when "more contrast" is on). Exit 1 on any miss.
 *   node scripts/theme-check.mjs --count         counts hard-coded colours left in src/ (outside
 *                                                src/theme): hex, rgb(a), hsl(a), hwb, lab, lch,
 *                                                oklab, oklch and named colours in style values.
 *        --count --files                         ...with a per-file breakdown
 *        --count --list                          ...listing every hit with its line
 *        --count --max=N                         exit 1 when more than N are left (for CI)
 *        --count --all                           include src/webPreview's sample data too
 *   node scripts/theme-check.mjs --css           prints the default palette as CSS, to paste
 *                                                into src/theme/tokens.css if the engine changes.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === name || a.startsWith(`${name}=`));
const value = (name) => args.find((a) => a.startsWith(`${name}=`))?.split("=")[1];

const engine = await import(join(root, "src/theme/engine.ts"));
const color = await import(join(root, "src/theme/color.ts"));

/* ---------------- contrast sweep ---------------- */

function seeds() {
  const out = new Set();
  const add = (rgb) => out.add(color.rgbToHex(rgb));

  // A perceptual grid over the whole space: 30 hues x 13 lightnesses x 6 chromas.
  for (let h = 0; h < 360; h += 12)
    for (let l = 0; l <= 1.0001; l += 1 / 12)
      for (const c of [0.02, 0.06, 0.1, 0.15, 0.22, 0.32]) add(color.oklchToRgb({ l, c, h }));

  // Pure greys, black to white.
  for (let v = 0; v <= 255; v += 5) add({ r: v / 255, g: v / 255, b: v / 255 });

  // Fully saturated sRGB colours at every hue, and their tints and shades (neon included).
  for (let h = 0; h < 360; h += 5)
    for (const [s, v] of [[1, 1], [1, 0.5], [1, 0.2], [0.3, 1], [0.08, 1], [0.6, 0.85]]) add(color.hsvToRgb({ h, s, v }));

  // Random colours from a fixed seed, so a failure can be reproduced.
  let state = 0x2545f491;
  const rand = () => ((state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  for (let i = 0; i < 600; i++) add({ r: rand(), g: rand(), b: rand() });

  // Awkward edges.
  for (const hex of ["#000000", "#ffffff", "#010101", "#fefefe", "#808080", "#777777", "#ff0000", "#00ff00", "#0000ff",
    "#ffff00", "#00ffff", "#ff00ff", "#b4ff00", "#39ff14", "#ff073a", "#0b1530", "#fdf6e3", "#f4f1ea", "#7b34e6"])
    out.add(hex);

  return [...out];
}

function sweep() {
  const list = seeds();
  const modes = ["auto", "dark", "light"];
  const contrasts = ["standard", "more"];
  const tints = [0, 0.5, 1];

  let palettes = 0;
  let pairs = 0;
  const failures = [];
  const worst = new Map();
  const schemes = { dark: 0, light: 0 };
  const started = Date.now();

  for (const seed of list)
    for (const mode of modes)
      for (const level of contrasts)
        for (const tint of tints) {
          const settings = { seed, mode, contrast: level, tint };
          const palette = engine.buildPalette(settings);
          palettes++;
          if (mode === "auto") schemes[palette.scheme]++;

          for (const token of engine.COLOR_TOKENS) {
            if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(palette.colors[token])) failures.push({ settings, problem: `${token} is ${palette.colors[token]}` });
          }

          for (const rule of engine.CONTRAST_RULES) {
            const min = level === "more" ? rule.minMore : rule.min;
            const fg = color.hexToRgb(palette.colors[rule.fg]);
            for (const on of rule.on) {
              const ratio = color.contrast(fg, engine.backgroundRgb(palette.colors, on));
              pairs++;
              const key = `${rule.fg} on ${on}`;
              if (!worst.has(key) || worst.get(key).ratio > ratio) worst.set(key, { ratio, min, seed, mode, level, tint });
              if (ratio < min) failures.push({ settings, problem: `${key}: ${ratio.toFixed(2)} < ${min}` });
            }
          }
        }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Theme contrast sweep: ${list.length} picked colours, ${palettes} palettes, ${pairs.toLocaleString()} pairs checked in ${seconds}s.`);
  console.log(`"From colour" chose dark ${schemes.dark} times and light ${schemes.light} times.`);

  // The tightest pair of each kind, so it's clear how close to the line the engine runs.
  const tight = [...worst.entries()].sort((a, b) => a[1].ratio / a[1].min - b[1].ratio / b[1].min).slice(0, 6);
  console.log("Closest calls (ratio / required):");
  for (const [key, w] of tight) console.log(`  ${key.padEnd(40)} ${w.ratio.toFixed(2)} / ${w.min}  (${w.seed}, ${w.mode}, ${w.level}, tint ${w.tint})`);

  // The token files must hold the engine's own default palette.
  let css = "";
  try {
    css = readFileSync(join(root, "src/theme/tokens.css"), "utf8");
  } catch {
    // Reported below as missing values.
  }
  const defaults = engine.paletteToCssVars(engine.buildPalette(engine.DEFAULT_THEME));
  for (const [name, val] of Object.entries(defaults)) {
    const m = new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(css);
    if (!m || m[1].trim() !== val) failures.push({ settings: engine.DEFAULT_THEME, problem: `tokens.css ${name} is ${m?.[1] ?? "missing"}, engine says ${val} (run --css)` });
  }

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} problems. First 25:`);
    for (const f of failures.slice(0, 25)) console.error(`  ${JSON.stringify(f.settings)}  ${f.problem}`);
    process.exit(1);
  }
  console.log("\nPASS: every allowed pair meets WCAG AA (and AAA text with more contrast) for every colour tried.");
}

function printDefaultCss() {
  const palette = engine.buildPalette(engine.DEFAULT_THEME);
  console.log(`  /* Default palette (${engine.DEFAULT_SEED}, ${palette.scheme}). Generated by: node scripts/theme-check.mjs --css */`);
  console.log(`  color-scheme: ${palette.scheme};`);
  for (const [name, val] of Object.entries(engine.paletteToCssVars(palette))) console.log(`  ${name}: ${val};`);
}

/* ---------------- hard-coded colour count ---------------- */

const NAMED = new Set(
  ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen").split(" "),
);

// CSS properties (and their React camelCase forms) whose values are colours or can hold one.
const COLOR_PROPS =
  "color|background|background-color|backgroundColor|border|border-color|borderColor|border-top|borderTop|border-bottom|borderBottom|" +
  "border-left|borderLeft|border-right|borderRight|border-top-color|borderTopColor|border-bottom-color|borderBottomColor|" +
  "border-left-color|borderLeftColor|border-right-color|borderRightColor|outline|outline-color|outlineColor|fill|stroke|" +
  "box-shadow|boxShadow|text-shadow|textShadow|caret-color|caretColor|accent-color|accentColor|text-decoration-color|textDecorationColor|" +
  "column-rule|columnRule|stop-color|stopColor|filter|scrollbar-color|scrollbarColor|accent";

const HEX = /(?<![\w&/#$-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/gi;
const NAMED_IN_STYLE = new RegExp(`(?:^|[\\s{;,(])(?:${COLOR_PROPS})\\s*:\\s*([^;}\\n]*)`, "g");
const SVG_ATTR = /\b(?:fill|stroke|stopColor|stop-color|color)=["{]\s*["']?([a-z]+)["']?/g;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(tsx?|css|jsx?|mjs|cjs|html)$/.test(name)) files.push(full);
  }
  return files;
}

function countHardCoded() {
  const srcDir = join(root, "src");
  const themeDir = join(srcDir, "theme") + sep;
  // The web preview's sample data stands in for what Electron sends (each game's own colour,
  // say); it is content, not the UI's styling, so it is left out unless --all is given.
  const previewDir = join(srcDir, "webPreview") + sep;
  const perFile = [];
  const hits = [];

  for (const file of walk(srcDir)) {
    if (file.startsWith(themeDir)) continue;
    if (file.startsWith(previewDir) && !flag("--all")) continue;
    const rel = relative(root, file);
    const isCss = file.endsWith(".css");
    const lines = readFileSync(file, "utf8").split("\n");
    let count = 0;

    lines.forEach((line, i) => {
      // Comments don't paint anything.
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/^\s*\*.*$/, "");
      const found = [];
      for (const m of code.matchAll(HEX)) found.push(m[0]);
      for (const m of code.matchAll(FUNC)) found.push(m[0] + "...)");
      for (const m of code.matchAll(NAMED_IN_STYLE)) {
        // In CSS a name stands bare; in TypeScript it is a string ("white"), not a constant (WHITE).
        const values = isCss ? [m[1]] : [...m[1].matchAll(/(["'`])(.*?)\1/g)].map((q) => q[2]);
        for (const v of values) for (const word of v.match(/\b[a-z]+\b/g) ?? []) if (NAMED.has(word)) found.push(word);
      }
      for (const m of code.matchAll(SVG_ATTR)) if (NAMED.has(m[1])) found.push(m[1]);
      if (found.length) {
        count += found.length;
        hits.push(`${rel}:${i + 1}  ${found.join(" ")}`);
      }
    });

    if (count) perFile.push([rel, count]);
  }

  const total = perFile.reduce((n, [, c]) => n + c, 0);
  console.log(`Hard-coded colours left in src/ (outside src/theme${flag("--all") ? "" : " and src/webPreview"}): ${total} in ${perFile.length} files.`);
  if (flag("--files")) for (const [rel, c] of perFile.sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(5)}  ${rel}`);
  if (flag("--list")) for (const h of hits) console.log(`  ${h}`);

  const max = value("--max");
  if (max !== undefined && total > Number(max)) {
    console.error(`FAIL: ${total} is more than the allowed ${max}.`);
    process.exit(1);
  }
}

/* ---------------- run ---------------- */

if (flag("--count")) countHardCoded();
else if (flag("--css")) printDefaultCss();
else sweep();
