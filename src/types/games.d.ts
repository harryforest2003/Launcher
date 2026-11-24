export {};

declare global {
    /** The six with rules of their own ("sims4", "gtav", "skyrimse", "fallout4", "cyberpunk2077", "stardew"), More Games' ("eldenring"...) and added ones ("custom-..."). */
    type GameId = string;

    /** What a pending Play is doing, sent while it runs. */
    type GameLaunchProgress = { gameId: GameId; stage: "checking" | "backup" | "starting" };

    /** How a game signs in. name: the last-used local Steam profile, not a verified session. */
    type GameStoreAccount = {
        store: "steam" | "ea" | "gog" | "epic" | "rockstar" | null;
        storeName: string | null;
        name: string | null;
        /** One plain sentence: who signs in, or where to sign in. */
        how: string;
    };

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
        /** Why this computer can't run the game found (an Apple-silicon-only app on an Intel Mac); its mods can still be managed. */
        cantRun?: string | null;
        nexus: string | null;
        curseforge: number | null;
        modCount: number;
        lastPlayed?: string | null;
        /* Set when the game has updated since it was last played from here. */
        updated: { from: string | null; to: string | null } | null;
        /**
         * How the game's mods load in an order that matters, if they do: Bethesda plugins
         * (plugins.txt), Cyberpunk's modlist.txt, RimWorld's mod list or Baldur's Gate 3's.
         */
        loadOrder?: GameOrderKind | null;
        /** Every other game: mods go in one folder, chosen in its Settings. */
        generic?: boolean;
        /** Kept from a search, so it can be taken off again. */
        custom?: boolean;
        /** Found on this computer (Steam, Epic) with no page of its own: built from what's here. */
        detected?: boolean;
        /** Opened from the search and not kept yet. */
        visiting?: boolean;
        modsDir?: string | null;
        modsChosen?: boolean;
        /** What its Settings chose to start it with. */
        launchExe?: string | null;
        steamAppId?: string | null;
        /** A game that isn't out on PC (GTA 6): why. */
        notOnPC?: string | null;
        art?: string | null;
    };

    /* A game's price on Steam, in the player's own currency. */
    type GamePrice = { text: string; cents: number | null; was: string | null; discount: number; free: boolean };

    /* A game from Steam's store, the Steam games here, Nexus Mods and CurseForge. */
    type GameFound = {
        name: string;
        steamAppId: string | null;
        nexus: string | null;
        nexusGameId: number | null;
        nexusMods: number;
        curseforge: number | null;
        installed: boolean;
        art: string | null;
        artAlt: string | null;
        /** Its price on Steam; null when Steam doesn't sell it (or it isn't out). */
        price?: GamePrice | null;
        /** Whether Steam has it for Mac (null: not known). */
        mac?: boolean | null;
        /** The launcher's own game for it, when it already has one. */
        existing: string | null;
    };
    type GameFindSource = "all" | "steam" | "nexus" | "curseforge";
    /** price: "any", "free", "sale" or one of priceSteps' values; sort: popular, new, rated, price-asc, price-desc, or mods/name on a mod site's list. */
    type GameFindFilters = { price?: string; sort?: string; mac?: boolean; /** "with": games with mods on Nexus Mods or CurseForge; "none": the rest. */ mods?: "any" | "with" | "none" };
    type GameFindResult = {
        results: GameFound[];
        page: number;
        pageCount: number;
        total: number;
        /** With the mods filter, Steam's list is still being read: the total is "about" right, or there are "more". */
        approx?: "about" | "more" | null;
        warnings: string[];
        source?: GameFindSource;
        /** "steam" when a filter took the search to Steam's store. */
        via?: GameFindSource;
        /** Browsing every game: how many have mods (listed first) and how many Steam sells; a game in both is counted twice. */
        counts?: { modded: number; steam: number };
        /** Steam's price steps in the player's currency ("Under £4.00"). */
        priceSteps?: { value: string; label: string }[];
    };

    type GameNews = { id: string; title: string; date: string; summary: string; url: string };
    type GameDlc = { id: string; name: string; art: string | null; price: GamePrice | null; mac: boolean; released: string | null; url: string };
    /** A store that sells a game (from Wikidata, with GOG's and Steam's own prices). */
    type GameStoreLink = {
        store: "steam" | "gog" | "epic" | "microsoft" | "battlenet" | "itch" | "humble" | "site";
        label: string;
        url: string;
        price: GamePrice | null;
    };
    /** Where a game can be bought or downloaded, and what it runs on. pc: false when it has no PC version; null when not known. */
    type GameWhere = { stores: GameStoreLink[]; platforms: string[]; pc: boolean | null; steamAppId: string | null };
    /** A game's news and add-ons from Steam (empty without a Steam app number), and every store that sells it. */
    type GameStoreInfo = {
        steamAppId: string | null;
        price: GamePrice | null;
        news: GameNews[];
        dlc: GameDlc[];
        dlcCount: number;
        storeUrl: string | null;
        stores?: GameStoreLink[];
        platforms?: string[];
        pc?: boolean | null;
    };

    type GameStatus = { updates: number; requirements: number; loadOrder: number; crashes: number; health: number; clashes?: number };

    type GameDetail = GameSummary & {
        platform: string;
        version: string | null;
        lastPlayed: string | null;
        /* The Sims 4's own switches for custom content and script mods (null until it has an Options.ini). */
        simsOptions: { mods: boolean; scripts: boolean } | null;
        /* What The Sims 4 said went wrong since it was last played, naming the mods it could. */
        problems: { file: string; time: string; mods: string[]; line: string | null; kind?: "crash" | "error" | "outdated" }[];
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

    /* Where a mod comes from: Nexus Mods, CurseForge, or one of the other sites (sources/index.cjs). */
    type GameModProvider = "nexus" | "curseforge" | "thunderstore" | "modio" | "workshop" | "gamebanana" | "factorio" | "spacedock" | "beatmods" | "modworkshop" | "ficsit" | "vintagestory" | "contentdb" | "idgames";

    type GameModUpdate = {
        key: string;
        name: string;
        provider: GameModProvider;
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
        /* What the mod needs that isn't installed (fetched straight after). */
        missing?: GameRequirement[];
        /* A requirement's page on another site, opened. */
        opened?: string;
        /* A Workshop mod, opened in Steam to subscribe to (Steam installs it). */
        viaSteam?: boolean;
        /* What it needed from the same site, installed first. */
        requirements?: string[];
    };

    type GameRemoteMod = {
        provider: GameModProvider;
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

    type GameSaveBackup = { id: string; at: string; reason: string; size: number; files: number; from: string };

    type GamePlugin = {
        name: string;
        active: boolean;
        /* ESM or ESL: loaded before the rest. */
        master: boolean;
        light: boolean;
        masters: string[];
        problems: { kind: "missing" | "off" | "after"; master: string }[];
    };
    /* What fixing the load order changes: masters turned on, plugins that can't load turned off, and ones moved after what they need. */
    type GameLoadOrderFix = {
        turnOn: { name: string; for: string }[];
        /* Only plugins needing official DLC or Creation Club files the game doesn't have. */
        turnOff: { name: string; needs: string; missing: boolean; official?: boolean }[];
        moved: string[];
        /* Missing masters to get: the Nexus mod that has each, or a search for it. */
        get: GameRequirement[];
    };
    /* A plugin LOOT's rules move: its LOOT group, and the plugins its rules say it loads after. */
    type GameLootMove = { name: string; group: string; after: string[] };
    type GameLoadOrder = { fixed: string[]; plugins: GamePlugin[]; fix: GameLoadOrderFix };

    type GameOrderKind = "plugins" | "modlist" | "rimworld" | "bg3";
    /** One mod in a game's mod order. fixed: stays where it is (the game's own). */
    type GameOrderEntry = { id: string; name: string; note: string | null; active: boolean; fixed: boolean; problems: string[] };
    /**
     * The order for games other than Bethesda's. file: null until the game has made it.
     * toggles: mods can be turned on and off here. fix: what Fix would turn on and how many it'd move.
     */
    type GameModOrder = {
        kind: Exclude<GameOrderKind, "plugins">;
        file: string | null;
        toggles: boolean;
        entries: GameOrderEntry[];
        fix: { turnOn: string[]; moved: number };
    };

    type GameRequirement = {
        key: string;
        name: string;
        kind: "nexus" | "curseforge" | "web" | "search" | "master";
        modId: string | null;
        url: string | null;
        neededBy: string[];
        /* Sure enough to fetch without asking. */
        auto: boolean;
        note?: string;
        /* The exact file to get, when it's known (the one with a missing master). */
        fileId?: string | null;
        /* The master file it's got for. */
        master?: string;
        /* The game's own DLC or Creation Club: not on Nexus Mods. */
        official?: boolean;
    };

    type GameSet = { id: string; name: string; keys: string[] };

    /* Mods changing the same thing inside the game: tuning, a CC item, script modules (Sims), records (Skyrim, Fallout 4), redscript functions (Cyberpunk), loaded assets (Stardew). */
    type GameClash = {
        id: string;
        kind: "tuning" | "item" | "script" | "records" | "redscript" | "load";
        mods: { name: string; key: string }[];
        count: number;
        examples: string[];
        severity: "error" | "warn";
        /* Skyrim and Fallout 4: the plugin whose changes the game uses. */
        winner?: string;
        /* Marked fine: not shown or counted. */
        hidden?: boolean;
    };

    /* A Sims 4 package or script mod, for the CC browser. */
    type GameCC = { rel: string; key: string; name: string; folder: string; category: "Create a Sim" | "Build/Buy" | "Gameplay" | "Script" | "Other"; items: number; size: number; enabled: boolean; picture: boolean; owner: string | null; broken: boolean };

    /* Mods that have the same files, whose copies are used (live; "mixed" when it differs file to file), and which the rules pick. */
    type GameConflict = { id: string; mods: { id: string; name: string }[]; files: string[]; live: string; suggested: string; reason: string; chosen: boolean };

    /* Something the mod health check found: fix is the button's label, or null when it's fixed by hand. */
    type GameHealthIssue = { id: string; severity: "error" | "warn"; title: string; detail: string; files: string[]; fix: string | null };

    /* One thing on the download queue. */
    type GameQueueItem = {
        id: string;
        gameId: GameId;
        kind: "update" | "requirement" | "nexus-file";
        name: string;
        key?: string;
        modId?: string;
        fileId?: string;
        page?: string;
        status: "waiting" | "working" | "website" | "done" | "failed" | "skipped";
        detail?: string | null;
        error?: string | null;
    };
    type GameQueue = {
        items: GameQueueItem[];
        current: GameQueueItem | null;
        counts: { waiting: number; done: number; failed: number; skipped: number; total: number };
    };
    type GameQueueAdd = { gameId: GameId; kind: GameQueueItem["kind"]; name: string; key?: string; modId?: string; fileId?: string };

    type GameFinder = {
        active: boolean;
        phase?: "baseline" | "split" | "found" | "not-mods";
        round?: number;
        roundsLeft?: number;
        suspects?: string[];
        testing?: string[];
        off?: string[];
        found?: string | null;
        foundKey?: string | null;
        total?: number;
        keptOff?: string | null;
        backedUp?: GameSaveBackup | null;
    };

    /* Adult mods: offered only when Nexus says the account is age-verified. */
    type GameAdultStatus = { hasKey: boolean; verified: boolean; on: boolean; blur: boolean; error: string | null };

    type GameSearchPage = {
        total: number;
        totals?: Partial<Record<GameModProvider, number>>;
        pageCount?: number;
        mods: GameRemoteMod[];
        /* A site that couldn't be searched, while the other could. */
        warnings?: string[];
        /* Every site with mods for the game; ready false: it needs a key not added yet. */
        /* The sites with mods for this game; page is the game's own page there. */
        sources?: { id: GameModProvider; label: string; ready: boolean; needsKey?: string | null; page?: string | null }[];
    };

    type GameCollectionSummary = {
        slug: string;
        name: string;
        summary: string;
        picture: string | null;
        author: string;
        endorsements: number;
        downloads: number;
        updated: string | null;
        mods: number;
        size: number;
        revision: number | null;
        adult: boolean;
        url: string;
    };
    type GameCollection = Omit<GameCollectionSummary, "mods" | "updated" | "adult"> & {
        description: string;
        installationInfo: string;
        /* installed: "same" (this file), "other" (another version of the mod), or "no". */
        files: { modId: string; fileId: string; name: string; fileName: string; version: string; optional: boolean; installed: "same" | "other" | "no" }[];
        /* Things it needs from other sites. */
        external: { name: string; url: string; optional: boolean }[];
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
        /* A description written in Markdown (Thunderstore, Factorio, SpaceDock, BeatMods), shown in place of html. */
        markdown?: string;
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
            /** source: every game with mods (all), Steam's whole store, or one mod site's list. */
            findGames: (query: string, page?: number, source?: GameFindSource, filters?: GameFindFilters) => Promise<GameFindResult>;
            /** Opens any game's page, built on the spot when it has none. -> the game's id. */
            openGame: (entry: Partial<GameFound>) => Promise<string>;
            /** Opens a game's Steam store page (in Steam when it's installed). */
            getOnSteam: (steamAppId: string) => Promise<void>;
            /** Steam news and add-ons (with today's prices) for a game. */
            storeInfo: (id: GameId) => Promise<GameStoreInfo>;
            /** Where each game can be bought or downloaded (up to 40 names; names with no answer are left out). */
            whereToGet: (names: string[]) => Promise<Record<string, GameWhere>>;
            removeGame: (id: GameId) => Promise<void>;
            chooseModsDir: (id: GameId) => Promise<unknown>;
            forgetModsDir: (id: GameId) => Promise<unknown>;
            chooseLaunch: (id: GameId) => Promise<unknown>;
            forgetLaunch: (id: GameId) => Promise<unknown>;
            /** Pictures for games without one built in: { id: url | null }. */
            art: (ids: GameId[]) => Promise<Record<string, string | null>>;
            /* For Home: what needs looking at. */
            status: (id: GameId) => Promise<GameStatus>;
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
            openFolder: (id: GameId, which: "game" | "docs" | "mods") => Promise<void>;

            onLaunchProgress?: (callback: (progress: GameLaunchProgress) => void) => () => void;
            launch: (id: GameId, options?: { safe?: boolean }) => Promise<{ how: string; safe: boolean; backedUp: GameSaveBackup | null; backupError: string | null }>;
            setSimsOptions: (options: { mods?: boolean; scripts?: boolean }) => Promise<{ mods: boolean; scripts: boolean } | null>;

            /* provider "any" (or none): every site the game's on, mixed. */
            search: (
                id: GameId,
                options: { provider?: "any" | GameModProvider; query?: string; sort?: string; page?: number; adult?: boolean }
            ) => Promise<GameSearchPage>;
            details: (id: GameId, provider: GameModProvider, modId: string) => Promise<GameModDetails>;
            collections: (id: GameId, options: { query?: string; sort?: string; page?: number }) => Promise<{ total: number; collections: GameCollectionSummary[] }>;
            collection: (id: GameId, slug: string) => Promise<GameCollection>;
            /* Puts the chosen files on the download queue. */
            installCollection: (id: GameId, slug: string, fileIds: string[]) => Promise<{ added: number; external: GameCollection["external"] }>;
            installRemote: (id: GameId, provider: GameModProvider, modId: string, fileId: string | null, name: string) => Promise<GameInstallResult>;
            checkUpdates: (id: GameId) => Promise<GameUpdateCheck>;
            update: (id: GameId, key: string) => Promise<GameInstallResult>;
            undoUpdate: (id: GameId, key: string) => Promise<{ restored: string; version: string | null }>;
            nexusAccount: () => Promise<{ name: string; premium: boolean } | null>;
            /** Who the game signs in as: Steam's signed-in player (display name only), or which app handles sign-in. */
            account: (id: GameId) => Promise<GameStoreAccount>;
            openAccount: (provider: NonNullable<GameStoreAccount["store"]>) => Promise<void>;
            /* recheck: ask Nexus again (after verifying on the website). */
            adultStatus: (recheck?: boolean) => Promise<GameAdultStatus>;
            setAdult: (on: boolean) => Promise<GameAdultStatus>;

            saves: (id: GameId) => Promise<{ dir: string | null; backups: GameSaveBackup[] }>;
            backupSaves: (id: GameId) => Promise<GameSaveBackup>;
            restoreSaves: (id: GameId, backupId: string) => Promise<GameSaveBackup>;
            deleteBackup: (id: GameId, backupId: string) => Promise<void>;
            chooseSaves: (id: GameId) => Promise<string | null>;
            forgetSaves: (id: GameId) => Promise<void>;
            openSaves: (id: GameId) => Promise<void>;

            loadOrder: (id: GameId) => Promise<GameLoadOrder>;
            setLoadOrder: (id: GameId, entries: { name: string; active: boolean }[]) => Promise<GameLoadOrder>;
            fixLoadOrder: (id: GameId) => Promise<GameLoadOrder & { done: GameLoadOrderFix }>;
            /* Sorting by LOOT's community masterlist: what would move, and why. */
            lootPlan: (id: GameId) => Promise<{ moved: GameLootMove[]; fetchedAt: number; loops: string[] }>;
            /* previous: the order before, for Undo. */
            lootSort: (id: GameId) => Promise<GameLoadOrder & { previous: { name: string; active: boolean }[]; moved: GameLootMove[] }>;
            modOrder: (id: GameId) => Promise<GameModOrder>;
            setModOrder: (id: GameId, entries: { id: string; active: boolean }[]) => Promise<GameModOrder>;
            fixModOrder: (id: GameId) => Promise<GameModOrder & { done?: { turnOn: string[]; moved: number } }>;

            requirements: (id: GameId) => Promise<GameRequirement[]>;
            requirementsBefore: (id: GameId, modId: string) => Promise<GameRequirement[]>;
            getRequirement: (id: GameId, key: string) => Promise<GameInstallResult>;

            sets: (id: GameId) => Promise<GameSet[]>;
            saveSet: (id: GameId, set: { id?: string | null; name: string }) => Promise<GameSet[]>;
            deleteSet: (id: GameId, setId: string) => Promise<GameSet[]>;
            setMember: (id: GameId, setId: string, key: string, member: boolean) => Promise<GameSet[]>;
            useSet: (id: GameId, setId: string) => Promise<{ changed: number }>;

            finder: (id: GameId) => Promise<GameFinder>;
            finderStart: (id: GameId) => Promise<GameFinder>;
            finderAnswer: (id: GameId, happened: boolean) => Promise<GameFinder>;
            finderStop: (id: GameId, keepOff?: string | null) => Promise<GameFinder>;
            openUrl: (url: string) => Promise<void>;

            clashes: (id: GameId) => Promise<GameClash[]>;
            /* Marks a conflict fine (or not; "*" with false shows them all again). */
            hideClash: (id: GameId, clashId: string, hidden: boolean) => Promise<GameClash[]>;
            /* Skyrim and Fallout 4: loads one plugin after another, so its changes win. */
            clashLoadAfter: (id: GameId, name: string, after: string) => Promise<GameClash[]>;
            ccList: () => Promise<GameCC[]>;
            /* Pictures by rel path: the picture, and its transparency when it has one. */
            ccPictures: (rels: string[]) => Promise<Record<string, { src: string; alpha: string | null } | null>>;
            /* Shows a CC file in its folder. */
            ccReveal: (rel: string) => Promise<void>;
            conflicts: (id: GameId) => Promise<GameConflict[]>;
            /* modId null: back to the rules' choice. */
            chooseConflict: (id: GameId, groupId: string, modId: string | null) => Promise<GameConflict[]>;
            health: (id: GameId) => Promise<GameHealthIssue[]>;
            healthFix: (id: GameId, issueId: string) => Promise<{ done: string }>;
            queue: () => Promise<GameQueue>;
            /* -> how many were added (ones already waiting aren't added twice). */
            queueAdd: (items: GameQueueAdd[]) => Promise<number>;
            queueControl: (action: "skip" | "stop" | "open" | "clear" | "retry") => Promise<GameQueue>;
            onQueue: (callback: (queue: GameQueue) => void) => () => void;
            onModsChanged: (callback: (data: { gameId: GameId }) => void) => () => void;

            onProgress: (callback: (data: { gameId: GameId; detail: string }) => void) => () => void;
            onNxm: (callback: (event: GameNxmEvent) => void) => () => void;
        };
    }
}
