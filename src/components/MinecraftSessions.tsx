import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, UserPlus } from "lucide-react";
import { Button, Notice, Select, toast } from "./ui";
import { useAccountChoice } from "./playAsChoice";
import "./playAs.css";

/*
 * The bottom of the "Playing as" card on Minecraft home: the other instances open right now
 * (each on its own account), and, unfolded, the way to start one more on another account.
 * The toggle sits at the card's foot, so it stays in place while the controls unfold above it.
 */
export default function MinecraftSessions({ instances, onRefresh, onLibrary }: {
  instances: Instance[]; onRefresh: () => Promise<unknown>; onLibrary: () => void;
}) {
  const choice = useAccountChoice();
  const [instanceName, setInstanceName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [pending, setPending] = useState<Record<string, string>>({});
  const reservations = useRef(new Map<string, string>());
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const controlsId = useId();
  const failureRef = useRef<HTMLDivElement>(null);
  // The controls scroll inside the card when tight, so a new problem is brought into view.
  useEffect(() => { if (failure) failureRef.current?.scrollIntoView({ block: "nearest" }); }, [failure]);
  const isOpen = (name: string) => Object.hasOwn(choice.playing, name) || Boolean(pending[name]);
  const available = instances.filter((instance) => !instance.running && !isOpen(instance.name));
  const selectedInstance = available.find((instance) => instance.name === instanceName) ?? available[0];
  const accountBusy = (id: string) => choice.busyIn(id) || Object.entries(pending).find(([, player]) => player === id)?.[0];
  const selectedAccount = choice.accounts.find((account) => account.uuid === accountId && !accountBusy(account.uuid))
    ?? choice.accounts.find((account) => !accountBusy(account.uuid));
  const sessions = [...new Set([...Object.keys(choice.playing), ...Object.keys(pending)])];

  async function start() {
    if (!selectedInstance || !selectedAccount || choice.unavailable) return;
    const name = selectedInstance.name;
    const id = selectedAccount.uuid;
    if (reservations.current.has(name) || [...reservations.current.values()].includes(id)) return;
    reservations.current.set(name, id);
    setPending(Object.fromEntries(reservations.current));
    setFailure(null);
    try {
      await window.instanceAPI.launch(name, id);
      // A toast, not a notice: the card has no room to spare for a success message.
      toast({ tone: "success", title: `${name} started as ${selectedAccount.name}`, body: "Other running instances keep their accounts." });
      setOpen(false);
    } catch (error) {
      setFailure((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      // Keep this account reserved locally until the backend session map has refreshed.
      await choice.refresh();
      reservations.current.delete(name);
      setPending(Object.fromEntries(reservations.current));
      void onRefresh();
    }
  }

  async function addAccount() {
    setAdding(true); setFailure(null);
    try {
      await window.launcherAPI.loginMicrosoft();
      await choice.refresh();
      toast({ tone: "success", title: "Account added", body: "Choose it under Play as to launch a separate instance." });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally { setAdding(false); }
  }

  return <div className="mc-sessions">
    {sessions.length > 0 && <ul className="mc-sessions__list" aria-label="Minecraft sessions">
      {sessions.map((name) => <li key={name}>
        <strong>{name}</strong>
        <span>{choice.playing[name]?.name ?? choice.accounts.find((account) => account.uuid === pending[name])?.name ?? "Offline player"}</span>
        <span>{pending[name] || !instances.find((instance) => instance.name === name)?.running ? "Starting…" : "Running"}</span>
      </li>)}
    </ul>}
    {open && <div id={controlsId} className="mc-sessions__panel">
      {!choice.loaded ? <p role="status" className="mc-sessions__hint">Checking accounts and sessions…</p> : choice.unavailable ?
        <Notice tone="warning" actions={<Button size="sm" onClick={() => void choice.refresh()}>Retry</Button>}>Accounts or running sessions could not be checked. Retry before starting another instance.</Notice> :
        <div className="mc-sessions__controls">
          <label>Instance<Select size="sm" aria-label="Instance to launch" value={selectedInstance?.name ?? ""} onChange={(event) => setInstanceName(event.target.value)}>
            {!available.length && <option value="">No idle instances</option>}
            {available.map((instance) => <option key={instance.name} value={instance.name}>{instance.name}</option>)}
          </Select></label>
          <label>Play as<Select size="sm" aria-label="Account for this instance" value={selectedAccount?.uuid ?? ""} onChange={(event) => setAccountId(event.target.value)}>
            {!selectedAccount && <option value="">{choice.accounts.length ? "All accounts are in use" : "Add a Microsoft account"}</option>}
            {choice.accounts.map((account) => <option key={account.uuid} value={account.uuid} disabled={Boolean(accountBusy(account.uuid))}>{account.name}{accountBusy(account.uuid) ? ` · in use by ${accountBusy(account.uuid)}` : ""}</option>)}
          </Select></label>
          <Button size="sm" variant="primary" className="mc-sessions__launch" disabled={!selectedInstance || !selectedAccount} onClick={start}>Launch instance</Button>
        </div>}
      <div className="mc-sessions__more">
        <Button size="sm" variant="ghost" icon={<UserPlus size={14} aria-hidden="true" />} disabled={adding} onClick={addAccount}>
          {adding ? "Finish in your browser…" : "Add account"}
        </Button>
        <Button size="sm" variant="ghost" icon={<Copy size={14} aria-hidden="true" />} title="Copy an instance in Library to run one setup on two accounts" onClick={onLibrary}>
          Copy in Library
        </Button>
      </div>
      {failure && <div ref={failureRef}><Notice tone="danger">{failure}</Notice></div>}
    </div>}
    <Button
      size="sm"
      variant="ghost"
      className="mc-sessions__toggle"
      aria-expanded={open}
      aria-controls={open ? controlsId : undefined}
      icon={open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      onClick={() => setOpen((now) => !now)}
    >
      Play on another account
    </Button>
  </div>;
}
