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
            launchInstance(instance: any): Promise<any>;
            getInstancesStorage(): Promise<number>;

            // ---------- Minecraft ----------
            getMinecraftVersions(): Promise<any[]>;
            getFabricVersions(version: string): Promise<any[]>;
            getQuiltVersions(version: string): Promise<any[]>;
            getForgeVersions(version: string): Promise<any[]>;
            getNeoForgeVersions(version: string): Promise<any[]>;
            getLoaders(): Promise<{ id: string; name: string }[]>;

            // ---------- Projects ----------
            getProject(
                source: "modrinth" | "curseforge",
                id: string
            ): Promise<any>;

            // ---------- Search ----------
            browseCatalog(options: CatalogQuery): Promise<CatalogPage>;
            resolveProjectLink(link: object): Promise<{ source: "modrinth" | "curseforge"; id: string } | null>;

            // ---------- Skins ----------
            searchPlayers(query: string): Promise<PlayerSearchResult[]>;

        };

    }

}
