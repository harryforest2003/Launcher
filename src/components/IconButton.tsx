import type { ReactNode } from "react";

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
  children: ReactNode;
};

/*
 * A square button that's only an icon. When it can't be used it's greyed out but still
 * answers the mouse (aria-disabled rather than disabled, which the browser makes ignore
 * the mouse), so hovering can still say what it does and why it's unavailable.
 */
export default function IconButton({ tip, label, onClick, disabled = false, variant = "", testId, children }: Props) {
  return (
    <button
      type="button"
      className={`icon-button ${variant}`.trim()}
      data-testid={testId}
      data-tip={tip}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {children}
    </button>
  );
}
