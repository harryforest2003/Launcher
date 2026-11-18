import { useEffect, useRef, useState } from "react";
import { Tags } from "lucide-react";
import { Button } from "../../components/ui";

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
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const inCount = sets.filter((set) => set.keys.includes(mod.key)).length;
  const tip = inCount ? `In ${inCount} set${inCount === 1 ? "" : "s"}: change which` : "Add to a set";

  return (
    <div ref={wrapper} className="gm-setmenu">
      <Button
        variant="ghost"
        size="sm"
        className={`gm-iconbtn${open || inCount ? " gm-iconbtn--on" : ""}`}
        data-testid="set-menu"
        data-tip={tip}
        aria-label={`Sets for ${mod.name}`}
        aria-expanded={open}
        icon={<Tags size={16} aria-hidden="true" />}
        onClick={() => setOpen((now) => !now)}
      />
      {open && (
        <div role="dialog" aria-label={`Sets for ${mod.name}`} className="gm-setmenu__pop">
          <div className="gm-setmenu__title">Sets</div>
          {sets.length === 0 && <div className="gm-setmenu__empty">No sets yet: name one below.</div>}
          {sets.map((set) => (
            <label key={set.id} className="gm-setmenu__row">
              <input type="checkbox" checked={set.keys.includes(mod.key)} onChange={(event) => onMember(set.id, event.target.checked)} />
              {set.name}
            </label>
          ))}
          <form
            className="gm-setmenu__form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!name.trim()) return;
              await onCreate(name.trim());
              setName("");
            }}
          >
            <input className="ui-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="New set..." maxLength={40} aria-label="New set name" />
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
