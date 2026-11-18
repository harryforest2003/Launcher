import { useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Info, RotateCcw, TriangleAlert, X } from "lucide-react";
import Segmented from "../components/ui/Segmented";
import ColorPicker from "./ColorPicker";
import { hexToRgb, luminance } from "./color.ts";
import {
  buildPalette,
  DEFAULT_THEME,
  resolveScheme,
  type ColourVision,
  type Palette,
  type ReadingFont,
  type ThemeMode,
  type ThemeSettings,
} from "./engine.ts";
import {
  readRecent,
  rememberRecent,
  resetTheme,
  updateTheme,
  useTheme,
} from "./runtime.ts";
import "../components/ui/ui.css";
import "./appearance.css";

/* Ready-made colours, named the way a player would ask for them: every hue family, a deep and
   a pale one of the popular ones, a dark, a grey and two near-whites. */
const PRESETS: { name: string; hex: string }[] = [
  { name: "Violet", hex: DEFAULT_THEME.seed },
  { name: "Pink", hex: "#e0457b" },
  { name: "Red", hex: "#d93a3a" },
  { name: "Orange", hex: "#e2702f" },
  { name: "Yellow", hex: "#f0b81c" },
  { name: "Lime", hex: "#a3e635" },
  { name: "Green", hex: "#3f9a4f" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Sky blue", hex: "#38a3e0" },
  { name: "Blue", hex: "#2f5bea" },
  { name: "Navy", hex: "#101a35" },
  { name: "Graphite", hex: "#3d3d40" },
  { name: "Pale pink", hex: "#f4c2d7" },
  { name: "Mint", hex: "#bfe8d4" },
  { name: "Sand", hex: "#e8dcc5" },
  { name: "Paper", hex: "#f4f4f2" },
];

const MODES: {
  mode: ThemeMode;
  label: string;
  note: (s: "dark" | "light") => string;
}[] = [
  {
    mode: "auto",
    label: "Match colour",
    note: (s) =>
      `Light for pale colours, dark for deep ones. ${s === "dark" ? "Dark" : "Light"} now.`,
  },
  {
    mode: "dark",
    label: "Dark",
    note: () => "Always dark, whatever the colour.",
  },
  {
    mode: "light",
    label: "Light",
    note: () => "Always light, whatever the colour.",
  },
  {
    mode: "system",
    label: "System",
    note: (s) =>
      `Follows your computer's setting. ${s === "dark" ? "Dark" : "Light"} now.`,
  },
];

/* The tick on a colour chip: dark on pale chips, white on the rest. A data colour, not a theme one. */
const tickOn = (hex: string) => {
  const l = luminance(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? "#ffffff" : "#1c1c1c";
};

const systemDark = () =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;

/* A tiny drawing of the launcher in a palette: sidebar, page, a panel, and a Play button. */
function MiniLauncher({ palette }: { palette: Palette }) {
  const c = palette.colors;
  return (
    <div className="mini" style={{ background: c.bg }} aria-hidden="true">
      <div className="mini-side" style={{ background: c.chrome }}>
        <span className="mini-mark" style={{ background: c["accent-text"] }} />
        <span
          style={{
            background: c["accent-subtle"],
            boxShadow: `inset 2px 0 0 ${c["accent-line"]}`,
          }}
        />
        <span style={{ background: c["surface-raised"] }} />
        <span style={{ background: c["surface-raised"] }} />
      </div>
      <div className="mini-main">
        <span className="mini-title" style={{ background: c.text }} />
        <div className="mini-panel" style={{ background: c.surface }}>
          <span style={{ background: c["text-secondary"], width: "70%" }} />
          <span style={{ background: c["text-muted"], width: "45%" }} />
          <span
            className="mini-play"
            style={{ background: c.accent, color: c["on-accent"] }}
          >
            Play
          </span>
        </div>
      </div>
    </div>
  );
}

/*
 * Settings > Appearance: the colour the whole launcher is dyed with, light or dark, and how
 * strong contrast and background tint are. Every change shows at once across the app and is
 * saved by itself. Renders its own section title (id "appearance-title") with Reset beside it.
 */
/*
 * Settings lists each titled part in its own rail item, so it can ask for one part at a time;
 * with no part, all three show. The rail's section heading names the part, so the inner one is
 * kept only for screen readers.
 */
export type AppearancePart = "colour" | "base" | "readability" | "vision" | "reading";

/* Ordered by how common each is: deuteranomaly alone is about 5% of men. */
const VISIONS: { vision: ColourVision; label: string; note: string }[] = [
  { vision: "standard", label: "Standard", note: "Typical colour vision" },
  { vision: "deuteranopia", label: "Deuteranopia", note: "Green-weak, the most common" },
  { vision: "protanopia", label: "Protanopia", note: "Red-weak" },
  { vision: "tritanopia", label: "Tritanopia", note: "Blue-yellow" },
];

const STATUS_SAMPLES = [
  { status: "success", label: "Ready", Icon: Check },
  { status: "warning", label: "Update", Icon: TriangleAlert },
  { status: "danger", label: "Failed", Icon: X },
  { status: "info", label: "Info", Icon: Info },
] as const;

/* Each face is named after itself and drawn in itself, so the card is its own preview. */
const FONTS: { font: ReadingFont; label: string; note: string; family: string }[] = [
  { font: "launcher", label: "Launcher", note: "The launcher's own face", family: "var(--font-ui-launcher, var(--font-ui))" },
  { font: "verdana", label: "Verdana", note: "Wide, open letters", family: 'Verdana, Tahoma, "DejaVu Sans", sans-serif' },
  { font: "comic", label: "Comic Sans", note: "Hand-drawn; b, d, p and q differ", family: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
];

/* Arrow keys move the choice in a row of radio cards, the way native radio buttons do. */
function radioKeys<T extends string>(order: T[], current: T, pick: (value: T) => void, attr: string) {
  return (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = order[(order.indexOf(current) + step + order.length) % order.length];
    pick(next);
    (event.currentTarget.parentElement?.querySelector(`[${attr}="${next}"]`) as HTMLElement | null)?.focus();
  };
}

export default function AppearanceSettings({ part }: { part?: AppearancePart } = {}) {
  const show = (which: AppearancePart) => !part || part === which;
  const heading = part ? "appearance-heading set-visually-hidden" : "appearance-heading";
  const { settings, palette, saved } = useTheme();
  const [recent, setRecent] = useState(readRecent);
  const [undo, setUndo] = useState<ThemeSettings | null>(null);
  const [mixer, setMixer] = useState(false);
  const prefersDark = systemDark();

  const previews = useMemo(
    () =>
      Object.fromEntries(
        MODES.map(({ mode }) => [
          mode,
          buildPalette({ ...settings, mode }, prefersDark),
        ]),
      ) as Record<ThemeMode, Palette>,
    [settings, prefersDark],
  );

  const visionPreviews = useMemo(
    () =>
      Object.fromEntries(
        VISIONS.map(({ vision }) => [vision, buildPalette({ ...settings, vision }, prefersDark)]),
      ) as Record<ColourVision, Palette>,
    [settings, prefersDark],
  );

  const change = (patch: Partial<ThemeSettings>) => {
    setUndo(null);
    updateTheme(patch);
  };

  const pick = (hex: string, done: boolean) => {
    change({ seed: hex });
    if (done) setRecent(rememberRecent(hex));
  };

  const isDefault =
    settings.seed === DEFAULT_THEME.seed &&
    settings.mode === DEFAULT_THEME.mode &&
    settings.contrast === DEFAULT_THEME.contrast &&
    settings.tint === DEFAULT_THEME.tint;

  const tintWords =
    settings.tint < 0.15
      ? "Neutral"
      : settings.tint < 0.45
        ? "Light"
        : settings.tint < 0.75
          ? "Medium"
          : "Rich";
  const tintPercent = Math.round(settings.tint * 100);
  const presetName = PRESETS.find(
    (preset) => preset.hex === settings.seed,
  )?.name;

  const customSeed = !presetName;
  const mixerOpen = mixer || customSeed;

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const all = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        ".swatch",
      ) ?? [],
    );
    const next =
      all[(all.indexOf(event.currentTarget) + step + all.length) % all.length];
    next?.focus();
  };

  return (
    <div className="appearance">
      {show("colour") && (
      <>
      <section
        id="appearance-colour"
        aria-labelledby="appearance-colour-title"
        className="ui-panel appearance-block"
      >
        <div className="appearance-headrow">
          <h3 id="appearance-colour-title" className={heading}>
            Colour
          </h3>
          <p className="appearance-help">
            Text and buttons adjust, so everything stays easy to read.
          </p>
          <div className="set-pane-actions appearance-reset">
            <span className="set-visually-hidden" role="status" aria-live="polite">
              {saved
                ? `Saved. ${presetName ?? settings.seed}, ${palette.scheme === "dark" ? "dark" : "light"}.`
                : "Saving..."}
            </span>
            {undo ? (
              <button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                onClick={() => {
                  updateTheme(undo);
                  setUndo(null);
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Undo reset
              </button>
            ) : (
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                disabled={isDefault}
                title={isDefault ? "Already the launcher's own look" : undefined}
                onClick={() => {
                  setUndo(settings);
                  resetTheme();
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reset appearance
              </button>
            )}
          </div>
        </div>

        <div className="appearance-colour">
          <div className="appearance-swatches">
            <div role="group" aria-labelledby="presets-label">
              <p id="presets-label" className="appearance-label">
                Pick a colour
              </p>
              <div className="swatch-grid">
                {PRESETS.map((preset) => {
                  const selected = settings.seed === preset.hex;
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      className="swatch"
                      style={{
                        background: preset.hex,
                        color: tickOn(preset.hex),
                      }}
                      aria-pressed={selected}
                      aria-label={preset.name}
                      title={preset.name}
                      onClick={() => pick(preset.hex, true)}
                      onKeyDown={moveFocus}
                    >
                      {selected && (
                        <Check size={18} strokeWidth={3} aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="appearance-now">
            <p className="appearance-label">{presetName ?? "Your colour"}</p>
            <MiniLauncher palette={palette} />
          </div>
        </div>

        <div className="appearance-mix">
          <div className="appearance-mix-row">
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              aria-expanded={mixerOpen}
              aria-controls="mixer-body"
              onClick={() => setMixer(!mixerOpen)}
            >
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={
                  mixerOpen
                    ? "appearance-chevron appearance-chevron--open"
                    : "appearance-chevron"
                }
              />
              Or mix any colour
            </button>
            {recent.length > 0 && (
              <div
                role="group"
                aria-labelledby="recent-label"
                className="recent-group"
              >
                <p
                  id="recent-label"
                  className="appearance-label appearance-label--inline"
                >
                  Used lately
                </p>
                <div className="recent-row">
                  {recent.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className="swatch-chip swatch-chip--small"
                      style={{ background: hex, color: tickOn(hex) }}
                      aria-label={`Use ${hex}`}
                      title={hex}
                      aria-pressed={settings.seed === hex}
                      onClick={() => pick(hex, false)}
                    >
                      {settings.seed === hex && (
                        <Check size={12} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            id="mixer-body"
            role="group"
            aria-label="Mix any colour"
            hidden={!mixerOpen}
            className="appearance-mixer"
          >
            <ColorPicker value={settings.seed} onChange={pick} />
          </div>
        </div>
      </section>
      </>
      )}

      {show("base") && (
      <section
        id="appearance-base"
        aria-labelledby="appearance-base-title"
        className="ui-panel appearance-block"
      >
        <div className="appearance-headrow">
          <h3 id="appearance-base-title" className={heading}>
            Light or dark
          </h3>
          <p className="appearance-help">
            Each preview is drawn in your colour.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="appearance-base-title"
          className="mode-grid"
        >
          {MODES.map(({ mode, label, note }) => {
            const selected = settings.mode === mode;
            const scheme = resolveScheme({ ...settings, mode }, prefersDark);
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className="mode-card"
                title={note(scheme)}
                onClick={() => change({ mode })}
                onKeyDown={(event) => {
                  const order = MODES.map((m) => m.mode);
                  const step =
                    event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                        ? -1
                        : 0;
                  if (!step) return;
                  event.preventDefault();
                  const next =
                    order[
                      (order.indexOf(mode) + step + order.length) % order.length
                    ];
                  change({ mode: next });
                  (
                    event.currentTarget.parentElement?.querySelector(
                      `[data-mode="${next}"]`,
                    ) as HTMLElement | null
                  )?.focus();
                }}
                data-mode={mode}
              >
                <MiniLauncher palette={previews[mode]} />
                <span className="mode-label">
                  <span className="mode-radio" aria-hidden="true">
                    {selected && <Check size={12} />}
                  </span>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="appearance-help appearance-help--tight mode-note-line">
          {(() => {
            const current = MODES.find((m) => m.mode === settings.mode) ?? MODES[0];
            return current.note(resolveScheme(settings, prefersDark));
          })()}
        </p>
      </section>
      )}

      {show("readability") && (
      <section
        id="appearance-readability"
        aria-labelledby="appearance-readability-title"
        className="ui-panel appearance-block"
      >
        <h3 id="appearance-readability-title" className={heading}>
          Readability
        </h3>
        <div className="readability">
          <div className="readability-item">
            <p className="appearance-label" id="contrast-label">
              Contrast
            </p>
            <Segmented
              label="Contrast"
              value={settings.contrast}
              options={[
                { value: "standard", label: "Standard" },
                { value: "more", label: "More" },
              ]}
              onChange={(contrast) => change({ contrast })}
            />
            <p className="appearance-help appearance-help--tight">
              {settings.contrast === "more"
                ? "Stronger text and outlines, for small screens or bright rooms."
                : "Comfortable for most screens."}
            </p>
          </div>

          <div className="readability-item">
            <label className="appearance-label" htmlFor="tint-slider">
              Background tint
            </label>
            <div className="tint-row">
              <span
                className="appearance-help appearance-help--tight"
                aria-hidden="true"
              >
                Neutral
              </span>
              <input
                id="tint-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={tintPercent}
                aria-valuetext={`${tintWords}, ${tintPercent} percent`}
                onChange={(event) =>
                  change({ tint: Number(event.target.value) / 100 })
                }
                className="set-range"
                style={{ flex: 1, ["--fill" as string]: `${tintPercent}%` }}
              />
              <span
                className="appearance-help appearance-help--tight"
                aria-hidden="true"
              >
                Rich
              </span>
            </div>
            <p className="appearance-help appearance-help--tight">
              How much of your colour the backgrounds take on. {tintWords} now.
            </p>
          </div>
        </div>
      </section>
      )}
      {show("vision") && (
      <section
        id="appearance-vision"
        aria-labelledby="appearance-vision-title"
        className="ui-panel appearance-block"
      >
        <div className="appearance-headrow">
          <h3 id="appearance-vision-title" className={heading}>
            Colour vision
          </h3>
          <p className="appearance-help">
            Ready, update, failed and info badges move to colours you can tell apart, and step apart in brightness too.
          </p>
        </div>
        <div role="radiogroup" aria-labelledby="appearance-vision-title" className="choice-grid">
          {VISIONS.map(({ vision, label, note }) => {
            const selected = settings.vision === vision;
            const colors = visionPreviews[vision].colors;
            return (
              <button
                key={vision}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className="choice-card"
                data-vision={vision}
                onClick={() => change({ vision })}
                onKeyDown={radioKeys(VISIONS.map((v) => v.vision), settings.vision, (next) => change({ vision: next }), "data-vision")}
              >
                <span className="vision-chips" aria-hidden="true">
                  {STATUS_SAMPLES.map(({ status, Icon }) => (
                    <span
                      key={status}
                      className="vision-chip"
                      style={{ background: colors[`${status}-solid`], color: colors[`on-${status}`] }}
                    >
                      <Icon size={13} strokeWidth={2.75} />
                    </span>
                  ))}
                </span>
                <span className="choice-label">{label}</span>
                <span className="choice-note">{note}</span>
              </button>
            );
          })}
        </div>
        <div className="vision-sample" aria-label="How status badges look now">
          {STATUS_SAMPLES.map(({ status, label, Icon }) => (
            <span key={status} className={`vision-badge vision-badge--${status}`}>
              <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </section>
      )}

      {show("reading") && (
      <section
        id="appearance-reading"
        aria-labelledby="appearance-reading-title"
        className="ui-panel appearance-block"
      >
        <div className="appearance-headrow">
          <h3 id="appearance-reading-title" className={heading}>
            Reading
          </h3>
          <p className="appearance-help">
            For dyslexia and tired eyes: a clearer face, more room between letters and lines, and a guide that keeps your place.
          </p>
        </div>
        <p className="appearance-label" id="reading-font-label">
          Font
        </p>
        <div role="radiogroup" aria-labelledby="reading-font-label" className="choice-grid choice-grid--three">
          {FONTS.map(({ font, label, note, family }) => {
            const selected = settings.font === font;
            return (
              <button
                key={font}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className="choice-card"
                data-font-choice={font}
                onClick={() => change({ font })}
                onKeyDown={radioKeys(FONTS.map((f) => f.font), settings.font, (next) => change({ font: next }), "data-font-choice")}
              >
                <span className="font-sample" style={{ fontFamily: family }} aria-hidden="true">
                  Aa bd pq
                </span>
                <span className="choice-label" style={{ fontFamily: family }}>
                  {label}
                </span>
                <span className="choice-note">{note}</span>
              </button>
            );
          })}
        </div>
        <div className="readability">
          <div className="readability-item">
            <p className="appearance-label" id="spacing-label">
              Spacing
            </p>
            <Segmented
              label="Spacing"
              value={settings.spacing}
              options={[
                { value: "standard", label: "Standard" },
                { value: "roomy", label: "Roomy" },
                { value: "wide", label: "Wide" },
              ]}
              onChange={(spacing) => change({ spacing })}
            />
            <p className="appearance-help appearance-help--tight">
              {settings.spacing === "wide"
                ? "The most room between letters, words and lines (the WCAG text-spacing values)."
                : settings.spacing === "roomy"
                  ? "A little more room between letters, words and lines."
                  : "The launcher's usual spacing."}
            </p>
          </div>
          <div className="readability-item">
            <p className="appearance-label" id="guide-label">
              Reading guide
            </p>
            <Segmented
              label="Reading guide"
              value={settings.guide}
              options={[
                { value: "off", label: "Off" },
                { value: "line", label: "Line" },
                { value: "focus", label: "Focus" },
              ]}
              onChange={(guide) => change({ guide })}
            />
            <p className="appearance-help appearance-help--tight">
              {settings.guide === "line"
                ? "A tinted band follows your pointer to keep your place in a line."
                : settings.guide === "focus"
                  ? "Everything above and below your pointer dims, so one line stands out."
                  : "No guide."}
            </p>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
