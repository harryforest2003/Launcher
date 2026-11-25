import type { CSSProperties } from "react";
import { initials } from "../pages/playedAgo";
import { useInstancePicture } from "../utils/instancePictures";

type Props = {
  name: string;
  /** Cells across and down. A square tile uses 6 x 6; a wide banner more across. */
  cols?: number;
  rows?: number;
  className?: string;
  /** Always the pattern, never the instance's own picture (for a name still being typed). */
  plain?: boolean;
};

// How far round the colour wheel an instance's pattern turns from the user's colour (library.css .lx-art).
const HUE_TURNS = [0, 40, 80, 140, 200, 250, 310];

// A small, steady hash of the name (FNV-1a), so an instance always gets the same pattern.
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: a tiny repeatable random number source seeded by the hash.
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * An instance's own picture when it has one (over a blurred copy of itself, so it fills a
 * wide banner too). Otherwise the picture for an instance that has none: its initials over a mirrored pixel pattern made
 * from its name, in the user's colour turned by an amount of its own (library.css .lx-art). Every instance looks different,
 * none of them is a grey cube, and the letters stay readable on any colour (they get a halo
 * of the background colour).
 */
export default function InstanceArt({ name, cols = 6, rows = 6, className, plain = false }: Props) {
  const picture = useInstancePicture(plain ? null : name);
  if (picture) {
    return (
      <span className={["lx-art", "lx-art--picture", className].filter(Boolean).join(" ")} aria-hidden="true">
        <img className="lx-art__backdrop" src={picture} alt="" draggable={false} />
        <img
          className="lx-art__picture"
          src={picture}
          alt=""
          draggable={false}
          // Small pixel art is scaled up in blocks rather than blurred.
          onLoad={(event) => event.currentTarget.classList.toggle("is-pixel", event.currentTarget.naturalWidth <= 128)}
        />
      </span>
    );
  }

  const seed = hash(name.trim().toLowerCase() || "?");
  const next = random(seed);
  const half = Math.ceil(cols / 2);
  const cells: { x: number; y: number; strong: boolean }[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const roll = next();
      if (roll < 0.45) continue;
      const strong = roll > 0.85;
      cells.push({ x, y, strong });
      const mirror = cols - 1 - x;
      if (mirror !== x) cells.push({ x: mirror, y, strong });
    }
  }
  const size = 10;
  const height = rows * size;
  const text = initials(name || "?").slice(0, 3);
  const fontSize = height * (text.length > 2 ? 0.3 : 0.38);

  return (
    <span
      className={["lx-art", className].filter(Boolean).join(" ")}
      style={{ "--art-hue": HUE_TURNS[seed % HUE_TURNS.length] } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${cols * size} ${height}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        {cells.map((cell) => (
          <rect
            key={`${cell.x}:${cell.y}`}
            className={cell.strong ? "px strong" : "px"}
            x={cell.x * size + 0.5}
            y={cell.y * size + 0.5}
            width={size - 1}
            height={size - 1}
          />
        ))}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          strokeWidth={fontSize * 0.22}
        >
          {text}
        </text>
      </svg>
    </span>
  );
}
