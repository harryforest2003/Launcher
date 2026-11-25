export {};

declare global {

    type PlayerSearchResult = {
        username: string;
        uuid: string;
        skin: string;
        slim: boolean;
        cape?: string;
    };

    interface Window {

        launcherAPI: {

            // ---------- Authentication ----------
            loginMicrosoft(): Promise<{ name: string; uuid: string; skin: string | null }>;

            // ---------- Instances ----------
            getInstances(): Promise<any[]>;
            /** As the signed-in account with this id, or the active one. */
            launchInstance(name: string, accountId?: string): Promise<{ launched: boolean; name: string; online: boolean; playerName: string; account: GamePlayer | null }>;
            getInstancesStorage(): Promise<number>;

            // ---------- Minecraft ----------
            getMinecraftVersions(): Promise<any[]>;
            getFabricVersions(version: string): Promise<any[]>;
            getQuiltVersions(version: string): Promise<any[]>;
            getForgeVersions(version: string): Promise<any[]>;
            getNeoForgeVersions(version: string): Promise<any[]>;
            getLoaders(): Promise<{ id: string; name: string }[]>;
            /** Any loader's builds for a Minecraft version, newest first. */
            getLoaderVersions(loader: string, version: string): Promise<{ version: string; stable: boolean }[]>;
            /** The Minecraft versions a loader made for old versions works with; null when it follows every release. */
            getLoaderGameVersions(loader: string): Promise<string[] | null>;

            // ---------- Projects ----------
            getProject(
                source: "modrinth" | "curseforge",
                id: string
            ): Promise<any>;

            /** What one modpack version contains, read from the pack's own file list. */
            packContents(
                source: "modrinth" | "curseforge",
                projectId: string,
                versionId: string
            ): Promise<PackContents>;

            // ---------- Search ----------
            browseCatalog(options: CatalogQuery): Promise<CatalogPage>;
            resolveProjectLink(link: object): Promise<{ source: "modrinth" | "curseforge"; id: string } | null>;

            // ---------- Skins ----------
            searchPlayers(query: string): Promise<PlayerSearchResult[]>;

        };

    }

}
