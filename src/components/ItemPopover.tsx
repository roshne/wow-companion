import { useEffect, useId, useRef, type ReactElement } from "react";
import type { CharacterEquipment } from "../lib/queries";
import { QUALITY_COLORS } from "../lib/wow";

/** One entry of the equipment doc's `equipped_items`. */
export type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/**
 * The item-detail popover: a dismissible dialog anchored to the slot / row that opened it. Its header
 * shows the item's identity (quality-colored name, item level, binding); below it, the full detail
 * body — stats, sockets/gems, enchantments, set bonuses, and transmog — each section rendered from the
 * already-fetched equipment entry and omitted (not errored on) when its field group is absent.
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

  // Each detail section renders itself or null; the body wrapper (with its divider) appears only when
  // at least one section has content, so a plain item shows no empty divider.
  const sections = [
    renderStats(item),
    renderSockets(item),
    renderEnchants(item),
    renderSet(item),
    renderTransmog(item),
  ].filter((s): s is ReactElement => s !== null);

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
      {sections.length > 0 ? <div className="item-popover-body">{sections}</div> : null}
    </div>
  );
}

/**
 * Stats: the item's base armor / weapon lines, then its stats — primaries (default styling) separated
 * from secondary equip bonuses (`is_equip_bonus`, given a distinct theme-safe treatment). Blizzard's
 * per-stat `display.color` is calibrated for WoW's dark tooltip (primaries are white → invisible on
 * the light theme), so the primary/secondary split keys off `is_equip_bonus`, not the raw color.
 */
function renderStats(item: EquippedItem): ReactElement | null {
  const normal: string[] = [];
  const bonus: string[] = [];

  const armor =
    item.armor?.display?.display_string ??
    (typeof item.armor?.value === "number" ? `${item.armor.value} Armor` : undefined);
  if (armor) normal.push(armor);

  const w = item.weapon;
  for (const line of [
    w?.damage?.display_string,
    w?.attack_speed?.display_string,
    w?.dps?.display_string,
  ]) {
    if (line) normal.push(line);
  }

  for (const stat of item.stats ?? []) {
    const text = stat.display?.display_string;
    if (!text) continue;
    (stat.is_equip_bonus ? bonus : normal).push(text);
  }

  if (normal.length === 0 && bonus.length === 0) return null;
  return (
    <ul key="stats" className="item-popover-stats">
      {normal.map((t, i) => (
        <li key={`n${i}`}>{t}</li>
      ))}
      {bonus.map((t, i) => (
        <li key={`b${i}`} className="stat-secondary">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Sockets: each socket's gem by name (filled sockets are detected by `item.name`); empty sockets are
 * shown as such rather than omitted, so a missable empty socket stays visible. */
function renderSockets(item: EquippedItem): ReactElement | null {
  const sockets = item.sockets ?? [];
  if (sockets.length === 0) return null;
  return (
    <ul key="sockets" className="item-popover-sockets">
      {sockets.map((s, i) => {
        const gem = s.item?.name;
        if (gem) return <li key={i}>{gem}</li>;
        const socketName = s.socket_type?.name;
        return (
          <li key={i} className="socket-empty">
            {`Empty ${socketName ? `${socketName} ` : ""}Socket`}
          </li>
        );
      })}
    </ul>
  );
}

/** Enchantments: each enchant's `display_string`. */
function renderEnchants(item: EquippedItem): ReactElement | null {
  const lines = (item.enchantments ?? [])
    .map((e) => e.display_string)
    .filter((x): x is string => !!x);
  if (lines.length === 0) return null;
  return (
    <ul key="enchants" className="item-popover-enchants">
      {lines.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** Set bonuses: the set name + equipped piece count, then each effect styled active vs. inactive. */
function renderSet(item: EquippedItem): ReactElement | null {
  const set = item.set;
  if (!set) return null;
  const name = set.item_set?.name ?? set.display_string;
  const items = set.items ?? [];
  const effects = set.effects ?? [];
  if (!name && effects.length === 0) return null;
  const equipped = items.filter((i) => i.is_equipped).length;
  return (
    <div key="set" className="item-popover-set">
      {name ? (
        <p className="set-name">
          {name}
          {items.length ? ` (${equipped}/${items.length})` : ""}
        </p>
      ) : null}
      {effects.length ? (
        <ul>
          {effects.map((e, i) => (
            <li key={i} className={e.is_active ? "set-effect-active" : "set-effect-inactive"}>
              {e.display_string}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Transmog / appearance: the transmog's `display_string`, falling back to the appearance item name. */
function renderTransmog(item: EquippedItem): ReactElement | null {
  const text = item.transmog?.display_string ?? item.transmog?.item?.name;
  if (!text) return null;
  return (
    <p key="transmog" className="item-popover-transmog">
      {text}
    </p>
  );
}
