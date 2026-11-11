import type { CSSProperties, ReactNode } from "react";

type Props = {
  /** What it does, shown above the cursor on hover (HoverTips); say why when it can't be used. */
  tip: string;
  /** Its name for screen readers. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Extra classes: "ready" (something to save), "confirming" (click again), "on" (already done). */
  variant?: string;
  testId?: string;
  /** Pressed while it can't be used: say why somewhere (its hover tip says so too). */
  onUnavailable?: () => void;
  style?: CSSProperties;
  children: ReactNode;
};

/*
 * A square button that's only an icon. When it can't be used it looks just the same, and
 * hovering or pressing it says why (aria-disabled rather than disabled, which would grey it
 * out and make the browser ignore the mouse).
 */
export default function IconButton({ tip, label, onClick, disabled = false, variant = "", testId, onUnavailable, style, children }: Props) {
  return (
    <button
      type="button"
      className={`icon-button ${variant}`.trim()}
      data-testid={testId}
      data-tip={tip}
      aria-label={label}
      aria-disabled={disabled || undefined}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) onUnavailable?.();
        else onClick();
      }}
    >
      {children}
    </button>
  );
}
