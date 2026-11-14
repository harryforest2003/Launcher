import { useState, type ReactNode } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import "../theme/appearance.css";

type Props = {
  name: ApiKeyName;
  label: string;
  environmentVariable: string;
  status: ApiKeyStatus | undefined;
  /** What the key adds, and where to get one. */
  children: ReactNode;
  onChange: (statuses: ApiKeyStatuses) => void;
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * One service's key or token, as a settings row: what it is for on the left, the key on the
 * right. The launcher checks it with the service before saving it, and from then on shows it
 * masked, with Edit to replace or remove it.
 */
export default function ApiKeyRow({ name, label, environmentVariable, status, children, onChange }: Props) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const showBox = !status?.fromEnvironment && (!status?.set || editing);
  const inputId = `api-key-${name}-input`;
  const helpId = `api-key-${name}-help`;

  async function change(next: string | null) {
    setBusy(true);
    setError(null);
    setSaved(null);

    try {
      onChange(await window.instanceAPI.setApiKey(name, next));
      setValue("");
      setEditing(false);
      setSaved(next ? `${label} accepted it, so it's saved.` : "Removed.");
    } catch (err) {
      setError(message(err));
    }

    setBusy(false);
  }

  return (
    <div className="set-row" data-testid={`api-key-${name}`}>
      <div>
        <h3 className="set-row-name">
          {label}
          <Badge
            data-testid="api-key-state"
            tone={status?.fromEnvironment ? "info" : status?.set ? "success" : "neutral"}
          >
            {status?.fromEnvironment ? "From environment" : status?.set ? "Working" : "Not added"}
          </Badge>
        </h3>
        <p id={helpId} className="set-help">
          {children}
        </p>
      </div>

      <div className="set-row-controls">
        {status?.fromEnvironment && (
          <p className="set-help">Set by the {environmentVariable} environment variable, so it's changed there.</p>
        )}

        {!status?.fromEnvironment && status?.set && !editing && (
          <div className="set-form">
            <code data-testid="api-key-hint" className="set-value-box" aria-label={`Saved ${label} key`}>
              {status.hint ?? "Saved"}
            </code>
            <Button
              onClick={() => {
                setEditing(true);
                setSaved(null);
                setError(null);
              }}
            >
              Edit
            </Button>
          </div>
        )}

        {showBox && (
          <form
            className="set-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim() && !busy) change(value);
            }}
          >
            <label htmlFor={inputId} className="u-visually-hidden">
              {label} key
            </label>
            <input
              id={inputId}
              type="password"
              className="ui-input ui-input--mono set-key"
              aria-describedby={helpId}
              autoComplete="off"
              autoFocus={editing}
              value={value}
              placeholder={status?.set ? "Paste a new one to replace it" : `Paste your ${label} key`}
              onChange={(event) => setValue(event.target.value)}
            />

            <Button type="submit" disabled={busy || !value.trim()}>
              {busy ? "Checking..." : "Save"}
            </Button>

            {status?.set && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setValue("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => change(null)}>
                  Remove
                </Button>
              </>
            )}
          </form>
        )}

        {error && (
          <p role="alert" className="set-message set-message--danger">
            <CircleX size={14} aria-hidden="true" />
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="set-message set-message--success">
            <CircleCheck size={14} aria-hidden="true" />
            {saved}
          </p>
        )}
      </div>
    </div>
  );
}
