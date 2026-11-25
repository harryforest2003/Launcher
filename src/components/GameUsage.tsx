import { useEffect, useState } from "react";
import { Badge } from "./ui";

/*
 * The memory an instance is given, and while its game runs, how much it uses and its share
 * of the computer's CPU. Read every few seconds, only while the game runs and the window
 * is showing. Java uses some memory beyond what it's given, so "in use" can pass the setting.
 */

const EVERY_MS = 3000;

const gb = (bytes: number) => {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
};

const EXPLAIN = "What the game uses now, with Java's own memory on top of what it's given.";

function useUsage(name: string, running: boolean) {
  const [reading, setReading] = useState<{ for: string; usage: GameUsage | null } | null>(null);

  useEffect(() => {
    if (!running) return;
    let live = true;
    const read = () => {
      if (document.hidden) return;
      window.instanceAPI.usage(name).then(
        (usage) => live && setReading({ for: name, usage }),
        () => live && setReading({ for: name, usage: null })
      );
    };
    read();
    const timer = window.setInterval(read, EVERY_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [name, running]);

  return running && reading?.for === name ? reading.usage : null;
}

type Props = { name: string; running: boolean; ram: number };

/* For a list of facts: "6 GB", or "4.2 of 6 GB" with the CPU under it while the game runs. */
export function MemoryFact({ name, running, ram }: Props) {
  const usage = useUsage(name, running);
  if (!usage) return <>{ram} GB</>;
  return (
    <span data-testid="game-usage" title={EXPLAIN}>
      {gb(usage.memory)} of {ram} GB
      {usage.cpu !== null && <span className="game-usage__cpu">CPU {Math.round(usage.cpu)}%</span>}
    </span>
  );
}

/* For an instance's header: "6 GB RAM", or "4.2 of 6 GB RAM · CPU 24%" while the game runs. */
export function MemoryBadge({ name, running, ram }: Props) {
  const usage = useUsage(name, running);
  if (!usage) return <Badge>{ram} GB RAM</Badge>;
  return (
    <Badge tone="info" title={EXPLAIN} data-testid="game-usage">
      {gb(usage.memory)} of {ram} GB RAM{usage.cpu !== null ? ` · CPU ${Math.round(usage.cpu)}%` : ""}
    </Badge>
  );
}
