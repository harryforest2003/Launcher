import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Notice, Segmented } from "./ui";
import { BinIcon } from "./Icons";
import { hooksError, windowSizeError, type HooksDraft, type WindowDraft } from "../utils/launchSettings";

/*
 * An instance's game window and launch commands, on its Settings tab. The page keeps the
 * drafts and saves them with the rest of its settings.
 */

const card: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: 14,
};

const title: React.CSSProperties = { color: "var(--color-accent-text)", marginBottom: 4 };
const muted: React.CSSProperties = { color: "var(--color-text-muted)", fontSize: 12, marginBottom: 10 };
const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" };

/* ---------------- the game window ---------------- */

/* Width, height and fullscreen: shared by an instance's card and Settings. */
export function WindowFields({
  width,
  height,
  fullscreen,
  onChange,
}: {
  width: string;
  height: string;
  fullscreen: boolean;
  onChange: (next: { width: string; height: string; fullscreen: boolean }) => void;
}) {
  const error = windowSizeError(width, height);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={row}>
        <Field
          label="Width"
          inputMode="numeric"
          value={width}
          placeholder="854"
          disabled={fullscreen}
          onChange={(e) => onChange({ width: e.target.value, height, fullscreen })}
          style={{ width: 110 }}
        />
        <Field
          label="Height"
          inputMode="numeric"
          value={height}
          placeholder="480"
          disabled={fullscreen}
          onChange={(e) => onChange({ width, height: e.target.value, fullscreen })}
          style={{ width: 110 }}
        />
        {[
          ["1280", "720"],
          ["1920", "1080"],
        ].map(([w, h]) => (
          <Button key={w} size="sm" variant="ghost" disabled={fullscreen} onClick={() => onChange({ width: w, height: h, fullscreen })}>
            {w} x {h}
          </Button>
        ))}
        {(width || height) && (
          <Button size="sm" variant="ghost" disabled={fullscreen} onClick={() => onChange({ width: "", height: "", fullscreen })}>
            Minecraft's own
          </Button>
        )}
      </div>
      {error && !fullscreen && (
        <span role="alert" style={{ color: "var(--color-danger-text)", fontSize: 12 }}>
          {error}
        </span>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
        <input type="checkbox" checked={fullscreen} onChange={(e) => onChange({ width, height, fullscreen: e.target.checked })} />
        Start fullscreen
      </label>
      <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Blank is Minecraft's own size, 854 x 480. F11 switches fullscreen in the game.</span>
    </div>
  );
}

export function GameWindowCard({ draft, onChange, settings }: { draft: WindowDraft; onChange: (draft: WindowDraft) => void; settings: GameWindow | null }) {
  const followed = !settings
    ? "As in Settings"
    : settings.fullscreen
      ? "As in Settings (fullscreen)"
      : settings.width && settings.height
        ? `As in Settings (${settings.width} x ${settings.height})`
        : "As in Settings (854 x 480)";
  return (
    <div style={card} data-testid="instance-window">
      <p style={title}>Game window</p>
      <p style={muted}>The size Minecraft opens at, from its next launch.</p>
      <div style={{ marginBottom: draft.own ? 12 : 0 }}>
        <Segmented
          label="Game window for this instance"
          value={draft.own ? "own" : "settings"}
          onChange={(value) => onChange({ ...draft, own: value === "own" })}
          options={[
            { value: "settings", label: followed },
            { value: "own", label: "Its own" },
          ]}
        />
      </div>
      {draft.own && <WindowFields width={draft.width} height={draft.height} fullscreen={draft.fullscreen} onChange={(next) => onChange({ ...draft, ...next })} />}
    </div>
  );
}

/* ---------------- launch commands ---------------- */

export function LaunchCommandsCard({ draft, onChange, windows }: { draft: HooksDraft; onChange: (draft: HooksDraft) => void; windows: boolean }) {
  const variable = (name: string) => (windows ? `%${name}%` : `$${name}`);
  const error = hooksError(draft);
  const setVariable = (index: number, change: Partial<{ name: string; value: string }>) =>
    onChange({ ...draft, env: draft.env.map((entry, i) => (i === index ? { ...entry, ...change } : entry)) });

  return (
    <div style={card} data-testid="instance-launch-commands">
      <p style={title}>Launch commands</p>
      <p style={muted}>
        Commands that run around each launch, in the instance's game folder. They can use {variable("INST_NAME")}, {variable("INST_DIR")}, {variable("INST_MC_DIR")},{" "}
        {variable("INST_JAVA")} and {variable("INST_MC_VERSION")}. They're never copied from an imported modpack.
      </p>
      {(draft.preLaunch || draft.wrapper || draft.postExit) && (
        <div style={{ marginBottom: 12 }}>
          <Notice tone="warning">These run on this computer with your permissions, so only use commands you wrote or trust.</Notice>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field
          label="Before launch"
          mono
          value={draft.preLaunch}
          placeholder={windows ? "e.g. backup.bat" : "e.g. ./sync-mods.sh"}
          hint="The game waits for it, and doesn't start if it fails (or runs for over 5 minutes)."
          onChange={(e) => onChange({ ...draft, preLaunch: e.target.value })}
        />
        <Field
          label="Wrapper"
          mono
          value={draft.wrapper}
          placeholder={windows ? "" : "e.g. gamemoderun"}
          hint="Runs Java itself: the game's command is added after it."
          onChange={(e) => onChange({ ...draft, wrapper: e.target.value })}
        />
        <Field
          label="After exit"
          mono
          value={draft.postExit}
          hint={`Runs once the game closes; nothing waits for it. ${variable("INST_EXIT_CODE")} is the game's exit code.`}
          onChange={(e) => onChange({ ...draft, postExit: e.target.value })}
        />

        <div>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 6 }}>Environment variables</p>
          <p style={muted}>Given to the game and to the commands above.</p>
          {draft.env.map((entry, index) => (
            <div key={index} style={{ ...row, alignItems: "center", marginBottom: 8 }}>
              <input
                className="ui-input ui-input--mono"
                aria-label={`Variable ${index + 1} name`}
                placeholder="NAME"
                value={entry.name}
                onChange={(e) => setVariable(index, { name: e.target.value })}
                style={{ flex: "1 1 140px" }}
              />
              <input
                className="ui-input ui-input--mono"
                aria-label={`Variable ${index + 1} value`}
                placeholder="value"
                value={entry.value}
                onChange={(e) => setVariable(index, { value: e.target.value })}
                style={{ flex: "2 1 220px" }}
              />
              <button
                className="bin-button"
                title={`Remove ${entry.name || "this variable"}`}
                aria-label={`Remove ${entry.name || `variable ${index + 1}`}`}
                onClick={() => onChange({ ...draft, env: draft.env.filter((_, i) => i !== index) })}
              >
                <BinIcon />
              </button>
            </div>
          ))}
          {error && (
            <p role="alert" style={{ color: "var(--color-danger-text)", fontSize: 12, marginBottom: 8 }}>
              {error}
            </p>
          )}
          <Button size="sm" icon={<Plus size={15} />} disabled={draft.env.length >= 50} onClick={() => onChange({ ...draft, env: [...draft.env, { name: "", value: "" }] })}>
            Add variable
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Settings: the window every instance gets ---------------- */

/* Settings' game window: saved a moment after each change that makes sense. */
export function GameWindowSettings({ settings, onSave }: { settings: LauncherSettings; onSave: (patch: Partial<LauncherSettings>) => void }) {
  const [draft, setDraft] = useState(() => ({
    width: settings.windowWidth ? String(settings.windowWidth) : "",
    height: settings.windowHeight ? String(settings.windowHeight) : "",
    fullscreen: Boolean(settings.fullscreen),
  }));
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (next: typeof draft) => {
    setDraft(next);
    window.clearTimeout(timer.current);
    const wrong = windowSizeError(next.width, next.height);
    if (wrong && !next.fullscreen) return;
    const sized = Boolean(next.width.trim()) && !wrong;
    timer.current = window.setTimeout(
      () => onSave({ windowWidth: sized ? Number(next.width) : null, windowHeight: sized ? Number(next.height) : null, fullscreen: next.fullscreen }),
      500
    );
  };

  return <WindowFields width={draft.width} height={draft.height} fullscreen={draft.fullscreen} onChange={change} />;
}
