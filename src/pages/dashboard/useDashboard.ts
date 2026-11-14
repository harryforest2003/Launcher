import { useCallback, useEffect, useRef, useState } from "react";

type Load<T> = { data: T | null; loading: boolean; failed: boolean };

const start = { data: null, loading: true, failed: false };

/*
 * The dashboard's own data (window.dashboardAPI): play time, recent activity and news. Each
 * part loads on its own, so a slow or failing news source never holds up the rest, and the
 * API being missing (an older main process) just shows the empty states.
 */
export function useDashboard(includeNews = true, { feed = "minecraft", deals: includeDeals = false }: { feed?: NewsFeed; deals?: boolean } = {}) {
  const [stats, setStats] = useState<Load<DashboardStats>>(start);
  const [activity, setActivity] = useState<Load<ActivityItem[]>>(start);
  const [news, setNews] = useState<Load<NewsResult>>(start);
  const [deals, setDeals] = useState<Load<DealsResult>>(start);
  const dealsRequest = useRef(0);

  const api = typeof window !== "undefined" ? window.dashboardAPI : undefined;

  const newsRequest = useRef(0);

  const loadNews = useCallback(
    (refresh: boolean) => {
      const request = ++newsRequest.current;
      return Promise.resolve().then(() => api?.news(refresh ? { refresh: true, feed } : { feed }))
        .then((data) => {
          if (request === newsRequest.current) setNews({ data: data ?? null, loading: false, failed: !data });
        })
        .catch(() => {
          if (request === newsRequest.current) setNews({ data: null, loading: false, failed: true });
        });
    },
    [api, feed]
  );

  // Steam's current specials, for the main Home. An older main process without them shows the empty state.
  const loadDeals = useCallback(
    (refresh: boolean) => {
      const request = ++dealsRequest.current;
      return Promise.resolve().then(() => (api?.deals ? api.deals(refresh ? { refresh: true } : undefined) : null))
        .then((data) => {
          if (request === dealsRequest.current) setDeals({ data: data ?? null, loading: false, failed: !data });
        })
        .catch(() => {
          if (request === dealsRequest.current) setDeals({ data: null, loading: false, failed: true });
        });
    },
    [api]
  );

  useEffect(() => {
    let active = true;
    let refreshing = false;
    let refreshAgain = false;
    const refresh = async () => {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      await Promise.all([
        Promise.resolve().then(() => api?.stats())
          .then((data) => {
            if (active) setStats({ data: data ?? null, loading: false, failed: !data });
          })
          .catch(() => {
            if (active) setStats({ data: null, loading: false, failed: true });
          }),
        Promise.resolve().then(() => api?.activity(12))
          .then((data) => {
            if (active) setActivity({ data: data ?? null, loading: false, failed: !data });
          })
          .catch(() => {
            if (active) setActivity({ data: null, loading: false, failed: true });
          }),
      ]);
      refreshing = false;
      if (active && refreshAgain) {
        refreshAgain = false;
        void refresh();
      }
    };
    const onFocus = () => { void refresh(); };
    void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = window.instanceAPI?.onExit?.(onFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    if (includeNews) loadNews(false);
    if (includeDeals) loadDeals(false);
    return () => {
      active = false;
      // Invalidate in-flight news and deals responses, including the Strict Mode setup cycle.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      newsRequest.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      dealsRequest.current++;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      unsubscribe?.();
    };
  }, [api, includeNews, loadNews, includeDeals, loadDeals]);

  const refreshNews = useCallback(() => {
    setNews((now) => ({ ...now, loading: true }));
    return loadNews(true);
  }, [loadNews]);

  const refreshDeals = useCallback(() => {
    setDeals((now) => ({ ...now, loading: true }));
    return loadDeals(true);
  }, [loadDeals]);

  return { stats, activity, news, refreshNews, deals, refreshDeals };
}
