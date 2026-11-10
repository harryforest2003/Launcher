import { useState } from "react";

type Props = {
  page: number;
  pageCount: number;
  disabled?: boolean;
  onChange: (page: number) => void;
};

const buttonStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  width: "auto",
  minWidth: 34,
};

// The first and last pages, plus the two either side of the current one.
function visiblePages(page: number, pageCount: number) {
  const pages = new Set([1, pageCount]);
  for (let near = page - 2; near <= page + 2; near += 1) {
    if (near >= 1 && near <= pageCount) pages.add(near);
  }
  return [...pages].sort((a, b) => a - b);
}

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
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}
    >
      <button
        className="sidebar-button"
        style={buttonStyle}
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ← Prev
      </button>

      {pages.map((number, index) => (
        <span key={number} style={{ display: "contents" }}>
          {index > 0 && number - pages[index - 1] > 1 && <span style={{ color: "#6b7280", fontSize: 12 }}>…</span>}
          <button
            className="sidebar-button"
            aria-current={number === page ? "page" : undefined}
            style={{ ...buttonStyle, background: number === page ? "#6d28d9" : undefined }}
            disabled={disabled}
            onClick={() => onChange(number)}
          >
            {number.toLocaleString()}
          </button>
        </span>
      ))}

      <button
        className="sidebar-button"
        style={buttonStyle}
        disabled={disabled || page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Next →
      </button>

      <form
        style={{ display: "flex", gap: 6, marginLeft: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          goToTyped();
        }}
      >
        <input
          type="number"
          min={1}
          max={pageCount}
          aria-label="Go to page"
          placeholder="Page"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          style={{
            width: 76,
            padding: "6px 8px",
            borderRadius: 8,
            background: "#1b1b1b",
            color: "white",
            border: "1px solid #6d28d9",
            fontSize: 12,
          }}
        />
        <button className="sidebar-button" type="submit" style={buttonStyle} disabled={disabled || !typed}>
          Go
        </button>
      </form>
    </nav>
  );
}
