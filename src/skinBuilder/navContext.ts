import { createContext } from "react";

/**
 * Opens the Skin Builder from the Minecraft sidebar. Every page passes its sidebar
 * a fixed list of props, so a context adds this one link without editing each page.
 */
export const SkinBuilderNavContext = createContext<(() => void) | null>(null);
