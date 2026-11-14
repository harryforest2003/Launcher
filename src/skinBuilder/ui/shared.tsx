import { useState, type CSSProperties, type ReactNode } from "react";
import type { PromptRequest } from "./prompt";
import { fieldStyle, panelStyle } from "./styles";

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
};

export function Button({ children, onClick, primary, danger, active, disabled, title, style }: ButtonProps) {
  return (
    <button
      type="button"
      className="sidebar-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "10px 14px",
        fontSize: 14,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        background: primary || active ? "var(--color-accent-subtle)" : danger ? "var(--color-danger-bg)" : undefined,
        borderColor: danger ? "var(--color-danger-border)" : undefined,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
};

export function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label style={{ display: "block", marginBottom: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
      <span style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: "var(--color-accent-text)" }}>{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: "var(--color-accent)" }}
      />
    </label>
  );
}

function PromptForm({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        request.settle(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") request.settle(null);
      }}
      style={{ ...panelStyle, background: "var(--color-chrome)", width: 360, maxWidth: "calc(100vw - 40px)", borderColor: "var(--color-border)" }}
    >
      <label style={{ display: "block", color: "var(--color-accent-text)", fontSize: 15, marginBottom: 12 }}>
        {request.title}
        <input
          autoFocus
          aria-label={request.title}
          value={value}
          maxLength={60}
          onChange={(event) => setValue(event.target.value)}
          style={{ ...fieldStyle, marginTop: 8 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={() => request.settle(null)}>Cancel</Button>
        <button
          type="submit"
          className="sidebar-button"
          disabled={!value.trim()}
          style={{ padding: "10px 14px", fontSize: 14, background: "var(--color-accent)", color: "var(--color-on-accent)", opacity: value.trim() ? 1 : 0.45 }}
        >
          OK
        </button>
      </div>
    </form>
  );
}

export function PromptDialog({ request }: { request: PromptRequest | null }) {
  if (!request) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-scrim)",
      }}
    >
      <PromptForm key={request.title} request={request} />
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: "var(--color-accent-text)", margin: "14px 0 8px" }}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--color-danger-border)",
        background: "var(--color-danger-bg)",
        color: "var(--color-danger-text)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
