export {};

declare global {

    type DetectedGame = {
        id: string;
        name: string;
        installPath: string | null;
        modDir: string | null;
        modDirExists: boolean;
        source: string;
        providers: Record<string, unknown>;
        modExtensions: string[];
        notes: string | null;
        windowsOnlyModding: boolean;
        managedByInstances: boolean;
        availableProviders: {
            id: string;
            label: string;
            ready: boolean;
        }[];
    };

    type InstalledMod = {
        id: string;
        name: string;
        relativePath: string;
        kind: "file" | "folder";
        size: number;
        modified: string | null;
        enabled: boolean;
        source: string | null;
        projectId: string | null;
        installedAt: string | null;
    };

    type RemoteMod = {
        provider: string;
        providerLabel: string;
        id: string;
        name: string;
        summary: string;
        author: string;
        downloads: number;
        icon: string | null;
        url: string | null;
        updated: string | null;
        installable: boolean;
    };

    type ModFile = {
        id: string;
        name: string;
        fileName: string;
        size: number;
        date: string;
        downloadUrl: string | null;
    };

    interface Window {

        modAPI: {
            getGames(opts?: { refresh?: boolean }): Promise<DetectedGame[]>;
            refreshGames(): Promise<number>;

            list(gameId: string): Promise<InstalledMod[]>;

            setEnabled(
                gameId: string,
                relativePath: string,
                enabled: boolean
            ): Promise<{ relativePath: string; enabled: boolean }>;

            remove(
                gameId: string,
                relativePath: string
            ): Promise<{ deleted: string }>;

            openFolder(gameId: string): Promise<string>;

            search(
                gameId: string,
                query: string,
                provider?: string
            ): Promise<{ results: RemoteMod[]; warnings: string[] }>;


            install(payload: {
                gameId: string;
                provider: string;
                projectId: string;
                fileId?: string;
                name: string;
            }): Promise<{ installed: string[]; count: number; name: string }>;

            installFromFile(
                gameId: string,
                filePaths?: string[]
            ): Promise<{
                installed: string[];
                count: number;
                errors?: string[];
                canceled?: boolean;
            }>;

            openUrl(url: string): Promise<void>;

            getSettings(): Promise<{
                hasNexusKey: boolean;
                customGames: string[];
            }>;

            onProgress(
                callback: (data: {
                    gameId: string;
                    projectId: string;
                    percent: number;
                }) => void
            ): () => void;
        };

    }

}
