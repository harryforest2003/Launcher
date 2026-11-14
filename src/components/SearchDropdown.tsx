import { useEffect, useRef, useState } from "react";

type Option = {
  value: string;
  label: string;
};

type Props = {
  options: Option[];
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  /** Smaller, to sit beside another field. */
  compact?: boolean;
  /** Highlighted, when what it chose is in use. */
  active?: boolean;
  /** What the field is, for screen readers. */
  label?: string;
};

function SearchDropdown({
  options,
  value,
  onChange,
  placeholder = "Search...",
  compact = false,
  active = false,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);

    return () =>
      document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
      }}
    >
      <input
        aria-label={label}
        value={open ? search : value}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setSearch("");
        }}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        style={{
          width: "100%",
          padding: compact ? "8px 10px" : "15px",
          borderRadius: "10px",
          border: `1px solid ${active ? "var(--color-accent-line)" : "var(--color-border)"}`,
          background: active ? "var(--color-accent-subtle)" : "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: compact ? "14px" : "15px",
          boxSizing: "border-box",
        }}
      />

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "5px",
            background: "var(--color-chrome)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            maxHeight: "300px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "12px",
                color: "var(--color-text-muted)",
              }}
            >
              No results
            </div>
          ) : (
            filtered.map((option) => (
              <div
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setSearch(option.label);
                  setOpen(false);
                }}
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  color: "var(--color-text)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--color-accent-subtle)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {option.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SearchDropdown;