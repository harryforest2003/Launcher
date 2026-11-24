import { useEffect, useRef, useState } from "react";
import { ExternalLink, MessageCircle, PlugZap } from "lucide-react";
import { Button, Field, Segmented } from "./ui";

/*
 * Settings' Discord status: on or off, the Discord application it shows as, and a test.
 * The status itself is shown by the main process while a game started here is open:
 * a Minecraft instance or any other game.
 */

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const ID = /^\d{17,20}$/;

export function DiscordStatusSettings({ settings, onSave }: { settings: LauncherSettings; onSave: (patch: Partial<LauncherSettings>) => void }) {
  const [id, setId] = useState(settings.discordClientId ?? "");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, setState] = useState<{ showing: boolean; playing: boolean; error: string | null } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    window.instanceAPI
      .discordState?.()
      .then(setState)
      .catch(() => {});
  }, [settings.discordStatus, settings.discordClientId]);

  const trimmed = id.trim();
  const idError = trimmed && !ID.test(trimmed) ? "An application ID is a number 17 to 20 digits long." : undefined;

  const changeId = (value: string) => {
    setId(value);
    setResult(null);
    window.clearTimeout(timer.current);
    const next = value.trim();
    if (next && !ID.test(next)) return;
    timer.current = window.setTimeout(() => onSave({ discordClientId: next }), 600);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const found = await window.instanceAPI.testDiscord(trimmed);
      setResult({
        ok: true,
        text: `It works${found.user ? `: Discord is signed in as ${found.user}` : ""}. ${
          settings.discordStatus ? "Your status shows while a game is open." : "Switch it on above to show your games."
        }`,
      });
    } catch (err) {
      setResult({ ok: false, text: message(err) });
    } finally {
      setTesting(false);
    }
  };

  const on = Boolean(settings.discordStatus);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="discord-status">
      <Segmented
        label="Discord status"
        value={on ? "on" : "off"}
        onChange={(value) => onSave({ discordStatus: value === "on" })}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />

      <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, color: "var(--color-text-secondary)", fontSize: 13 }}>
        <li>
          Make an application on Discord's developer site. Its name is what shows after "Playing", so naming it Unity Launcher reads "Playing Unity Launcher".{" "}
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink size={14} aria-hidden="true" />}
            onClick={() => void window.modAPI.openUrl("https://discord.com/developers/applications").catch(() => {})}
          >
            Open the developer site
          </Button>
        </li>
        <li>Copy the Application ID from its General Information page and paste it below.</li>
        <li>Keep the Discord app open while you play, with Activity Privacy's "Share your detected activities" on.</li>
      </ol>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field
          label="Application ID"
          mono
          inputMode="numeric"
          placeholder="e.g. 1234567890123456789"
          value={id}
          error={idError}
          onChange={(e) => changeId(e.target.value)}
          style={{ width: 260 }}
        />
        <Button size="sm" icon={<PlugZap size={15} aria-hidden="true" />} disabled={!ID.test(trimmed) || testing} onClick={() => void test()}>
          {testing ? "Testing…" : "Test"}
        </Button>
      </div>

      {result && (
        <p role="status" className={`set-message ${result.ok ? "set-message--muted" : "set-message--warning"}`} data-testid="discord-test-result">
          {result.text}
        </p>
      )}
      {!result && on && state?.playing && (
        <p role="status" className={`set-message ${state.showing ? "set-message--muted" : "set-message--warning"}`}>
          {state.showing ? "Your game is showing on Discord now." : (state.error ?? "Your game isn't showing on Discord yet.")}
        </p>
      )}
      {on && !trimmed && <p className="set-message set-message--warning">Paste an application ID to show your games.</p>}
      <p className="set-message set-message--muted">
        Under that, your profile shows the game, how many mods it has (for Minecraft, the instance with its version and loader), and how long you've played. Nothing is
        sent anywhere but the Discord app on this computer.
      </p>
    </div>
  );
}

/* The whole Settings section, loading and saving the launcher's settings itself. */
export function DiscordStatusSection() {
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.instanceAPI
      .getSettings()
      .then((loaded) => live && setSettings(loaded))
      .catch((err) => live && setError(message(err)));
    return () => {
      live = false;
    };
  }, []);

  const save = (patch: Partial<LauncherSettings>) => {
    setSettings((now) => (now ? { ...now, ...patch } : now));
    setError(null);
    window.instanceAPI
      .setSettings(patch)
      .then(setSettings)
      .catch((err) => setError(message(err)));
  };

  return (
    <section id="discord-status" aria-labelledby="discord-status-title" className="ui-panel set-panel">
      <div className="set-section">
        <div className="set-panel-head">
          <div>
            <h2 id="discord-status-title" className="set-panel-title">
              <MessageCircle size={18} aria-hidden="true" />
              Discord status
            </h2>
            <p className="set-lead">
              Shows the game you're playing on your Discord profile while it's open: Minecraft, GTA V, The Sims 4 or any other game you start from the launcher.
            </p>
          </div>
        </div>
        {error && <p className="set-message set-message--warning">{error}</p>}
        {settings ? <DiscordStatusSettings settings={settings} onSave={save} /> : !error && <p className="set-message set-message--muted">Loading…</p>}
      </div>
    </section>
  );
}
