import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Gamepad2, Plus, RefreshCw, UserRound } from "lucide-react";
import Monogram from "./ui/Monogram";
import Select from "./ui/Select";
import Button from "./ui/Button";
import PlatformAccountAction from "./PlatformAccountAction";
import OfflineAccountForm from "./OfflineAccountForm";
import ElyAccountForm from "./ElyAccountForm";
import { ACCOUNTS_EVENT, watchAccountChanges } from "./ui/accountsSignal";
import "./accountSwitcher.css";

type Props = {
  /** Smaller, for the sidebar. */
  compact?: boolean;
  /** Only the picture (the folded sidebar): the list opens from it. */
  rail?: boolean;
  /**
   * The game being viewed. Minecraft (or none) shows the Microsoft accounts; another game
   * shows how it signs in instead (the Steam app's player, or the app that handles it).
   */
  game?: GameId | "minecraft" | null;
};

const ADD = "__add__";
const OFFLINE = "__offline__";
const ELY = "__ely__";

/* What kind of account it is, in the line under its name. */
const kindOf = (account?: MinecraftAccount) =>
  account?.offline ? "Offline test account" : account?.service === "ely.by" ? "Ely.by account" : "Microsoft account";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Who the game launches as, and switching between signed-in Microsoft accounts, or
 * adding another (Microsoft asks which account to use).
 */
/*
 * A game that signs in through the app it came from: the Steam app's player, or a plain
 * line saying where sign-in happens. Never asks for a password.
 */
function StoreAccount({ game, compact, rail }: { game: GameId; compact: boolean; rail: boolean }) {
  const [account, setAccount] = useState<{ game: GameId; info: GameStoreAccount } | null>(null);

  const [refreshCount, setRefreshCount] = useState(0);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let request = 0;
    const look = async () => {
      const current = ++request;
      setChecking(true);
      setError(null);
      try {
        const info = await window.gamesAPI.account(game);
        if (live && current === request) setAccount({ game, info });
      } catch (err) {
        if (live && current === request) setError(message(err));
      } finally {
        if (live && current === request) setChecking(false);
      }
    };
    void look();
    window.addEventListener("focus", look);
    return () => { live = false; window.removeEventListener("focus", look); };
  }, [game, refreshCount]);

  const info = account?.game === game ? account.info : null;
  const who = info?.name ?? (info?.store === "steam" ? "No local profile found" : info?.storeName ?? "");
  const label = info?.storeName ? (info.store === "steam" ? "Last-used Steam profile" : `Signs in with the ${info.storeName}`) : "Sign-in";
  const status = info?.storeName ? (info.store === "steam" ? "Steam profile" : info.name ? info.storeName : "Sign-in app") : checking ? "Checking…" : "Sign-in";
  const avatar = <Monogram name={info?.name ?? info?.storeName ?? ""} icon={info?.name ? undefined : <Gamepad2 size={16} />} size={rail ? 32 : 28} />;
  const refreshLabel = error ? "Retry account check" : "Refresh account";
  const refresh = () => setRefreshCount((value) => value + 1);

  const details = (
    <>
      <div className="ui-account__menu-head">
        <strong className="ui-account__name">{who || (checking ? "Checking…" : "Couldn’t check")}</strong>
        <span className="ui-account__label">{label}</span>
      </div>
      {checking && <div className="ui-account__note" role="status">Checking account information…</div>}
      {info && <div className="ui-account__note">{info.how}</div>}
      {game === "sims4" && info?.store === "steam" && <p className="ui-account__note">The Sims 4 also uses your linked EA account.</p>}
      {info?.store && <PlatformAccountAction key={`${game}:${info.store}`} provider={info.store} />}
      {error && <div role="alert" className="ui-account__error">Couldn’t check the account: {error}</div>}
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden="true" className={checking ? "is-spinning" : undefined} />} disabled={checking} onClick={refresh}>{refreshLabel}</Button>
    </>
  );

  if (!compact && !rail) {
    return (
      <div data-testid="account-switcher" className="ui-account" data-store={info?.store ?? "none"}>
        <div className="ui-account__row">{who && <strong className="ui-account__name">{who}</strong>}</div>
        {details}
      </div>
    );
  }

  return (
    <AccountMenu
      store={info?.store ?? "none"}
      rail={rail}
      avatar={avatar}
      name={who || (checking ? "Checking…" : "Couldn’t check")}
      status={status}
      tip={`${status}: ${who || "no profile"}`}
    >
      {details}
    </AccountMenu>
  );
}

