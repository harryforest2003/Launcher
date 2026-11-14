import { createContext, useContext, useEffect, useState } from "react";

/*
 * The game sections' download queue, shared by the corner panel (DownloadQueue) and the
 * sidebar's Downloads button, which shows how many are left and opens the panel.
 */
export type Downloads = {
  queue: GameQueue | null;
  /** Downloads still to get (waiting, plus the one being got). */
  left: number;
  /** The panel was opened from the sidebar (it shows even with nothing queued). */
  shown: boolean;
  toggle: () => void;
  hide: () => void;
};

export const DownloadsContext = createContext<Downloads>({ queue: null, left: 0, shown: false, toggle: () => {}, hide: () => {} });

export const useDownloads = () => useContext(DownloadsContext);

/** Follows the queue in the main process. Used once, by App. */
export function useDownloadQueueState(): Downloads {
  const [queue, setQueue] = useState<GameQueue | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!window.gamesAPI?.queue) return;
    let active = true;
    window.gamesAPI
      .queue()
      .then((found) => active && found && setQueue(found))
      .catch(() => {});
    const stop = window.gamesAPI.onQueue((next) => setQueue(next));
    return () => {
      active = false;
      stop();
    };
  }, []);

  const left = queue ? queue.counts.waiting + (queue.current ? 1 : 0) : 0;
  return { queue, left, shown, toggle: () => setShown((now) => !now), hide: () => setShown(false) };
}
