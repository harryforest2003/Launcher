export type ModType =
  | "mod"
  | "modpack"
  | "shader"
  | "resourcepack"
  | "datapack";

function safeText(...vals: any[]) {
  return vals.filter(Boolean).join(" ").toLowerCase();
}

/* ---------------- MODRINTH (TRUSTED SOURCE) ---------------- */
function classifyModrinth(item: any): ModType {
  const t = (item.project_type || "").toLowerCase();

  if (t === "shader" || t === "shaders") return "shader";
  if (t === "modpack") return "modpack";
  if (t === "resourcepack") return "resourcepack";
  if (t === "datapack") return "datapack";
  if (t === "mod") return "mod";

  return "mod";
}

/* ---------------- CURSEFORGE (FIXED REALISTIC DETECTION) ---------------- */
function classifyCurseForge(item: any): ModType {
  const rawClass =
    item.className ||
    item.classType ||
    item.categorySection ||
    item.category ||
    item.classification ||
    "";

  const text = safeText(
    rawClass,
    item.name,
    item.slug,
    item.summary,
    item.description
  );

  // 🔥 IMPORTANT: order matters
  if (text.includes("shader") || text.includes("shaders")) return "shader";
  if (text.includes("modpack")) return "modpack";
  if (text.includes("resource pack") || text.includes("texture pack"))
    return "resourcepack";
  if (text.includes("data pack") || text.includes("datapack"))
    return "datapack";

  return "mod";
}

/* ---------------- MAIN EXPORT ---------------- */
export function classifyMod(item: any, source: "modrinth" | "curseforge"): ModType {
  if (source === "modrinth") return classifyModrinth(item);
  return classifyCurseForge(item);
}