/*
 * The one account pattern for the sidebar: a card (picture, name, one short line, chevron) or,
 * folded, a round picture. Either opens a small panel with the explanation and the actions.
 */
function AccountMenu({ store, rail, avatar, name, status, tip, children, onOpen }: {
  store: string;
  rail: boolean;
  avatar: ReactNode;
  name: string;
  status: string;
  tip: string;
  /** The panel's content, or a function given a way to close the panel (after a choice). */
  children: ReactNode | ((close: () => void) => ReactNode);
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const triggerId = useId();

  const toggle = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) {
      const bottom = Math.max(8, window.innerHeight - box.bottom);
      // Grows upwards from the trigger's foot, never past the window's top.
      setPos({ left: Math.min(box.right + 8, window.innerWidth - 264), bottom, maxHeight: window.innerHeight - bottom - 8 });
    }
    if (!open) onOpen?.();
    setOpen(!open);
  };
  // Found by id, not the ref: the panel's content calls this while it renders its buttons.
  const close = () => {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div data-testid="account-switcher" className={`ui-account ui-account--menu${rail ? " ui-account--rail" : ""}`} data-store={store}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className="ui-account__trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Account: ${name}, ${status}`}
        data-tip={rail && !open ? tip : undefined}
        data-tip-side={rail && !open ? "right" : undefined}
        onClick={toggle}
      >
        {avatar}
        {!rail && (
          <>
            <span className="ui-account__text">
              <strong className="ui-account__name">{name}</strong>
              <span className="ui-account__label">{status}</span>
            </span>
            <ChevronsUpDown className="ui-account__chevron" size={14} aria-hidden="true" />
          </>
        )}
      </button>
      {/* On the page itself, so the sidebar's layer can't put it under a drawer's dimming. */}
      {open &&
        createPortal(
          <div ref={panel} id={panelId} role="dialog" aria-label="Account" className="ui-account__panel" style={pos ?? undefined}>
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body
        )}
    </div>
  );
}

export default function AccountSwitcher({ compact = false, rail = false, game }: Props) {
  if (game && game !== "minecraft") return <StoreAccount game={game} compact={compact} rail={rail} />;
  return <MicrosoftAccounts compact={compact} rail={rail} />;
}

