import "./ui/ui.css";

type Props = {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  label: string;
};

/* An on/off switch: filled with the accent when on, an outlined well when off. */
export default function Toggle({ on, onChange, disabled = false, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      className="ui-toggle"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="ui-toggle__thumb" />
    </button>
  );
}
