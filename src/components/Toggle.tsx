type Props = {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  label: string;
};

/* An on/off switch: purple when on, grey when off. */
export default function Toggle({ on, onChange, disabled = false, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        position: "relative",
        width: 40,
        height: 22,
        flexShrink: 0,
        padding: 0,
        border: "none",
        borderRadius: 11,
        background: on ? "#7c3aed" : "#3f3f46",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "white",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}
