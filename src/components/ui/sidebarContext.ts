import { createContext } from "react";

/** What the sidebar's "back" control under the current page says, when the screen knows
    better than "Back" (set by App for screens with a trail, e.g. "Back to results"). */
export const SidebarBackLabel = createContext<string | null>(null);
