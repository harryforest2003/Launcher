import { marked } from "marked";
import { unwrapLink } from "./projectLinks";
import { sanitizeHtml } from "./sanitizeHtml";

// Descriptions can link within their own site, as "/mod/sodium" or "/linkout?...".
const SITE_URLS = {
  modrinth: "https://modrinth.com/",
  curseforge: "https://www.curseforge.com/",
};

/*
 * Modrinth descriptions are markdown and CurseForge's are HTML. Markdown can carry
 * raw HTML and javascript: links too, which marked passes straight through, so what
 * it produces has to be sanitised just like CurseForge's.
 */
export function descriptionHtml(source: "modrinth" | "curseforge", text: string) {
  return sanitizeHtml(source === "modrinth" ? marked.parse(text, { async: false }) : text, {
    baseUrl: SITE_URLS[source],
    rewriteLink: unwrapLink,
  });
}
