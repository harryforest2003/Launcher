import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui";

type Props = {
  page: number;
  pageCount: number;
  disabled?: boolean;
  onChange: (page: number) => void;
};

const numberStyle: CSSProperties = {
  minWidth: "var(--control-sm)",
  padding: "0 var(--space-2)",
  fontVariantNumeric: "tabular-nums",
};

// The page you're on: the accent rail under it, on the accent tint.
const currentStyle: CSSProperties = {
  ...numberStyle,
  background: "var(--color-accent-subtle)",
  color: "var(--color-accent-text)",
  boxShadow: "inset 0 calc(var(--rail-width) * -1) 0 var(--color-accent-line)",
};

const inputStyle: CSSProperties = {
  width: 56,
  height: "var(--control-sm)",
  padding: "0 var(--space-2)",
  borderRadius: "var(--ui-radius-control, var(--radius-md))",
  background: "var(--color-surface-sunken)",
  color: "var(--color-text)",
  border: "var(--border-width) solid var(--color-border-strong)",
  fontSize: "var(--font-size-xs)",
  fontVariantNumeric: "tabular-nums",
};

// The first and last pages, plus the two either side of the current one.
function visiblePages(page: number, pageCount: number) {
  const pages = new Set([1, pageCount]);
  for (let near = page - 2; near <= page + 2; near += 1) {
    if (near >= 1 && near <= pageCount) pages.add(near);
  }
  return [...pages].sort((a, b) => a - b);
}

/* Previous / page numbers / next, and a box to jump to any page: one slim row. */
export default function Pagination({ page, pageCount, disabled, onChange }: Props) {
  const [typed, setTyped] = useState("");

  if (pageCount <= 1) return null;

  const goToTyped = () => {
    const wanted = Number.parseInt(typed, 10);
    if (Number.isNaN(wanted)) return;
    onChange(Math.min(Math.max(wanted, 1), pageCount));
    setTyped("");
  };

  const pages = visiblePages(page, pageCount);

  return (
    <nav
      aria-label="Pages"
      data-testid="pagination"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-0-5)" }}
    >
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronLeft size={16} aria-hidden="true" />}
        aria-label="Previous page"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      />

      {pages.map((number, index) => (
        <span key={number} style={{ display: "contents" }}>
          {index > 0 && number - pages[index - 1] > 1 && (
            <span aria-hidden="true" style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-xs)", padding: "0 var(--space-0-5)" }}>
              …
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-current={number === page ? "page" : undefined}
            aria-label={`Page ${number.toLocaleString()}`}
            style={number === page ? currentStyle : numberStyle}
            disabled={disabled}
            onClick={() => onChange(number)}
          >
            {number.toLocaleString()}
          </Button>
        </span>
      ))}

      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronRight size={16} aria-hidden="true" />}
        aria-label="Next page"
        disabled={disabled || page >= pageCount}
        onClick={() => onChange(page + 1)}
      />

      <form
        style={{ display: "flex", gap: "var(--space-1)", marginLeft: "var(--space-2)" }}
        onSubmit={(event) => {
          event.preventDefault();
          goToTyped();
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={`Go to page (1 to ${pageCount.toLocaleString()})`}
          placeholder="Page"
          value={typed}
          onChange={(event) => setTyped(event.target.value.replace(/[^0-9]/g, ""))}
          style={inputStyle}
        />
        <Button type="submit" size="sm" disabled={disabled || !typed}>
          Go
        </Button>
      </form>
    </nav>
  );
}
