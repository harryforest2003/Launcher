import { useEffect, useState } from "react";

/* Other games started from here that are open now (electron/games/playTracker.cjs). */
export function usePlayingGames() {
  const [playing, setPlaying] = useState<GamePlaying[]>([]);
  useEffect(() => {
    const api = window.gamesAPI;
    if (!api?.playing) return;
    let live = true;
    api.playing().then((list) => live && setPlaying(list ?? []), () => {});
    const off = api.onPlaying?.((list) => setPlaying(list ?? []));
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return playing;
}
