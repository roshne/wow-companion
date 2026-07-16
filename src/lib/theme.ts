import type { ThemeChoice } from "./persist";

/**
 * Reflect a theme choice onto the document root, where the CSS keys off it:
 * - "light" / "dark" → set `data-theme` so that choice wins regardless of the OS preference.
 * - "system" → remove `data-theme`, letting the `prefers-color-scheme` media query decide.
 *
 * Call once at startup (from `main.tsx`, pre-render, to avoid a flash) and again whenever the choice
 * changes.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}
