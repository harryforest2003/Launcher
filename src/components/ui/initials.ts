/* The short name a Monogram shows. */
/* "The Sims 4" -> "S4", "Fallout 4" -> "F4", "GTA V" -> "GTA", "Cyberpunk 2077" -> "C",
   "Minecraft" -> "M", "All the Mods 9" -> "AM". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && /^the$/i.test(word)) && !/^(the|of|and|a)$/i.test(word));
  if (!words.length) return "?";
  const [first, second] = words;
  // An acronym (GTA, SE) is already the short name.
  if (first.length >= 2 && first.length <= 3 && first === first.toUpperCase() && /\p{L}/u.test(first)) return first;
  if (!second || /^\d{3,}$/.test(second)) return first[0].toUpperCase();
  return (first[0] + second[0]).toUpperCase();
}
