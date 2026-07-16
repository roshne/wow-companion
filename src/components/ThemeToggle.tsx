import { useEffect, useState } from "react";
import { loadTheme, saveTheme, type ThemeChoice } from "../lib/persist";
import { applyTheme } from "../lib/theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * App-chrome control for the light / dark / system theme. Seeds from the persisted choice, reflects
 * every change onto the document root (`applyTheme`), and persists it. "System" defers to the OS.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  return (
    <label className="muted">
      Theme{" "}
      <select value={theme} onChange={(e) => setTheme(e.currentTarget.value as ThemeChoice)}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
