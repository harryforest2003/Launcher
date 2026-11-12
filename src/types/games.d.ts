export {};

declare global {
    type GameId = "sims4" | "gtav" | "skyrimse" | "fallout4" | "cyberpunk2077" | "stardew";

    /* A game with its own section: where it is and how many mods are on. */
    type GameSummary = {
        id: GameId;
        name: string;
        tagline: string;
        colour: string;
        found: boolean;
        gameDir: string | null;
        docsDir: string | null;
        source: string | null;
        chosen: boolean;
        windowsOnly: boolean;
        nexus: string | null;
        curseforge: number | null;
        modCount: number;
        /* Set when the game has updated since it was last played from here. */
        updated: { from: string | null; to: string | null } | null;
    };

    type GameDetail = GameSummary & {
        platform: string;
        version: string | null;
        lastPlayed: string | null;
        /* The Sims 4's own switches for custom content and script mods (null until it has an Options.ini). */
        simsOptions: { mods: boolean; scripts: boolean } | null;
        /* What The Sims 4 said went wrong since it was last played, naming the mods it could. */
        problems: { file: string; time: string; mods: string[]; line: string | null }[];
    };

    type GameMod = {
        key: string;
        managed: boolean;
        name: string;
        enabled: boolean;
        source: { provider: string; modId?: string; fileId?: string; fileName?: string } | null;
        installedAt?: string;
        where?: string;
        kind?: "file" | "folder" | "plugin";
        fileCount: number;
        areas: { area: string; count: number }[];
        plugins: string[];
        notes: string[];
        /* Changes the game's code (script mods, ASI plugins, SKSE plugins…). */
        hooks: boolean;
        since: string | null;
        /* Hooks into the game and is older than the game's latest update. */
        mayNeedUpdate: boolean;
        /* The installed version, where the site said. */
        version?: string | null;
        /* An update replaced an earlier copy, which Undo puts back. */
        canUndo?: boolean;
    };

    type GameModUpdate = {
        key: string;
        name: string;
        provider: "nexus" | "curseforge";
        modId: string;
        fromVersion: string;
        toVersion: string;
        toFileId: string;
        toName: string;
        date: string;
        size: number;
        /* CurseForge: only downloadable from its website. */
        website?: boolean;
    };

    type GameUpdateCheck = {
        updates: GameModUpdate[];
        checked: number;
        /* Mods that couldn't be matched to a site. */
        unknown: number;
        /* Nexus mods that can only be checked with a Nexus Mods key. */
        needsKey: number;
        error: string | null;
    };

    /* fits: whether what's inside looks like a mod for this game (null when it can't tell). */
    type GameDownload = { path: string; name: string; size: number; modified: string; installed: boolean; fits: boolean | null };

    type GameInstallResult = {
        mod?: { id: string; name: string };
        placed?: Record<string, number>;
        skipped?: { file: string; reason: string }[];
        notes?: string[];
        failed?: string;
        needsWebsite?: string | null;
        reason?: string;
        modId?: string;
    };

    type GameRemoteMod = {
        provider: "nexus" | "curseforge";
        id: string;
        name: string;
        summary: string;
        picture: string | null;
        author: string;
        downloads: number;
        endorsements: number | null;
        version: string;
        updated: string | null;
        adult: boolean;
        url: string | null;
        installable?: boolean;
    };

    type GameSearchPage = {
        total: number;
        totals?: { nexus?: number; curseforge?: number };
        pageCount?: number;
        mods: GameRemoteMod[];
        /* A site that couldn't be searched, while the other could. */
        warnings?: string[];
    };

    type GameModFile = {
        id: string;
        name: string;
        version: string;
        category: string;
        size: number;
        fileName: string;
        date: string;
        description: string;
    };

    type GameModDetails = Omit<GameRemoteMod, "adult"> & {
        html: string;
        images: string[];
        /* Whether a Nexus key is set (always true for CurseForge). */
        hasKey: boolean;
        /* Whether files download straight into the launcher. */
        premium: boolean;
        files: GameModFile[];
    };

    type GameNxmEvent = {
        status: "started" | "working" | "installed" | "failed";
        gameId?: GameId;
        modId?: string;
        name?: string;
        detail?: string;
        result?: GameInstallResult;
        error?: string;
        notes?: string[];
    };

    interface Window {
        gamesAPI: {
            list: () => Promise<GameSummary[]>;
            get: (id: GameId) => Promise<GameDetail>;

            mods: (id: GameId) => Promise<GameMod[]>;
            setEnabled: (id: GameId, key: string, enabled: boolean) => Promise<unknown>;
            remove: (id: GameId, key: string) => Promise<unknown>;

            downloads: (id: GameId) => Promise<GameDownload[]>;
            /* With no file, asks for one; null when that's cancelled. */
            install: (id: GameId, filePath?: string) => Promise<GameInstallResult | null>;

            chooseFolder: (id: GameId) => Promise<unknown>;
            forgetFolder: (id: GameId) => Promise<unknown>;
            chooseDocs: (id: GameId) => Promise<unknown>;
            openFolder: (id: GameId, which: "game" | "docs") => Promise<void>;

            launch: (id: GameId, options?: { safe?: boolean }) => Promise<{ how: string; safe: boolean }>;
            setSimsOptions: (options: { mods?: boolean; scripts?: boolean }) => Promise<{ mods: boolean; scripts: boolean } | null>;

            /* provider "any" (or none): every site the game's on, mixed. */
            search: (
                id: GameId,
                options: { provider?: "any" | "nexus" | "curseforge"; query?: string; sort?: string; page?: number; adult?: boolean }
            ) => Promise<GameSearchPage>;
            details: (id: GameId, provider: "nexus" | "curseforge", modId: string) => Promise<GameModDetails>;
            installRemote: (id: GameId, provider: "nexus" | "curseforge", modId: string, fileId: string | null, name: string) => Promise<GameInstallResult>;
            checkUpdates: (id: GameId) => Promise<GameUpdateCheck>;
            update: (id: GameId, key: string) => Promise<GameInstallResult>;
            undoUpdate: (id: GameId, key: string) => Promise<{ restored: string; version: string | null }>;
            nexusAccount: () => Promise<{ name: string; premium: boolean } | null>;
            openUrl: (url: string) => Promise<void>;

            onProgress: (callback: (data: { gameId: GameId; detail: string }) => void) => () => void;
            onNxm: (callback: (event: GameNxmEvent) => void) => () => void;
        };
    }
}
