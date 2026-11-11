/* What adding a mod also did about the mods it needs, as a sentence or two ("" if nothing). */
export function dependencyNote(check: Partial<DependencyCheck>): string {
  const parts: string[] = [];

  if (check.dependencies?.length) parts.push(`Also added what it needs: ${check.dependencies.join(", ")}.`);

  for (const off of check.disabledDependencies ?? []) {
    parts.push(`${off.neededBy} needs ${off.name}, which is turned off. Turn it on in Content.`);
  }

  const missing = check.missingDependencies ?? [];
  if (missing.length) {
    const names = missing.map((entry) => `${entry.id} (for ${entry.neededBy.join(", ")})`).join(", ");
    parts.push(`Couldn't find ${names} on Modrinth for this version, so add ${missing.length === 1 ? "it" : "them"} yourself.`);
  }

  return parts.join(" ");
}
