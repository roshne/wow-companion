import { useEffect, type RefObject } from "react";

/**
 * The selector for "focusable by Tab" — the element types the browser puts in the sequential focus
 * order, minus the ones that are explicitly out of it (`disabled`, `tabindex="-1"`, hidden inputs).
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The Tab-focusable descendants of `root`, in DOM order. Skips anything laid out as hidden. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex !== -1 && !el.hasAttribute("inert"),
  );
}

/**
 * Keep Tab focus inside a modal dialog: Tab from the last focusable element wraps to the first, and
 * Shift+Tab from the first wraps to the last.
 *
 * A dialog that declares `aria-modal="true"` promises assistive tech that the rest of the page is
 * inert — without this, Tab walks straight out through the backdrop into the app behind it and the
 * promise is a lie. The element list is read at keypress time, so a dialog whose contents change
 * (fields appearing, a button enabling) traps correctly without re-registering.
 *
 * `enabled` lets a caller mount the hook unconditionally (hooks can't be conditional) while the
 * dialog itself is conditionally open.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const focusable = focusableWithin(root);
      if (focusable.length === 0) {
        // Nothing to land on — keep focus on the dialog itself rather than letting it escape.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Focus sitting on the dialog container (as it does right after open) counts as "before the
      // first element", so the first Tab enters the dialog instead of leaving it.
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref, enabled]);
}
