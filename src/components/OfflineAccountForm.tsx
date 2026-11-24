import { useState, type FormEvent } from "react";
import Field from "./ui/Field";
import Button from "./ui/Button";
import "./offlineAccount.css";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * A player name for a test account without Microsoft. It plays single-player and
 * offline-mode servers, with the default skin, and becomes the account in use.
 */
export default function OfflineAccountForm({ onDone, onCancel }: { onDone: (accounts: MinecraftAccount[], name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const accounts = await window.instanceAPI.addOfflineAccount(name);
      onDone(accounts, name.trim());
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form className="offline-account" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
      <Field
        label="Offline player name"
        hint="For testing: single-player and offline servers only, with the default skin."
        error={error ?? undefined}
        value={name}
        maxLength={16}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="Tester_1"
        onChange={(event) => setName(event.target.value)}
      />
      <div className="offline-account__actions">
        <Button size="sm" variant="primary" type="submit" disabled={busy || !name.trim()}>Add</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
