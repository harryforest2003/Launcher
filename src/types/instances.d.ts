export {};

declare global {

    type Instance = {
        name: string;
        version: string;
        loader: string;
        loaderVersion: string;
        ram: number;
        created?: string;
        lastPlayed?: string;
        gameDirectory: string;
        versionId?: string;
        vanillaId?: string;
        assetIndex?: string;
        installed: boolean;
        running?: boolean;
        jvmArgs?: string;
        javaPath?: string;
        notes?: string;
        error?: string;
        folder?: string;
    };

    type MinecraftAccount = { name: string; uuid: string; skin: string | null; savedAt: string; active: boolean };

    type InstanceWorld = {
        /** The folder in saves/, which is how a world is named to the launcher. */
        folder: string;
        name: string;
        lastPlayed: string;
        gameMode: string | null;
        hardcore: boolean;
        cheats: boolean;
        version: string | null;
        size: number;
        icon: string | null;
    };

    type InstanceScreenshot = {
        fileName: string;
        taken: string;
        size: number;
        width: number;
        height: number;
        thumbnail: string | null;
    };

    type ContentType = "mod" | "resourcepack" | "shader" | "datapack";

    type InstanceLog = {
        source: "live" | "file" | "none";
        running: boolean;
        startedAt: number | null;
        endedAt: number | null;
        exitCode: number | null;
        lines: string[];
    };

    /** One file's update state; name and icon come from Modrinth for files the launcher didn't install. */
    type UpdateStatus = {
        state: "update" | "current" | "unknown";
        current?: string | null;
        latest?: string;
        name?: string;
        iconUrl?: string;
        /** Who publishes it on Modrinth. */
        author?: string;
    };

    type ModUpdate = {
        key: string;
        type: ContentType;
        fileName: string;
        newFileName: string;
        enabled: boolean;
        name: string;
        iconUrl: string | null;
        source: "modrinth" | "curseforge";
        projectId: string;
        current: string;
        latest: string;
    };

    type UpdateResult = {
        updated: { name: string; from: string; to: string }[];
        /** Left as they were, because the new version wouldn't work with the rest. */
        skipped: { name: string; from: string; to: string; reasons: string[] }[];
        failed: { name: string; reason: string }[];
        /** What can be undone, if anything changed. */
        batch: { id: string; count: number } | null;
    };

    type ContentVersion = {
        id: string;
        number: string;
        title: string;
        channel: "release" | "beta" | "alpha";
        published: string;
        fileName: string;
        size: number;
        installed: boolean;
    };

    /** What adding a mod also added, and what it needs that couldn't be added. */
    type DependencyCheck = {
        dependencies: string[];
        missingDependencies: { id: string; neededBy: string[] }[];
        disabledDependencies: { name: string; neededBy: string }[];
    };

    type CrashCause = {
        kind: string;
        /** What went wrong, in plain words. */
        title: string;
        detail: string;
        /** Only when the evidence points to one. */
        fix: string | null;
        /** The button that does the fix, if there is one. */
        action: "repair" | "settings" | "add-content" | null;
        /** The mods to blame (empty when it isn't a mod's fault). */
        mods: { fileName: string; name: string; enabled: boolean }[];
        /** The exact line that shows it, and where: the log (index into its lines), the crash report, or Java's crash file. */
        evidence: { text: string; source: "log" | "report" | "java"; index: number } | null;
    };

    type CrashHelp =
        | { crashed: false }
        | {
              crashed: true;
              summary: string;
              causes: CrashCause[];
              exitCode: number | null;
              description: string | null;
              reportFile: string | null;
              jvmCrashFile: string | null;
          };

    /** Which item a change applies to. A data pack can be in a world, or in none yet. */
    type ContentRef = {
        type: ContentType;
        world?: string | null;
        fileName: string;
    };

    type InstanceContent = Record<ContentType, InstanceMod[]> & {
        worlds: string[];
    };

    // The player's own tokens, set in Settings. CurseForge's key is the launcher's, so
    // pages only learn whether it's there.
    type ApiKeyName = "modrinth" | "nexus" | "github";
    type ApiKeyStatuses = Record<ApiKeyName | "curseforge", ApiKeyStatus>;

    type ApiKeyStatus = {
        set: boolean;
        fromEnvironment: boolean;
        // A masked copy to recognise it by, never the key itself.
        hint?: string | null;
    };

    type InstanceMod = {
        type: ContentType;
        world: string | null;
        kind: "file" | "folder";
        fileName: string;
        actualFileName: string;
        name: string;
        enabled: boolean;
        size: number;
        modified: string | null;
        source: string | null;
        projectId: string | null;
        versionNumber: string | null;
        installedAt: string | null;
        iconUrl: string | null;
    };

    type SearchableMod = {
        source: "modrinth" | "curseforge";
        type: string;
        id: string;
        slug: string;
        name: string;
        summary: string;
        author: string;
        downloads: number;
        icon: string | null;
        url: string | null;
        installable: boolean;
        date?: string | null;
    };

    /** One site's listing of a project. */
    type CatalogSource = {
        source: "modrinth" | "curseforge";
        id: string;
        downloads: number;
        installable: boolean;
        url: string | null;
    };

    /** A project, which can be listed on both sites. */
    type CatalogItem = SearchableMod & { sources: CatalogSource[] };

    type CatalogQuery = {
        query?: string;
        type?: string;
        mcVersion?: string;
        loader?: string;
        source?: string;
        sort?: string;
        page?: number;
    };

    type CatalogPage = {
        items: CatalogItem[];
        page: number;
        pageCount: number;
        pageSize: number;
        totals: { modrinth: number; curseforge: number; curseforgeCapped: boolean };
        warnings: string[];
    };

    type ImportCandidate = {
        id: string;
        launcher: string;
        launcherLabel: string;
        name: string;
        mcVersion: string | null;
        floatingVersion?: string | null;
        loader: string;
        loaderVersion: string;
        gameDir: string;
        sourcePath: string;
        modCount?: number;
        needsVersion?: boolean;
    };

    type ModpackInfo = {
        format: "modrinth" | "curseforge";
        name: string;
        packVersion: string;
        mcVersion: string | null;
        loader: string;
        loaderVersion: string;
        fileCount: number;
        recommendedRam: number | null;
    };

    type CloudFolder = {
        id: string;
        label: string;
        path: string;
    };

    type CloudBackup = {
        file: string;
        size: number;
        modified: string | null;
    };

    type CloudInstance = CloudBackup & {
        name: string;
        /** The one before this, kept in case this one saved something already broken. */
        previous: CloudBackup | null;
        /** Listed in the cloud folder, but not on this device yet. */
        notDownloaded: boolean;
    };

    type LauncherSettings = {
        defaultRam: number;
        javaPath: string;
        jvmArgs: string;
        closeOnLaunch: boolean;
        showSnapshots: boolean;
        cloudFolder: string;
        downloadConcurrency: number;
        system: {
            totalRamGb: number;
            maxRecommendedGb: number;
            platform: string;
            arch: string;
        };
    };

    // A project added to every new instance.
    type StarterMod = {
        source: "modrinth" | "curseforge";
        projectId: string;
        name: string;
        type: "mod" | "resourcepack" | "shader" | "datapack";
        enabled: boolean;
    };

    // What happened to the starter mods when an instance was made.
    type StarterSummary = {
        added: string[];
        dependencies: string[];
        unavailable: string[];
        failed: { name: string; reason: string }[];
    };

    type InstallProgress = {
        name: string;
        stage: string;
        percent: number;
        detail?: string;
    };

    type SkinProfile = {
        name: string;
        uuid: string;
        skin: { url: string; slim: boolean } | null;
        capes: { id: string; name: string; url: string | null; active: boolean }[];
    };

    type PickedSkin = { id: string; name: string; dataUrl: string };

    type GitHubAsset = { name: string; size: number; url: string; digest: string | null };

    type GitHubRelease = { tag: string; name: string; published: string; prerelease: boolean; assets: GitHubAsset[] };

    type SavedSkin = { id: string; name: string; slim: boolean; savedAt: string; dataUrl: string };

    interface Window {
        blockbenchAPI: {
            /** False until Blockbench has been built into the launcher. */
            available(): Promise<boolean>;
            /** Starts Blockbench in the background, so opening something is instant. */
            prepare(): Promise<void>;
            /**
             * Resolves when the editor closes. Each Save goes into Saved skins, over savedId if
             * given, or as a copy. Gives that saved skin, or null if nothing was saved.
             */
            editSkin(skin: string, slim: boolean, name: string, savedId?: string): Promise<(SavedSkin & { updated: boolean }) | null>;
            /** Where the open editor goes, in window coordinates. */
            setBounds(rect: { x: number; y: number; width: number; height: number }): Promise<void>;
            save(): Promise<void>;
            /** False if the person chose to keep editing. */
            close(): Promise<boolean>;
            onSaved(callback: (message: string) => void): () => void;
        };

        skinAPI: {
            /** Null when nobody is signed in. */
            profile(): Promise<SkinProfile | null>;
            applyUrl(url: string, slim: boolean): Promise<SkinProfile>;
            pickFile(): Promise<PickedSkin | null>;
            upload(id: string, slim: boolean): Promise<SkinProfile>;
            reset(): Promise<SkinProfile>;
            setCape(capeId: string | null): Promise<SkinProfile>;
            download(url: string, name: string): Promise<string | null>;
            saved(): Promise<SavedSkin[]>;
            /** From one of: a texture address, a picked file, or another saved skin. */
            save(request: {
                url?: string;
                pickedId?: string;
                savedId?: string;
                name: string;
                slim: boolean;
            }): Promise<SavedSkin[]>;
            useSaved(id: string, slim?: boolean): Promise<SkinProfile>;
            deleteSaved(id: string): Promise<SavedSkin[]>;
        };


        instanceAPI: {
            list(): Promise<Instance[]>;
            get(name: string): Promise<Instance>;

            create(config: {
                name: string;
                version: string;
                loader?: string;
                loaderVersion?: string;
                ram?: number;
                jvmArgs?: string;
                // Defaults to true.
                starterMods?: boolean;
            }): Promise<Instance & { starter: StarterSummary | null }>;

            starterModsList(): Promise<StarterMod[]>;
            starterModsSave(list: StarterMod[]): Promise<StarterMod[]>;
            starterModsAdd(project: Omit<StarterMod, "enabled">): Promise<StarterMod[]>;
            starterModsReset(): Promise<StarterMod[]>;

            repair(name: string): Promise<Instance>;
            remove(name: string): Promise<{ deleted: string }>;

            launch(name: string): Promise<{
                launched: boolean;
                name: string;
                pid: number;
                online: boolean;
                playerName: string;
            }>;

            stop(name: string): Promise<{ stopped: string }>;
            openFolder(name: string): Promise<string>;
            /** Worlds in the instance, most recently played first. */
            worlds(name: string): Promise<InstanceWorld[]>;
            /** Screenshots, newest first, with small previews. */
            screenshots(name: string): Promise<InstanceScreenshot[]>;
            /** open, show (in Finder or the file manager), trash (to the Bin), or folder (all of that kind). */
            fileAction(name: string, request: { kind: "world" | "screenshot"; name?: string; action: "open" | "show" | "trash" | "folder" }): Promise<void>;
            /** A copy under a new name, without its logs or play history. */
            duplicate(name: string, newName: string): Promise<Instance>;


            content(name: string): Promise<InstanceContent>;

            contentToggle(
                name: string,
                item: ContentRef,
                enabled: boolean
            ): Promise<{ fileName: string; enabled: boolean }>;

            contentDelete(
                name: string,
                item: ContentRef
            ): Promise<{ deleted: string }>;

            copyDatapack(
                name: string,
                fileName: string,
                world: string
            ): Promise<{ fileName: string; world: string }>;

            githubReleases(input: string, type: string): Promise<{ repo: string; releases: GitHubRelease[] }>;
            /** Installs, unless the file doesn't fit or can't be checked; then it says why. */
            githubInstall(request: {
                name: string;
                repo: string;
                tag: string;
                asset: GitHubAsset;
                type: string;
                world?: string;
                force?: boolean;
            }): Promise<
                | { needsConfirm: true; reason: string }
                | {
                      installed: { fileName: string; name: string; type: ContentType; world: string | null; folder: string } & Partial<DependencyCheck>;
                  }
            >;

            modSearch(
                name: string,
                options: { query?: string; type?: string; source?: string; page?: number }
            ): Promise<CatalogPage>;

            modInstall(payload: {
                name: string;
                source: string;
                projectId: string;
                modName: string;
                iconUrl?: string | null;
                type?: ContentType;
                world?: string;
            }): Promise<{
                fileName: string;
                name: string;
                type: ContentType;
                world: string | null;
                folder: string;
            } & DependencyCheck>;

            update(
                name: string,
                patch: Partial<{
                    ram: number;
                    jvmArgs: string;
                    javaPath: string;
                    notes: string;
                }>
            ): Promise<Instance>;

            installModpack(payload: {
                source: string;
                projectId: string;
                fileId?: string;
                name?: string;
            }): Promise<Instance & {
                pack: {
                    name: string;
                    version: string;
                    fileCount: number;
                    blocked: unknown[];
                    failed: number;
                };
            }>;

            scanLaunchers(): Promise<ImportCandidate[]>;

            pickFolder(): Promise<ImportCandidate | null>;

            pickZip(): Promise<
                | { kind: "modpack"; file: string; info: ModpackInfo }
                | { kind: "export"; file: string; info: Instance }
                | null
            >;

            importInstance(payload: {
                entry: ImportCandidate;
                name?: string;
                version?: string;
            }): Promise<Instance>;

            importModpackFile(
                file: string,
                name?: string
            ): Promise<Instance & { pack: { name: string; blocked: unknown[]; failed: number } }>;

            cloudDetect(): Promise<CloudFolder[]>;
            cloudPickFolder(): Promise<string | null>;
            cloudSetFolder(folder: string): Promise<string>;

            cloudList(): Promise<{
                folder: string;
                instances: CloudInstance[];
            }>;

            cloudExport(name: string): Promise<{
                path: string;
                files: number;
                bytes: number;
            }>;

            cloudImport(file: string): Promise<Instance>;

            getSettings(): Promise<LauncherSettings>;
            setSettings(patch: Partial<LauncherSettings>): Promise<LauncherSettings>;
            pickJava(): Promise<string | null>;
            /** The Java versions automatic Java has downloaded. */
            javaRuntimes(): Promise<{ component: string; majorVersion: number; version: string | null }[]>;

            getApiKeys(): Promise<ApiKeyStatuses>;
            setApiKey(name: ApiKeyName, value: string | null): Promise<ApiKeyStatuses>;

            getAccount(): Promise<{
                name: string;
                uuid: string;
                skin: string | null;
                savedAt: string;
            } | null>;

            clearAccount(): Promise<null>;
            /** Every signed-in account, without tokens; one is active. */
            listAccounts(): Promise<MinecraftAccount[]>;
            switchAccount(uuid: string): Promise<MinecraftAccount[]>;
            /** Signs one account out. */
            removeAccount(uuid: string): Promise<MinecraftAccount[]>;
            onAccountsChanged(cb: (accounts: MinecraftAccount[]) => void): () => void;

            onProgress(cb: (p: InstallProgress) => void): () => void;
            /** Asks where to save it, then writes a Modrinth modpack (.mrpack). Null if cancelled. */
            exportModpack(name: string, options: { worlds?: boolean; options?: boolean }): Promise<{ file: string; bytes: number; linked: number; included: string[]; configFiles: number } | null>;
            /** Newer builds of its mods, resource packs and shaders, for its version and loader. */
            /** Each item's own icon (as a small data URL) and the authors it names, keyed like "mod//file.jar". */
            contentDetails(name: string): Promise<Record<string, { icon: string | null; authors: string[] }>>;
            /** Every mod, resource pack and shader checked for a newer build; status is keyed "mod/file.jar". */
            checkUpdates(name: string): Promise<{ checked: number; identified: number; updates: ModUpdate[]; status: Record<string, UpdateStatus> }>;
            /** Installs updates from the latest check, by their keys. */
            /** Updates that wouldn't work with the rest of the instance are left out, in skipped. */
            applyUpdates(name: string, keys: string[]): Promise<UpdateResult & DependencyCheck>;
            /** Every version of one item ("mod/file.jar") that works on this instance, newest first. */
            versions(name: string, key: string): Promise<{ name: string; versions: ContentVersion[] }>;
            /** One version's changelog as plain text ("" if none). */
            versionChangelog(name: string, key: string, versionId: string): Promise<string>;
            /** Installs that version, newer or older; without force, says why it wouldn't work instead. */
            installVersion(
                name: string,
                key: string,
                versionId: string,
                force?: boolean
            ): Promise<{ needsConfirm: true; problems: string[] } | (UpdateResult & DependencyCheck & { needsConfirm?: undefined })>;
            /** The latest change to the instance's content that can be undone. */
            lastUpdate(name: string): Promise<{ id: string; time: string; names: string[] } | null>;
            undoUpdate(name: string): Promise<{ restored: { name: string; version: string }[] }>;
            /** Chooses a Java for this instance alone. Null if cancelled. */
            pickInstanceJava(name: string): Promise<string | null>;
            /** The Java automatic would use, and whether it has been downloaded. */
            javaInfo(name: string): Promise<{ component: string; majorVersion: number; downloaded: boolean }>;
            /** The latest run: this session's output, or the log Minecraft wrote last time. */
            log(name: string): Promise<InstanceLog>;
            /** Why the latest run crashed, and which mods may be to blame. */
            crashHelp(name: string): Promise<CrashHelp>;
            /** A crash report or Java crash file in its default app, or the logs folder if none. */
            openLogFile(name: string, file?: string): Promise<void>;
            onLog(cb: (d: { name: string; text: string }) => void): () => void;
            onExit(cb: (d: { name: string; code: number }) => void): () => void;
        };

    }

}
