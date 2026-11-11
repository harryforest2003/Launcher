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
        background: primary || active ? "#6d28d9" : danger ? "#3a1420" : undefined,
        borderColor: danger ? "#b91c4b" : undefined,
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
    <label style={{ display: "block", marginBottom: 12, fontSize: 13, color: "#ccc" }}>
      <span style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: "#c084fc" }}>{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: "#a855f7" }}
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
      style={{ ...panelStyle, background: "#161616", width: 360, maxWidth: "calc(100vw - 40px)", borderColor: "#6d28d9" }}
    >
      <label style={{ display: "block", color: "#c084fc", fontSize: 15, marginBottom: 12 }}>
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
          style={{ padding: "10px 14px", fontSize: 14, background: "#6d28d9", opacity: value.trim() ? 1 : 0.45 }}
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
        background: "rgba(0, 0, 0, 0.6)",
      }}
    >
      <PromptForm key={request.title} request={request} />
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: "#c084fc", margin: "14px 0 8px" }}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid #b91c4b",
        background: "#2a0f18",
        color: "#fda4af",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
