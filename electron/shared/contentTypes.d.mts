/* The real bridges are loosely typed JSON over IPC, and so are these projects. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const CF_CLASS_IDS: Record<string, number>;
export const CF_LOADER_TYPES: Record<string, number>;
export const CONTENT_FOLDERS: Record<string, string>;
export const CONTENT_LABELS: Record<string, string>;

export function usesLoader(type: string): boolean;
export function curseForgeType(classId: number): string;
export function modrinthType(project: any): string;
export function targetTypeFor(type: string, fileName: string): string;
