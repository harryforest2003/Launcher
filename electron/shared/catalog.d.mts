/* The real bridges are loosely typed JSON over IPC, and so are these responses. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const PAGE_SIZE: number;
export const CURSEFORGE_LIMIT: number;

export function isSameProject(a: object, b: object): boolean;

export function createCatalog(api: {
  modrinth(path: string): Promise<any>;
  curseforge(path: string): Promise<any>;
}): {
  browse(options: CatalogQuery): Promise<CatalogPage>;
  resolveProjectLink(link: object): Promise<{ source: "modrinth" | "curseforge"; id: string } | null>;
  reset(): void;
};
