import { useEffect, useId, useRef } from "react";
import type { CharacterEquipment } from "../lib/queries";
import { QUALITY_COLORS } from "../lib/wow";

/** One entry of the equipment doc's `equipped_items`. */
export type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/**
 * The item-detail popover shell: a dismissible dialog anchored to the slot / row that opened it,
 * showing the item's identity — quality-colored name, item level, and binding. The richer body
 * (stats, sockets/gems, enchants, set bonuses, transmog) is a sibling M3 issue.
 *
 * Behaviour: focus moves into the dialog on open and returns to the trigger on close; it dismisses on
 * Escape and on a pointer press outside it. The parent renders it only while open and owns the
 * "one open at a time" invariant, so opening another slot simply swaps which popover is mounted.
 */
export function ItemPopover({ item, onClose }: { item: EquippedItem; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nameId = useId();

  // Move focus into the dialog on open; restore it to whatever was focused (the trigger) on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  // Dismiss on Escape, or on a pointer press that lands outside the dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose]);

  const name = item.name ?? "Unknown item";
  const quality = item.quality?.type;
  const color = quality ? QUALITY_COLORS[quality] : undefined;
  // Prefer the API's localized "Item Level N" string; fall back to composing it from the raw value.
  const ilvl =
    item.level?.display_string ??
    (typeof item.level?.value === "number" ? `Item Level ${item.level.value}` : undefined);
  const binding = item.binding?.name;

  return (
    <div ref={ref} className="item-popover" role="dialog" aria-labelledby={nameId} tabIndex={-1}>
      <button
        type="button"
        className="item-popover-close ghost"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
      <p id={nameId} className="item-popover-name" style={color ? { color } : undefined}>
        {name}
      </p>
      {ilvl ? <p className="item-popover-ilvl">{ilvl}</p> : null}
      {binding ? <p className="item-popover-binding muted">{binding}</p> : null}
    </div>
  );
}
