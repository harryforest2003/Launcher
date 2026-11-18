import { useEffect, useState } from "react";

/* A game's Steam page details (price, news, DLC), asked once per game; null until they arrive or when there are none. */
export function useStoreInfo(id: GameId): GameStoreInfo | null {
  const [info, setInfo] = useState<{ id: GameId; value: GameStoreInfo } | null>(null);
  useEffect(() => {
    let live = true;
    window.gamesAPI
      .storeInfo(id)
      .then((value) => live && setInfo({ id, value }))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [id]);
  return info?.id === id ? info.value : null;
}
