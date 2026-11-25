import { useState, type FormEvent } from "react";
import Field from "./ui/Field";
import Button from "./ui/Button";
import "./offlineAccount.css";

const NEEDS_CODE = /^ELY_NEEDS_CODE:?\s*/;

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * Signing in with an Ely.by account: its login and password, sent once to Ely.by for a
 * sign-in token (the password isn't kept), plus the code from an authenticator app when the
 * account asks for one. The account becomes the one in use.
 */
export default function ElyAccountForm({ onDone, onCancel }: { onDone: (accounts: MinecraftAccount[], name: string) => void; onCancel: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const accounts = await window.instanceAPI.elySignIn(login, password, askCode ? code : undefined);
      setPassword("");
      onDone(accounts, accounts.find((account) => account.active)?.name ?? login.trim());
    } catch (err) {
      const said = message(err);
      if (NEEDS_CODE.test(said)) {
        setAskCode(true);
        setError(askCode ? "That code didn't work. Enter the newest one from your authenticator app." : null);
      } else {
        setError(said);
      }
      setBusy(false);
    }
  }

  const ready = login.trim() && password && (!askCode || code.replace(/\s/g, "").length >= 6);

  return (
    <form className="offline-account" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
      <Field
        label="Ely.by login"
        hint="Player name or email."
        value={login}
        autoFocus
        autoComplete="username"
        spellCheck={false}
        disabled={busy}
        onChange={(event) => setLogin(event.target.value)}
      />
      <Field
        label="Password"
        type="password"
        hint="Sent only to Ely.by. The launcher keeps a sign-in token, never the password."
        error={askCode ? undefined : error ?? undefined}
        value={password}
        autoComplete="current-password"
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
      />
      {askCode && (
        <Field
          autoFocus
          label="Authenticator code"
          hint="This account uses two-step sign-in."
          error={error ?? undefined}
          value={code}
          mono
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
        />
      )}
      <div className="offline-account__actions">
        <Button size="sm" variant="primary" type="submit" disabled={busy || !ready}>{busy ? "Signing in…" : "Sign in"}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
