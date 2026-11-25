import { useId } from "react";

/*
 * A cover drawn for a game with no picture of its own (Hytale before its store page, a
 * game added by hand, or offline): its colour as a sky, a few hills, and its name, so it
 * reads as that game's card rather than as initials. The same name always draws the same.
 */

const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/* Small, repeatable random numbers from the name. */
function numbers(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

type Props = {
  name: string;
  /** The game's colour; otherwise one from its name. A CSS colour or var(). */
  colour?: string | null;
  /** thumb: a small square, with the first letter instead of the name; backdrop: no name (a page's title sits over it). */
  variant?: "cover" | "thumb" | "backdrop";
  className?: string;
};

export default function GameCover({ name, colour, variant = "cover", className }: Props) {
  const id = useId().replace(/:/g, "");
  const seed = hash(name.trim().toLowerCase() || "game");
  const rand = numbers(seed);
  const hue = seed % 360;
  const base = colour || `var(--game-colour, hsl(${hue} 55% 42%))`;
  const W = variant === "thumb" ? 100 : 460;
  const H = variant === "thumb" ? 100 : 215;

  // Three ridges, back to front, each lower and darker.
  const ridges = [0.42, 0.58, 0.74].map((level, layer) => {
    const points: string[] = [`0,${H}`];
    const steps = 6 + Math.floor(rand() * 4);
    for (let i = 0; i <= steps; i++) {
      const x = (W / steps) * i;
      const y = H * (level + (rand() - 0.5) * (0.22 - layer * 0.05));
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    points.push(`${W},${H}`);
    return points.join(" ");
  });
  const sunX = W * (0.2 + rand() * 0.6);
  const sunY = H * (0.18 + rand() * 0.14);
  const title = name.trim() || "Game";
  const letter = [...title][0]?.toUpperCase() ?? "?";
  const size = Math.max(22, Math.min(46, 620 / Math.max(6, title.length)));

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      aria-hidden="true"
      data-testid="game-cover"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" style={{ stopColor: base }} />
          <stop offset="1" style={{ stopColor: "#0b0d14" }} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}-sky)`} />
      <circle cx={sunX} cy={sunY} r={H * 0.36} fill={`url(#${id}-sun)`} />
      <circle cx={sunX} cy={sunY} r={H * 0.07} fill="#fff" opacity="0.7" />
      {ridges.map((points, layer) => (
        <polygon key={layer} points={points} fill="#05060a" opacity={0.28 + layer * 0.2} />
      ))}
      {variant === "thumb" ? (
        <text x={W / 2} y={H * 0.66} textAnchor="middle" fontSize={H * 0.5} fontWeight={800} fill="#fff" opacity="0.92" style={{ fontFamily: "var(--font-display, system-ui)" }}>
          {letter}
        </text>
      ) : variant === "backdrop" ? null : (
        <text
          x={W * 0.06}
          y={H * 0.86}
          fontSize={size}
          fontWeight={800}
          fill="#fff"
          letterSpacing="0.04em"
          style={{ fontFamily: "var(--font-display, system-ui)", textTransform: "uppercase" }}
        >
          {title}
        </text>
      )}
    </svg>
  );
}
