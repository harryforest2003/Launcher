import { useState, type CSSProperties } from "react";

/*
 * Notes on an instance: what it's for, the server it goes with, what to remember next time.
 * Saved when the box loses focus; the Home drawer shows them under Play. Give it
 * key={instance name} so another instance starts from its own notes.
 */

const MAX = 8000;

type Props = {
  instanceName: string;
  notes: string;
  style: CSSProperties;
  onError: (message: string) => void;
};

export default function InstanceNotes({ instanceName, notes, style, onError }: Props) {
  const [draft, setDraft] = useState(notes);
  const [saved, setSaved] = useState(notes);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const save = async () => {
    const next = draft.trim();
    if (next === saved.trim()) return;
    setState("saving");
    try {
      await window.instanceAPI.update(instanceName, { notes: next });
      setSaved(next);
      setState("saved");
    } catch (err) {
      setState("idle");
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={style} data-testid="instance-notes">
      <label htmlFor="instance-notes-text" style={{ display: "block", color: "var(--color-accent-text)", marginBottom: 6 }}>
        Notes
      </label>
      <textarea
        id="instance-notes-text"
        className="ui-input"
        rows={4}
        maxLength={MAX}
        value={draft}
        placeholder="What it's for, the server it goes with, what to remember next time"
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        onBlur={() => void save()}
        style={{ width: "100%", padding: "var(--space-2) var(--space-3)", fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
      />
      <p aria-live="polite" style={{ color: "var(--color-text-muted)", fontSize: 12, margin: "6px 0 0", minHeight: 16 }}>
        {state === "saving" ? "Saving..." : state === "saved" ? "Saved. They show under Play on the Home page." : draft.length > MAX - 500 ? `${MAX - draft.length} characters left` : ""}
      </p>
    </div>
  );
}
