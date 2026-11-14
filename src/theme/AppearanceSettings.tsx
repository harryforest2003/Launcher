import { useMemo, useState } from "react";
import { Check, CircleCheck, RotateCcw } from "lucide-react";
import Segmented from "../components/ui/Segmented";
import ColorPicker from "./ColorPicker";
import { hexToRgb, luminance } from "./color.ts";
import { buildPalette, DEFAULT_THEME, resolveScheme, type Palette, type ThemeMode, type ThemeSettings } from "./engine.ts";
import { readRecent, rememberRecent, resetTheme, updateTheme, useTheme } from "./runtime.ts";
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

const MODES: { mode: ThemeMode; label: string; note: (s: "dark" | "light") => string }[] = [
  { mode: "auto", label: "Match colour", note: (s) => `Light for pale colours, dark for deep ones. ${s === "dark" ? "Dark" : "Light"} now.` },
  { mode: "dark", label: "Dark", note: () => "Always dark, whatever the colour." },
  { mode: "light", label: "Light", note: () => "Always light, whatever the colour." },
  { mode: "system", label: "Same as computer", note: (s) => `Follows your computer's setting. ${s === "dark" ? "Dark" : "Light"} now.` },
];

/* The tick on a colour chip: dark on pale chips, white on the rest. A data colour, not a theme one. */
const tickOn = (hex: string) => {
  const l = luminance(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? "#ffffff" : "#1c1c1c";
};

const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;

/* A tiny drawing of the launcher in a palette: sidebar, page, a panel, and a Play button. */
function MiniLauncher({ palette }: { palette: Palette }) {
  const c = palette.colors;
  return (
    <div className="mini" style={{ background: c.bg }} aria-hidden="true">
      <div className="mini-side" style={{ background: c.chrome }}>
        <span className="mini-mark" style={{ background: c["accent-text"] }} />
        <span style={{ background: c["accent-subtle"], boxShadow: `inset 2px 0 0 ${c["accent-line"]}` }} />
        <span style={{ background: c["surface-raised"] }} />
        <span style={{ background: c["surface-raised"] }} />
      </div>
      <div className="mini-main">
        <span className="mini-title" style={{ background: c.text }} />
        <div className="mini-panel" style={{ background: c.surface }}>
          <span style={{ background: c["text-secondary"], width: "70%" }} />
          <span style={{ background: c["text-muted"], width: "45%" }} />
          <span className="mini-play" style={{ background: c.accent, color: c["on-accent"] }}>
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
export default function AppearanceSettings() {
  const { settings, palette, saved } = useTheme();
  const [recent, setRecent] = useState(readRecent);
  const [undo, setUndo] = useState<ThemeSettings | null>(null);
  const prefersDark = systemDark();

  const previews = useMemo(
    () => Object.fromEntries(MODES.map(({ mode }) => [mode, buildPalette({ ...settings, mode }, prefersDark)])) as Record<ThemeMode, Palette>,
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

  const tintWords = settings.tint < 0.15 ? "Neutral" : settings.tint < 0.45 ? "Light" : settings.tint < 0.75 ? "Medium" : "Rich";
  const tintPercent = Math.round(settings.tint * 100);
  const presetName = PRESETS.find((preset) => preset.hex === settings.seed)?.name;

  return (
    <div className="appearance">
      <div className="appearance-top">
        <h2 id="appearance-title" className="page-section-title">
          Appearance
        </h2>
        <span className="appearance-saved" role="status" aria-live="polite">
          {saved ? (
            <>
              <CircleCheck size={14} aria-hidden="true" />
              {`Saved. ${presetName ?? settings.seed}, ${palette.scheme === "dark" ? "dark" : "light"}.`}
            </>
          ) : (
            "Saving..."
          )}
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

      <section id="appearance-colour" aria-labelledby="appearance-colour-title" className="ui-panel appearance-block">
        <div className="appearance-headrow">
          <h3 id="appearance-colour-title" className="appearance-heading">
            Colour
          </h3>
          <p className="appearance-help">The whole launcher takes it on. Text and buttons adjust, so everything stays easy to read.</p>
        </div>

        <div className="appearance-colour">
          <div className="appearance-swatches">
            <div role="group" aria-labelledby="presets-label">
              <p id="presets-label" className="appearance-label">
                Pick a colour
              </p>
              <div className="swatch-grid">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    className="swatch"
                    aria-pressed={settings.seed === preset.hex}
                    onClick={() => pick(preset.hex, true)}
                  >
                    <span className="swatch-chip" style={{ background: preset.hex, color: tickOn(preset.hex) }}>
                      {settings.seed === preset.hex && <Check size={14} aria-hidden="true" />}
                    </span>
                    <span className="swatch-name">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {recent.length > 0 && (
              <div role="group" aria-labelledby="recent-label">
                <p id="recent-label" className="appearance-label">
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
                      {settings.seed === hex && <Check size={12} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div role="group" aria-labelledby="mixer-label">
            <p id="mixer-label" className="appearance-label">
              Or mix any colour
            </p>
            <ColorPicker value={settings.seed} onChange={pick} />
          </div>
        </div>
      </section>

      <section id="appearance-base" aria-labelledby="appearance-base-title" className="ui-panel appearance-block">
        <div className="appearance-headrow">
          <h3 id="appearance-base-title" className="appearance-heading">
            Light or dark
          </h3>
          <p className="appearance-help">Each preview is drawn in your colour.</p>
        </div>
        <div role="radiogroup" aria-labelledby="appearance-base-title" className="mode-grid">
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
                onClick={() => change({ mode })}
                onKeyDown={(event) => {
                  const order = MODES.map((m) => m.mode);
                  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                  if (!step) return;
                  event.preventDefault();
                  const next = order[(order.indexOf(mode) + step + order.length) % order.length];
                  change({ mode: next });
                  (event.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
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
                <span className="mode-note">{note(scheme)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section id="appearance-readability" aria-labelledby="appearance-readability-title" className="ui-panel appearance-block">
        <h3 id="appearance-readability-title" className="appearance-heading">
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
              {settings.contrast === "more" ? "Stronger text and outlines, for small screens or bright rooms." : "Comfortable for most screens."}
            </p>
          </div>

          <div className="readability-item">
            <label className="appearance-label" htmlFor="tint-slider">
              Background tint
            </label>
            <div className="tint-row">
              <span className="appearance-help appearance-help--tight" aria-hidden="true">
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
                onChange={(event) => change({ tint: Number(event.target.value) / 100 })}
                className="set-range"
                style={{ flex: 1, ["--fill" as string]: `${tintPercent}%` }}
              />
              <span className="appearance-help appearance-help--tight" aria-hidden="true">
                Rich
              </span>
            </div>
            <p className="appearance-help appearance-help--tight">How much of your colour the backgrounds take on. {tintWords} now.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
