/*
 * Recognises links to projects on Modrinth and CurseForge, so that they can open in
 * the launcher. Anything else, such as a user's page, a server plugin or a site's
 * search page, isn't a project this app can show and goes to the browser as usual.
 */

export type ProjectLink =
  | { source: "modrinth"; slug: string; section: ProjectSection }
  | { source: "curseforge"; slug?: string; id?: string; type?: string; section: ProjectSection };

export type ProjectSection = "desc" | "versions" | "gallery";

const MODRINTH_PROJECT_PATHS = new Set(["mod", "modpack", "resourcepack", "shader", "datapack", "project"]);

const CURSEFORGE_PROJECT_PATHS: Record<string, string> = {
  "mc-mods": "mod",
  modpacks: "modpack",
  "texture-packs": "resourcepack",
  shaders: "shader",
  "data-packs": "datapack",
};

const isCurseForge = (host: string) => host === "curseforge.com" || host.endsWith(".curseforge.com");

function pathParts(url: URL) {
  return url.pathname.split("/").filter(Boolean);
}

function hostOf(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function sectionFrom(part: string | undefined): ProjectSection {
  if (part === "versions" || part === "version" || part === "changelog" || part === "files") return "versions";
  if (part === "gallery" || part === "screenshots") return "gallery";
  return "desc";
}

/*
 * CurseForge sends outside links through its own redirect page, usually with the real
 * address encoded twice. Going straight there also reveals a link to a project.
 */
export function unwrapLink(link: string) {
  let url: URL;

  try {
    url = new URL(link);
  } catch {
    return link;
  }

  if (!isCurseForge(hostOf(url)) || url.pathname !== "/linkout") return link;

  let target = url.searchParams.get("remoteUrl") ?? "";

  for (let attempt = 0; attempt < 2 && !target.includes("://"); attempt += 1) {
    try {
      target = decodeURIComponent(target);
    } catch {
      break;
    }
  }

  return target || link;
}

export function projectFromLink(link: string): ProjectLink | null {
  let url: URL;

  try {
    url = new URL(link);
  } catch {
    return null;
  }

  const host = hostOf(url);
  const parts = pathParts(url);

  if (host === "modrinth.com") {
    if (!MODRINTH_PROJECT_PATHS.has(parts[0]) || !parts[1]) return null;
    return { source: "modrinth", slug: parts[1], section: sectionFrom(parts[2]) };
  }

  if (!isCurseForge(host)) return null;

  if (parts[0] === "minecraft" && CURSEFORGE_PROJECT_PATHS[parts[1]] && parts[2]) {
    return {
      source: "curseforge",
      slug: parts[2],
      type: CURSEFORGE_PROJECT_PATHS[parts[1]],
      section: sectionFrom(parts[3]),
    };
  }

  // The old address style, by number or by name.
  if (parts[0] === "projects" && parts[1]) {
    const byNumber = /^\d+$/.test(parts[1]);
    return {
      source: "curseforge",
      ...(byNumber ? { id: parts[1] } : { slug: parts[1] }),
      section: sectionFrom(parts[2]),
    };
  }

  return null;
}
