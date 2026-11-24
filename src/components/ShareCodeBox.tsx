import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "./ui";

type Props = {
  code: string;
  /** What the code holds, under it. */
  note: string;
};

/* A share code to copy: the code itself, selectable, a Copy button, and what it holds. */
export default function ShareCodeBox({ code, note }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <div data-testid="share-code" style={{ marginTop: 10 }}>
      <textarea
        readOnly
        className="ui-input ui-input--mono"
        aria-label="Share code"
        rows={3}
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        style={{ width: "100%", padding: "var(--space-2) var(--space-3)", fontSize: 12, resize: "vertical", wordBreak: "break-all" }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
        <p style={{ color: "var(--color-text-muted)", fontSize: 12, flex: 1, margin: 0 }}>{note}</p>
        <Button
          size="sm"
          icon={<Copy size={14} aria-hidden="true" />}
          onClick={() =>
            void navigator.clipboard.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false)
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
