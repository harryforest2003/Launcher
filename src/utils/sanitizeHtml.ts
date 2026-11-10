/*
 * Project descriptions are written by strangers and shown inside the app, where a
 * script could reach the launcher's APIs and run anything on the computer. So only
 * plain formatting survives: unknown tags are unwrapped, dangerous ones are removed
 * along with their content, and links can only go to the web.
 */

const REMOVE_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea",
  "select", "link", "meta", "base", "svg", "math", "frame", "frameset", "noscript", "template",
]);

const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "center", "code", "dd", "del", "details", "div", "dl",
  "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
  "kbd", "li", "mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

type Options = {
  /** What links starting with "/" are relative to. */
  baseUrl?: string;
  /** Changes a link before it is checked, so the result is what gets checked. */
  rewriteLink?: (url: string) => string;
};

const LINK_PROTOCOLS = ["http:", "https:", "mailto:"];
const IMAGE_PROTOCOLS = ["http:", "https:"];

/*
 * The full address, if it's allowed. Other relative links are left out on purpose:
 * "LICENSE" or "#install" made sense where the text was first written, not here.
 */
function allowedUrl(value: string, protocols: string[], baseUrl?: string) {
  try {
    const url = new URL(value, value.startsWith("/") ? baseUrl : undefined);
    return protocols.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function cleanElement(element: Element, options: Options) {
  const tag = element.tagName.toLowerCase();
  const allowed = ALLOWED_ATTRIBUTES[tag] ?? [];

  for (const attribute of [...element.attributes]) {
    if (!allowed.includes(attribute.name.toLowerCase())) {
      element.removeAttribute(attribute.name);
    }
  }

  if (tag === "a") {
    const href = element.getAttribute("href");
    const full = href && allowedUrl(href, LINK_PROTOCOLS, options.baseUrl);
    const target = full && allowedUrl(options.rewriteLink?.(full) ?? full, LINK_PROTOCOLS);

    if (target) element.setAttribute("href", target);
    else element.removeAttribute("href");

    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noopener noreferrer");
  }

  if (tag === "img") {
    const src = element.getAttribute("src");
    const full = src && allowedUrl(src, IMAGE_PROTOCOLS, options.baseUrl);

    if (full) element.setAttribute("src", full);
    else element.remove();
  }
}

function cleanChildren(parent: Element, options: Options) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const element = node as Element;
    const tag = element.tagName.toLowerCase();

    if (REMOVE_WITH_CONTENT.has(tag)) {
      element.remove();
      continue;
    }

    cleanChildren(element, options);

    if (ALLOWED_TAGS.has(tag)) {
      cleanElement(element, options);
    } else {
      element.replaceWith(...element.childNodes);
    }
  }
}

export function sanitizeHtml(html: string, options: Options = {}) {
  const { body } = new DOMParser().parseFromString(html, "text/html");
  cleanChildren(body, options);
  return body.innerHTML;
}
