import { useRef, useState } from "react";
import { Check, ImagePlus } from "lucide-react";
import UiButton from "../../components/ui/Button";
import { START_ITEMS } from "./startItems";

type Props = {
  busy: boolean;
  error: string | null;
  itemId: string;
  onItemChange: (itemId: string) => void;
  onFile: (file: File) => void;
};

const TIPS = [
  "One item, filling most of the picture.",
  "A plain or transparent background cuts out best.",
  "A straight-on view, not at an angle.",
  "PNG, JPEG or WebP. It stays on your computer.",
];

/* The view is the drop area; the controls on the right pick the item and start the import. */
export default function ImportStep({ busy, error, itemId, onItemChange, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const chosen = START_ITEMS.find((entry) => entry.id === itemId) ?? START_ITEMS[0];
  const ChosenIcon = chosen.icon;

  const takeFirst = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div className="sk-workspace sk-workspace--stretch">
      <div
        className={`sk-import${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          takeFirst(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          aria-label="Item image file"
          style={{ display: "none" }}
          onChange={(event) => {
            takeFirst(event.target.files);
            event.target.value = "";
          }}
        />

        <span className="sk-import__icon" aria-hidden="true">
          <ChosenIcon size={44} />
        </span>
        <div className="sk-import__kind">{chosen.name} model</div>
        <div className="sk-import__title">{busy ? "Cutting out your item..." : `Drop a picture of a ${chosen.name.toLowerCase()} here`}</div>
        <div className="sk-import__sub">
          {busy ? "This runs on your computer and nothing is uploaded." : `${chosen.sub}. PNG, JPEG or WebP.`}
        </div>
        <div className="sk-import__frame" aria-hidden="true">
          <ImagePlus size={28} />
          <span>One item on a plain background</span>
        </div>
        {error && <div className="sk-import__error" role="alert">{error}</div>}
      </div>

      <aside className="sk-import__panel" aria-label="Import controls">
        <h2 className="sk-import__heading">Item type</h2>
        <div className="sk-import__types" role="radiogroup" aria-label="Item type">
          {START_ITEMS.map((entry) => {
            const Icon = entry.icon;
            const on = entry.id === itemId;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                className={`sk-import__type${on ? " is-on" : ""}`}
                onClick={() => onItemChange(entry.id)}
              >
                <Icon size={16} aria-hidden="true" />
                {entry.name}
              </button>
            );
          })}
        </div>

        <h2 className="sk-import__heading">A good picture</h2>
        <ul className="sk-import__tips">
          {TIPS.map((tip) => (
            <li key={tip}>
              <Check size={14} aria-hidden="true" />
              {tip}
            </li>
          ))}
        </ul>

        <UiButton
          variant="primary"
          size="lg"
          icon={<ImagePlus size={18} aria-hidden="true" />}
          aria-label="Choose an image of an item"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          style={{ width: "100%" }}
        >
          Choose an image
        </UiButton>
        <p className="sk-import__hint">You can correct the selection in the next step.</p>
      </aside>
    </div>
  );
}
