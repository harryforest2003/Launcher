import { useState } from "react";
import { Button } from "./ui";

import { PLATFORMS } from "./platformAccountsData";

export default function PlatformAccountAction({ provider }: { provider: NonNullable<GameStoreAccount["store"]> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const name = PLATFORMS.find((item) => item.id === provider)?.name ?? provider;
  async function open() {
    setBusy(true); setError(null); setOpened(false);
    try {
      if (!window.gamesAPI.openAccount) throw new Error("Restart the updated desktop launcher to use account links.");
      await window.gamesAPI.openAccount(provider);
      setOpened(true);
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally { setBusy(false); }
  }
  return <div className="ui-account__action" aria-busy={busy}>
    <Button size="sm" disabled={busy} onClick={open}>
      {busy ? "Opening…" : error ? `Retry opening ${name}` : provider === "steam" ? "Open Steam to sign in / switch" : `Sign in on ${name} website`}
    </Button>
    {opened && <p className="ui-account__note" role="status">{provider === "steam" ? "Steam open request sent. Finish sign-in or switching in Steam, then refresh your profile here." : "Account page open request sent. Game sign-in is managed separately in the platform’s launcher."}</p>}
    {error && <p className="ui-account__error" role="alert">{error}</p>}
  </div>;
}
