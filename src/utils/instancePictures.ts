import { useEffect, useSyncExternalStore } from "react";

/*
 * Each instance's own picture, read once and shared by every place that shows it, so a
 * new one shows up everywhere at once. null means it has none (the pattern is shown).
 */

const pictures = new Map<string, string | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(name: string) {
  if (pictures.has(name) || loading.has(name) || !window.instanceAPI?.picture) return;
  loading.add(name);
  window.instanceAPI
    .picture(name)
    .then((picture) => pictures.set(name, picture ?? null))
    .catch(() => pictures.set(name, null))
    .finally(() => {
      loading.delete(name);
      emit();
    });
}

/** The instance's picture as a data URL, or null while loading or when it has none. */
export function useInstancePicture(name: string | null) {
  const picture = useSyncExternalStore(subscribe, () => (name ? (pictures.get(name) ?? null) : null));
  useEffect(() => {
    if (name) load(name);
  }, [name]);
  return picture;
}

/** After a picture is chosen or removed: every place showing it updates. */
export function setInstancePicture(name: string, picture: string | null) {
  pictures.set(name, picture);
  emit();
}

const SIZE = 256;

/*
 * A picture file cut to a square from its middle and made 256 px (smaller ones keep their
 * size), as a PNG data URL. Anything the page can show works: PNG, JPEG, WebP, GIF, BMP.
 */
export async function squarePicture(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't a picture the launcher can read.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The picture couldn't be drawn.");
  // Small pixel art stays sharp; photos are smoothed.
  context.imageSmoothingEnabled = side > 128;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

/*
 * A new modpack instance takes its pack's icon as its picture, the way other launchers show
 * a pack's own art. Only when the instance has no picture yet, and quietly: a missing or
 * unreadable icon just leaves the pattern.
 */
export async function adoptPackPicture(name: string, iconUrl: string | null | undefined) {
  if (!iconUrl || !/^https:\/\//.test(iconUrl)) return;
  try {
    if (await window.instanceAPI.picture(name)) return;
    const data = await window.instanceAPI.downloadPicture(iconUrl);
    const blob = await (await fetch(data)).blob();
    setInstancePicture(name, await window.instanceAPI.setPicture(name, await squarePicture(blob)));
  } catch {
    // The pattern made from the name stays.
  }
}

const backfilled = new Set<string>();

/*
 * Instances made from a Modrinth or CurseForge pack before pack icons were kept: each one
 * without a picture takes its pack's icon, once per session.
 */
export function backfillPackPictures(instances: { name: string; modpack?: { source: "modrinth" | "curseforge"; projectId: string } }[]) {
  for (const instance of instances) {
    const pack = instance.modpack;
    if (!pack?.projectId || backfilled.has(instance.name)) continue;
    backfilled.add(instance.name);
    if (pictures.get(instance.name)) continue;
    void window.launcherAPI
      .getProject(pack.source, pack.projectId)
      .then((project: { icon?: string | null } | null) => adoptPackPicture(instance.name, project?.icon))
      .catch(() => {});
  }
}
