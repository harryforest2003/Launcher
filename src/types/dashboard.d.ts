export {};

/*
 * The Home dashboard's data (electron/dashboard/*.cjs, exposed by electron/preload.cjs as
 * window.dashboardAPI). Every number comes from something on disk or recorded by the
 * launcher; where nothing is known the value is null, never a made-up 0.
 */
declare global {
    /** Whole seconds. */
    type DashboardSeconds = number;

    type DashboardInstanceStat = {
        /** The instance's name: the id the rest of the app uses. */
        name: string;
        /** Minecraft version. */
        version: string;
        /** vanilla | fabric | forge | neoforge | quilt */
        loader: string;
        loaderVersion?: string;
        /** Mods turned on or off in the mods folder. */
        modCount: number;
        /** ISO date and time. */
        created?: string;
        /** ISO date and time. */
        lastPlayed?: string;
        /**
         * Time in play sessions: the game's dated logs plus sessions the launcher recorded,
         * merged so none is counted twice. null when neither exists (show "not known yet", never 0).
         */
        playSeconds: DashboardSeconds | null;
        /** Play sessions found. */
        sessions: number;
        /** The day of the earliest session (YYYY-MM-DD). */
        since?: string;
        /**
         * What the single-player worlds' own statistics say. Kept apart from playSeconds: it
         * can include play from before a world came into this launcher. null when no world has statistics.
         */
        worldPlaySeconds: DashboardSeconds | null;
        /** Single-player worlds in the instance. */
        worlds: number;
    };

    type DashboardDay = {
        /** Local calendar day, YYYY-MM-DD. */
        date: string;
        seconds: DashboardSeconds;
        byInstance: Record<string, DashboardSeconds>;
    };

    type DashboardStats = {
        generatedAt: string;
        instances: DashboardInstanceStat[];
        totals: {
            instances: number;
            mods: number;
            /** Session time across instances; null when no instance has any session source. */
            playSeconds: DashboardSeconds | null;
            sessions: number;
            /** World statistics across instances, never added to playSeconds. */
            worldPlaySeconds: DashboardSeconds | null;
        };
        /** Session time per local calendar day for the last 90 days (zeros included), oldest first. */
        daily: DashboardDay[];
        /** Which real sources produced the numbers. */
        sources: { tracked: boolean; logs: boolean; worldStats: boolean };
        /** Earliest day any source covers (YYYY-MM-DD). */
        since?: string;
    };

    type ActivityKind =
        | "played"
        | "instance-created"
        | "mods-installed"
        | "mods-updated"
        | "loader-updated"
        | "crash"
        | "launcher-updated"
        | "error";

    type ActivityItem = { at: string; kind: ActivityKind; instance?: string; title: string; detail?: string };

    type NewsCategory = "minecraft" | "java" | "bedrock" | "snapshot" | "fabric" | "forge" | "neoforge" | "modding" | "community" | "gaming";

    /** Which page a news feed is for: the Minecraft home, or the launcher's main Home. */
    type NewsFeed = "minecraft" | "gaming";

    type NewsItem = {
        id: string;
        title: string;
        summary: string;
        /** ISO date and time. */
        date: string;
        source: string;
        category: NewsCategory;
        url: string;
        /** An https URL, or null. */
        image?: string | null;
    };

    type NewsResult = {
        items: NewsItem[];
        /** Names of the sources that couldn't be reached this time. */
        failed: string[];
        fetchedAt: string;
        fromCache: boolean;
    };

    type DashboardAPI = {
        stats(): Promise<DashboardStats>;
        /** Newest first. */
        activity(limit?: number): Promise<ActivityItem[]>;
        news(opts?: { refresh?: boolean; feed?: NewsFeed }): Promise<NewsResult>;
        /** Steam's current specials, priced for the player's country. */
        deals(opts?: { refresh?: boolean }): Promise<DealsResult>;
    };

    type SteamDeal = {
        id: number;
        name: string;
        discountPercent: number;
        /** In the currency's main unit (pounds, dollars). */
        originalPrice: number;
        finalPrice: number;
        /** ISO 4217, for Intl.NumberFormat. */
        currency: string;
        image: string | null;
        url: string;
        endsAt: string | null;
        platforms: { windows: boolean; mac: boolean; linux: boolean };
    };

    type DealsResult = {
        items: SteamDeal[];
        failed: string[];
        fetchedAt: string;
        fromCache: boolean;
    };

    interface Window {
        dashboardAPI: DashboardAPI;
    }
}