/* Minecraft's Microsoft accounts: who the game launches as, and switching or adding one. */
function MicrosoftAccounts({ compact, rail }: { compact: boolean; rail: boolean }) {
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<"signin" | "switch" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"offline" | "ely" | null>(null);
  const selectId = useId();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setLoading(true);
      try {
        const next = await window.instanceAPI.listAccounts();
        if (live && current === request) { setAccounts(next); setLoadError(null); }
      } catch (err) {
        if (live && current === request) setLoadError(message(err));
      } finally {
        if (live && current === request) setLoading(false);
      }
    };
    void refresh();
    watchAccountChanges();
    window.addEventListener(ACCOUNTS_EVENT, refresh);
    window.addEventListener("focus", refresh);
    const stop = typeof window.instanceAPI.onAccountsChanged === "function" ? window.instanceAPI.onAccountsChanged(() => { void refresh(); }) : undefined;
    return () => {
      live = false;
      window.removeEventListener(ACCOUNTS_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      if (typeof stop === "function") stop();
    };
  }, [refreshCount]);

  const active = accounts.find((account) => account.active);

  /* Acts on a choice from the list; true once it's done (to close the panel). */
  async function choose(value: string): Promise<boolean> {
    if (value === OFFLINE || value === ELY) {
      setAdding(value === OFFLINE ? "offline" : "ely");
      setStatus(null);
      setError(null);
      return false;
    }
    setAdding(null);
    setBusy(true);
    setOperation(value === ADD ? "signin" : "switch");
    setStatus(null);
    setError(null);
    let done = false;
    try {
      if (value === ADD) {
        await window.launcherAPI.loginMicrosoft();
        const next = await window.instanceAPI.listAccounts();
        setAccounts(next);
        setStatus(`Signed in as ${next.find((entry) => entry.active)?.name ?? "your Microsoft account"}.`);
      } else {
        const next = await window.instanceAPI.switchAccount(value);
        setAccounts(next);
        setStatus(`Minecraft will launch as ${next.find((entry) => entry.active)?.name ?? "the selected account"}.`);
      }
      done = true;
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
    return done;
  }

  const placeholder = loading ? "Checking accounts…" : loadError ? "Account check unavailable" : busy ? "Signing in..." : "Not signed in";
  const options = (
    <>
      {!active && <option value="">{placeholder}</option>}
      {accounts.map((account) => (
        <option key={account.uuid} value={account.uuid}>
          {account.offline ? `${account.name} (offline)` : account.service === "ely.by" ? `${account.name} (Ely.by)` : account.name}
        </option>
      ))}
      <option value={ADD}>{accounts.length ? "Add a Microsoft account..." : "Sign in with Microsoft..."}</option>
      <option value={ELY}>Add an Ely.by account...</option>
      <option value={OFFLINE}>Add an offline test account...</option>
    </>
  );
  const kind = kindOf(active);
  const avatar = <Monogram name={active?.name ?? ""} icon={active ? undefined : <UserRound size={16} />} size={rail ? 32 : 28} />;

  const signedOut = !active && !loading && !loadError && accounts.length === 0;

  // Signed out: a calm card (neutral avatar, "Not signed in", a small Sign in button), or,
  // folded, a neutral round avatar button. Both start the Microsoft sign-in directly.
  if (signedOut && (rail || compact)) {
    return (
      <div data-testid="account-switcher" className={`ui-account${rail ? " ui-account--rail" : " ui-account--card"}`}>
        {rail ? (
          <button
            type="button"
            className="ui-account__trigger ui-account__signin"
            disabled={busy}
            aria-label="Sign in with Microsoft"
            data-tip="Not signed in. Sign in with Microsoft"
            data-tip-side="right"
            onClick={() => choose(ADD)}
          >
            {avatar}
          </button>
        ) : (
          <div className="ui-account__quiet">
            {avatar}
            <span className="ui-account__text">
              <strong className="ui-account__name">{busy ? "Signing in…" : "Not signed in"}</strong>
            </span>
            <Button size="sm" variant="secondary" className="ui-account__signin" disabled={busy} aria-label="Sign in with Microsoft" onClick={() => choose(ADD)}>
              Sign in
            </Button>
          </div>
        )}
        {!rail && (busy || status || error) && (
          <>
            {busy && <div className="ui-account__note" role="status">Finish signing in in your browser.</div>}
            {error && <div role="alert" className="ui-account__error">{error}</div>}
          </>
        )}
      </div>
    );
  }

  const finish = (next: MinecraftAccount[], text: string, after?: () => void) => {
    setAccounts(next);
    setAdding(null);
    setStatus(text);
    after?.();
  };
  const forms = (after?: () => void) => (
    <>
      {adding === "offline" && (
        <OfflineAccountForm onCancel={() => setAdding(null)} onDone={(next, name) => finish(next, `Minecraft will launch as ${name}, offline.`, after)} />
      )}
      {adding === "ely" && (
        <ElyAccountForm onCancel={() => setAdding(null)} onDone={(next, name) => finish(next, `Minecraft will launch as ${name}, with Ely.by.`, after)} />
      )}
    </>
  );
  const messages = (
    <>
      {busy && <div className="ui-account__note" role="status">{operation === "signin" ? "Finish signing in in your browser." : "Switching Minecraft account…"}</div>}
      {!busy && status && <div className="ui-account__note" role="status">{status}</div>}
      {loadError && <div role="alert" className="ui-account__error">Couldn’t load Minecraft accounts: {loadError}<Button size="sm" variant="ghost" disabled={loading} onClick={() => setRefreshCount((value) => value + 1)}>Retry account check</Button></div>}
      {error && (
        <div role="alert" className="ui-account__error">
          {error}
        </div>
      )}
    </>
  );
  const notes = (
    <>
      {forms()}
      {messages}
    </>
  );

  // The sidebar: a card showing who's playing or, folded, the picture. Either opens a panel
  // listing the accounts (a click switches) and the ways to add one.
  if (compact || rail) {
    const thenClose = (close: () => void) => (done: boolean) => { if (done) close(); };
    const menu = (close: () => void) => (
      <>
        {accounts.length > 0 && (
          <>
            <ul className="ui-account__list" aria-label="Minecraft accounts">
              {accounts.map((account) => (
                <li key={account.uuid}>
                  <button
                    type="button"
                    className="ui-menu__item ui-account__item"
                    aria-current={account.active ? "true" : undefined}
                    disabled={busy}
                    onClick={() => (account.active ? close() : void choose(account.uuid).then(thenClose(close)))}
                  >
                    <Monogram name={account.name} size={24} />
                    <span className="ui-account__text">
                      <strong className="ui-account__name">{account.name}</strong>
                      <span className="ui-account__label">{kindOf(account)}</span>
                    </span>
                    {account.active && <Check className="ui-account__check" size={14} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="ui-menu__sep" role="separator" />
          </>
        )}
        {adding ? (
          forms(close)
        ) : (
          <div className="ui-account__adds">
            <button type="button" className="ui-menu__item" disabled={busy} onClick={() => void choose(ADD).then(thenClose(close))}>
              <span className="ui-menu__icon"><Plus size={14} aria-hidden="true" /></span>
              {accounts.length ? "Add a Microsoft account" : "Sign in with Microsoft"}
            </button>
            <button type="button" className="ui-menu__item" disabled={busy} onClick={() => void choose(ELY)}>
              <span className="ui-menu__icon"><Plus size={14} aria-hidden="true" /></span>
              Add an Ely.by account
            </button>
            <button type="button" className="ui-menu__item" disabled={busy} onClick={() => void choose(OFFLINE)}>
              <span className="ui-menu__icon"><Plus size={14} aria-hidden="true" /></span>
              Add an offline test account
            </button>
          </div>
        )}
        {messages}
      </>
    );
    return (
      <AccountMenu
        store="minecraft"
        rail={rail}
        avatar={avatar}
        name={active?.name ?? placeholder}
        status={busy ? (operation === "signin" ? "Signing in…" : "Switching…") : loadError ? "Account check unavailable" : kind}
        tip={active ? `Playing as ${active.name}` : "Not signed in"}
        onOpen={() => {
          setAdding(null);
          setStatus(null);
          setError(null);
        }}
      >
        {menu}
      </AccountMenu>
    );
  }

  return (
    <div data-testid="account-switcher" className="ui-account">
      <div className="ui-account__row">
        <Select
          id={selectId}
          aria-label="Minecraft account"
          wrapperClassName="ui-account__select"
          style={{ width: "100%" }}
          value={active?.uuid ?? ""}
          disabled={busy || loading}
          onChange={(e) => choose(e.target.value)}
        >
          {options}
        </Select>
      </div>
      {notes}
    </div>
  );
}
