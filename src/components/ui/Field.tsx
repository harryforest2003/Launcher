import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import "./ui.css";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Monospace, for codes, paths and keys. */
  mono?: boolean;
};

/* A labelled text input with an optional hint and error, wired up for screen readers. */
export default function Field({ label, hint, error, mono, className, id, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label className="ui-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={["ui-input", mono && "ui-input--mono"].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {hint && (
        <span id={hintId} className="ui-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="ui-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
