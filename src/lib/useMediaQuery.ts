import { useEffect, useState } from "react";

/**
 * Track whether a CSS media query currently matches, re-rendering when it changes. Used to switch
 * layouts responsively from JS (e.g. the paper doll → a compact list on narrow viewports). Environments
 * without `matchMedia` (jsdom by default, SSR) resolve to `false`, so the wide/default layout is the
 * safe fallback.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync in case the query changed (or matched) between render and effect
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
