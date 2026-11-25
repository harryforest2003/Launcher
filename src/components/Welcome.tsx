import { useEffect, useState } from "react";
import { CircleCheck, Gamepad2, KeyRound, Palette, UserRound } from "lucide-react";
import { Badge, Button, Modal } from "./ui";
import GameCover from "./ui/GameCover";
import AccountSwitcher from "./AccountSwitcher";
import ModSiteList from "./ModSiteList";
import AppearanceSettings from "../theme/AppearanceSettings";
import { WELCOME_EVENT, WELCOMED_KEY, isFirstRun } from "./welcomeState";
import "./welcome.css";

/*
 * The first time the launcher opens: what it found on this computer, the Minecraft account,
 * the mod sites' keys and light or dark. Every step can be skipped, and it's never shown
 * again once closed (Settings → About & updates can show it again).
 */

const STEPS = [
  { key: "games", label: "Your games", icon: Gamepad2 },
  { key: "account", label: "Minecraft", icon: UserRound },
  { key: "keys", label: "Mod sites", icon: KeyRound },
  { key: "look", label: "Look", icon: Palette },
] as const;

function Games() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    window.gamesAPI
      ?.list()
      .then((list) => live && setGames(list))
      .catch(() => live && setGames([]));
    return () => {
      live = false;
    };
  }, []);
  const found = (games ?? []).filter((g) => g.found);
  return (
    <div className="welcome-step" data-testid="welcome-games">
      <p className="welcome-step__lead">
        {games === null
          ? "Looking for games on this computer…"
          : found.length
            ? `Found ${found.length + 1} games on this computer, Minecraft included. Each has its own section in the sidebar for playing, mods and saves.`
            : "Minecraft is ready. No other supported games were found; if one is installed somewhere unusual, choose its folder from its page in the sidebar."}
      </p>
      <ul className="welcome-games">
        <li className="welcome-game">
          <span className="welcome-game__art">
            <GameCover name="Minecraft" variant="thumb" colour="hsl(110 45% 38%)" />
          </span>
          <span className="welcome-game__name">Minecraft</span>
          <Badge tone="success">Ready</Badge>
        </li>
        {found.map((game) => (
          <li key={game.id} className="welcome-game">
            <span className="welcome-game__art">
              <GameCover name={game.name} variant="thumb" colour={game.colour} />
            </span>
            <span className="welcome-game__name">{game.name}</span>
            <Badge tone={game.cantRun ? "warning" : "success"}>{game.cantRun ? "Mods only" : "Found"}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Account() {
  return (
    <div className="welcome-step" data-testid="welcome-account">
      <p className="welcome-step__lead">
        Sign in with the Microsoft account that owns Minecraft to play online. You can add more accounts, an Ely.by account or an offline name later from the "Playing as" card.
      </p>
      <AccountSwitcher game="minecraft" />
    </div>
  );
}

function Keys() {
  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof window.instanceAPI.getApiKeys>> | null>(null);
  useEffect(() => {
    window.instanceAPI
      ?.getApiKeys()
      .then(setApiKeys)
      .catch(() => {});
  }, []);
  return (
    <div className="welcome-step" data-testid="welcome-keys">
      <p className="welcome-step__lead">
        Modrinth and CurseForge work straight away. Some sites (Nexus Mods, mod.io, the Steam Workshop) need a free key before the launcher can search or download from them. Each has a guide below; you can add them later in Settings → Mod sites.
      </p>
      <div className="welcome-keys">
        <ModSiteList apiKeys={apiKeys} onChange={setApiKeys} />
      </div>
    </div>
  );
}

function Look() {
  return (
    <div className="welcome-step" data-testid="welcome-look">
      <p className="welcome-step__lead">Light or dark, and the accent colour. More (text size, colour-blind modes, reduced motion) is in Settings → Appearance.</p>
      <AppearanceSettings part="base" />
      <AppearanceSettings part="colour" />
    </div>
  );
}

export default function Welcome() {
  const [open, setOpen] = useState(isFirstRun);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const again = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(WELCOME_EVENT, again);
    return () => window.removeEventListener(WELCOME_EVENT, again);
  }, []);

  const close = () => {
    try {
      localStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      // Shown again next time, at worst.
    }
    setOpen(false);
  };
  const last = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Welcome to Unity Launcher"
      lead="Four quick things to set up. Skip any of them; they're all in Settings later."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Skip setup
          </Button>
          <span className="welcome-foot__gap" />
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button variant="primary" icon={last ? <CircleCheck size={14} aria-hidden="true" /> : undefined} onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </>
      }
    >
      <ol className="welcome-steps" aria-label="Setup steps">
        {STEPS.map(({ key, label, icon: Icon }, i) => (
          <li key={key}>
            <button type="button" className="welcome-steps__item" aria-current={i === step ? "step" : undefined} data-done={i < step || undefined} onClick={() => setStep(i)}>
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ol>
      {STEPS[step].key === "games" && <Games />}
      {STEPS[step].key === "account" && <Account />}
      {STEPS[step].key === "keys" && <Keys />}
      {STEPS[step].key === "look" && <Look />}
    </Modal>
  );
}
