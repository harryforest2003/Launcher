import { useEffect, useRef, useState } from "react";
import { Tags } from "lucide-react";
import IconButton from "../../components/IconButton";

type Props = {
  mod: GameMod;
  sets: GameSet[];
  onMember: (setId: string, member: boolean) => void;
  onCreate: (name: string) => Promise<void>;
};

/* A mod's sets: tick the ones it's in, or make a new one with it in. */
export default function SetMenu({ mod, sets, onMember, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const inCount = sets.filter((set) => set.keys.includes(mod.key)).length;

  return (
    <div ref={wrapper} style={{ position: "relative" }}>
      <IconButton
        tip={inCount ? `In ${inCount} set${inCount === 1 ? "" : "s"}: change which` : "Add to a set"}
        label={`Sets for ${mod.name}`}
        testId="set-menu"
        variant={open ? "ready" : ""}
        onClick={() => setOpen((now) => !now)}
      >
        <Tags size={18} />
      </IconButton>
      {open && (
        <div
          role="dialog"
          aria-label={`Sets for ${mod.name}`}
          style={{
            position: "absolute",
            right: 0,
            top: 54,
            zIndex: 50,
            width: 240,
            background: "#17141f",
            border: "1px solid #6d28d9",
            borderRadius: 12,
            boxShadow: "0 12px 30px rgba(0, 0, 0, 0.5)",
            padding: 10,
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Sets</div>
          {sets.length === 0 && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>No sets yet: name one below.</div>}
          {sets.map((set) => (
            <label key={set.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={set.keys.includes(mod.key)}
                onChange={(event) => onMember(set.id, event.target.checked)}
                style={{ width: 15, height: 15, accentColor: "#7c3aed" }}
              />
              {set.name}
            </label>
          ))}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!name.trim()) return;
              await onCreate(name.trim());
              setName("");
            }}
            style={{ display: "flex", gap: 6, marginTop: 8 }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New set..."
              maxLength={40}
              style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, background: "#1b1b1b", color: "white", border: "1px solid #6d28d9", fontSize: 12 }}
            />
            <button type="submit" className="sidebar-button" style={{ padding: "6px 10px", fontSize: 12 }}>
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
