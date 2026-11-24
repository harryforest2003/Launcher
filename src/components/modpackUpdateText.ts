const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a modpack update did, in a sentence or two. */
export function modpackUpdateText(packName: string, result: ModpackUpdateResult) {
  const changed = [
    result.updated ? `${plural(result.updated, "file")} updated` : "",
    result.added ? `${result.added} added` : "",
    result.removed ? `${result.removed} removed` : "",
  ].filter(Boolean);
  const parts = [
    `Moved ${packName} from ${result.from.versionName || "the version before"} to ${result.to.versionName || "the new version"}` +
      (changed.length ? `: ${changed.join(", ")}.` : "."),
    result.loader ? `The loader went from ${result.loader.from} to ${result.loader.to}.` : "",
    result.blocked.length ? `${plural(result.blocked.length, "file")} couldn't be downloaded, as their authors don't allow it.` : "",
    ...result.notes,
    "Your own mods stayed. Undo beside the pack's name puts it back.",
  ];
  return parts.filter(Boolean).join(" ");
}
