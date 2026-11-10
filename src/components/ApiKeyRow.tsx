import { useState } from "react";

type Props = {
  name: ApiKeyName;
  label: string;
  environmentVariable: string;
  status: ApiKeyStatus | undefined;
  children: React.ReactNode;
  onChange: (statuses: ApiKeyStatuses) => void;
};

const boxStyle: React.CSSProperties = {
  flex: "1 1 240px",
  minWidth: 0,
  padding: 10,
  borderRadius: 10,
  background: "#1b1b1b",
  color: "white",
  border: "1px solid #6d28d9",
};

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/*
 * One service's key or token. The launcher checks it with the service before saving
 * it, and from then on shows it masked, with Edit to replace or remove it.
 */
export default function ApiKeyRow({ name, label, environmentVariable, status, children, onChange }: Props) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const showBox = !status?.fromEnvironment && (!status?.set || editing);

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
    <div data-testid={`api-key-${name}`} style={{ padding: "14px 0", borderTop: "1px solid #2b1d47" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <strong style={{ color: "#ede9fe", fontSize: 15 }}>{label}</strong>
        <span
          data-testid="api-key-state"
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: status?.set ? "#14532d" : "#262626",
            color: status?.set ? "#86efac" : "#9ca3af",
          }}
        >
          {status?.fromEnvironment ? "From environment" : status?.set ? "Working" : "Not added"}
        </span>
      </div>

      <p style={{ color: "#9ca3af", fontSize: 13, margin: "0 0 10px" }}>{children}</p>

      {status?.fromEnvironment && (
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
          Set by the {environmentVariable} environment variable, so it's changed there.
        </p>
      )}

      {!status?.fromEnvironment && status?.set && !editing && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <code data-testid="api-key-hint" style={{ ...boxStyle, fontFamily: "ui-monospace, Menlo, monospace", color: "#d4d4d8" }}>
            {status.hint ?? "Saved"}
          </code>
          <button
            className="sidebar-button"
            onClick={() => {
              setEditing(true);
              setSaved(null);
              setError(null);
            }}
          >
            Edit
          </button>
        </div>
      )}

      {showBox && (
        <form
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() && !busy) change(value);
          }}
        >
          <input
            type="password"
            aria-label={`${label} key`}
            autoComplete="off"
            autoFocus={editing}
            value={value}
            placeholder={status?.set ? "Paste a new one to replace it" : `Paste your ${label} key`}
            onChange={(event) => setValue(event.target.value)}
            style={boxStyle}
          />

          <button className="sidebar-button" type="submit" disabled={busy || !value.trim()}>
            {busy ? "Checking..." : "Save"}
          </button>

          {status?.set && (
            <>
              <button
                className="sidebar-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="sidebar-button"
                type="button"
                disabled={busy}
                style={{ background: "#7f1d1d" }}
                onClick={() => change(null)}
              >
                Remove
              </button>
            </>
          )}
        </form>
      )}

      {error && (
        <p role="alert" style={{ color: "#fca5a5", fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {saved && <p style={{ color: "#86efac", fontSize: 13, margin: "8px 0 0" }}>{saved}</p>}
    </div>
  );
}
