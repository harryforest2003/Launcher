import "./ui.css";

type Props = {
  /** 0 to 1; leave out for "busy, no idea how long". */
  value?: number;
  label: string;
  /** Show the percentage at the end. */
  showValue?: boolean;
  size?: "sm" | "md";
};

/* How far along something is (a download, an install). */
export default function ProgressBar({ value, label, showValue, size = "md" }: Props) {
  const known = typeof value === "number" && Number.isFinite(value);
  const percent = known ? Math.round(Math.min(1, Math.max(0, value)) * 100) : 0;
  return (
    <div className={`ui-progress${size === "sm" ? " ui-progress--sm" : ""}`}>
      <div
        className={`ui-progress__track${known ? "" : " is-indeterminate"}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? percent : undefined}
      >
        <div className="ui-progress__fill" style={known ? { width: `${percent}%` } : undefined} />
      </div>
      {showValue && known && <span className="ui-progress__value">{percent}%</span>}
    </div>
  );
}
