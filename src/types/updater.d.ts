export {};

declare global {
    /** Which commit a build came from, and when that commit was made. */
    type AppBuild = { commit: string; committed: string; built?: string; url?: string };

    type AppUpdateState = {
        /**
         * unsupported: this copy never updates (run from source, or can't replace itself).
         * ready: a newer build is downloaded and goes in when the launcher restarts.
         */
        status: "unsupported" | "idle" | "checking" | "current" | "downloading" | "ready" | "error";
        current: AppBuild | null;
        latest?: AppBuild;
        /** 0 to 1, while downloading. */
        progress?: number;
        message?: string;
        checkedAt?: string;
    };

    type AppAbout = {
        version: string;
        commit: string | null;
        built: string | null;
        packaged: boolean;
        electron: string;
        chrome: string;
        node: string;
        platform: string;
        arch: string;
    };
    type AppStorage = { dataDir: string; dataBytes: number; cacheBytes: number; updateBytes: number };

    interface Window {
        /** The launcher itself, for Settings (electron/launcherApp.cjs). */
        appAPI?: {
            about(): Promise<AppAbout>;
            storage(): Promise<AppStorage>;
            clearCache(): Promise<AppStorage & { freedBytes: number }>;
            openDataFolder(): Promise<void>;
            startup(): Promise<{ supported: boolean; openAtLogin: boolean }>;
            setStartup(change: { openAtLogin?: boolean }): Promise<{ supported: boolean; openAtLogin: boolean }>;
            testNotification(): Promise<void>;
            /** -> the file saved, or null when cancelled. */
            exportSettings(prefs: Record<string, string>): Promise<string | null>;
            /** -> the page's preferences to put back, or null when cancelled. */
            importSettings(): Promise<{ prefs: Record<string, string> } | null>;
        };
        updaterAPI?: {
            state(): Promise<AppUpdateState>;
            check(): Promise<AppUpdateState>;
            /** Quits, puts the downloaded build in place, and opens it again. */
            restart(): Promise<boolean>;
            onState(listener: (state: AppUpdateState) => void): () => void;
        };
    }
}
