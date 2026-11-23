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

    interface Window {
        updaterAPI?: {
            state(): Promise<AppUpdateState>;
            check(): Promise<AppUpdateState>;
            /** Quits, puts the downloaded build in place, and opens it again. */
            restart(): Promise<boolean>;
            onState(listener: (state: AppUpdateState) => void): () => void;
        };
    }
}
