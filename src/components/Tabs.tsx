import { useRef, type CSSProperties, type KeyboardEvent } from "react";

/** One tab: its stable key (also the selection value) and its visible label. */
export interface TabSpec<K extends string = string> {
  key: K;
  label: string;
}

/** The DOM id of the tab for `key` within the tablist rooted at `base`. */
export function tabId(base: string, key: string): string {
  return `${base}tab-${key}`;
}

/** The DOM id of the single panel the `base` tablist controls. */
export function panelId(base: string): string {
  return `${base}panel`;
}

/**
 * A WAI-ARIA tablist: `role="tablist"` over `role="tab"` buttons, with a roving tabindex (only the
 * selected tab is in the tab order) and Arrow / Home / End key support.
 *
 * **Manual activation** — the arrows move focus only; Enter / Space (native `<button>` behaviour) or a
 * click selects. The APG default is automatic activation, but it documents manual activation as the
 * right choice when revealing a panel is expensive: every character sub-tab here fires its own
 * Battle.net request on selection, so arrowing across ten of them would spend ten calls of a
 * rate-limited quota to pass through tabs the user never meant to open.
 *
 * The caller owns the panel (one container whose *contents* swap, so every tab `aria-controls` the same
 * element) and the id namespace: pass a `useId()` value as `base` and label the panel with
 * `id={panelId(base)}` / `aria-labelledby={tabId(base, active)}`.
 */
export function Tabs<K extends string>({
  base,
  label,
  tabs,
  active,
  onSelect,
  className = "tabs",
  style,
}: {
  base: string;
  label: string;
  tabs: readonly TabSpec<K>[];
  active: K;
  onSelect: (key: K) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Arrow/Home/End move focus between the tabs (wrapping at both ends). Read the buttons from the DOM
  // rather than tracking an index, so the focused tab is whatever actually has focus.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []),
    ];
    const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (from === -1) return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (from + step + buttons.length) % buttons.length;
    buttons[to]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={className}
      style={style}
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={tabId(base, t.key)}
            aria-selected={selected}
            aria-controls={panelId(base)}
            tabIndex={selected ? 0 : -1}
            className={selected ? "active" : ""}
            onClick={() => onSelect(t.key)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
