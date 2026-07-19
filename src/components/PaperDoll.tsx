import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { characterEquipmentQuery, characterMediaQuery, describeError } from "../lib/queries";
import { QUALITY_COLORS } from "../lib/wow";
import { useItemIcons } from "../lib/useItemIcons";
import { useMediaQuery } from "../lib/useMediaQuery";
import { SkeletonLines } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { ItemPopover, type EquippedItem } from "./ItemPopover";
import {
  gearCheck,
  groupBySlot,
  type GearFinding,
  type GearFindingSeverity,
} from "../lib/gearCheck";

/** A slot's API `slot.type` key and its display label. */
interface SlotSpec {
  type: string;
  label: string;
}

/**
 * A compact-list row: a filled slot (its equipment entry + icon) or a flagged empty slot (`item`
 * absent — e.g. a missing off-hand). Either way it carries the slot's gear-check findings.
 */
interface GearRow {
  type: string;
  label: string;
  item: EquippedItem | undefined;
  icon: string | undefined;
  findings: GearFinding[] | undefined;
}

// The 18 retail equipment slots in classic paper-doll order: two flanking columns and a weapons row.
const LEFT_SLOTS: SlotSpec[] = [
  { type: "HEAD", label: "Head" },
  { type: "NECK", label: "Neck" },
  { type: "SHOULDER", label: "Shoulder" },
  { type: "BACK", label: "Back" },
  { type: "CHEST", label: "Chest" },
  { type: "SHIRT", label: "Shirt" },
  { type: "TABARD", label: "Tabard" },
  { type: "WRIST", label: "Wrist" },
];
const RIGHT_SLOTS: SlotSpec[] = [
  { type: "HANDS", label: "Hands" },
  { type: "WAIST", label: "Waist" },
  { type: "LEGS", label: "Legs" },
  { type: "FEET", label: "Feet" },
  { type: "FINGER_1", label: "Ring 1" },
  { type: "FINGER_2", label: "Ring 2" },
  { type: "TRINKET_1", label: "Trinket 1" },
  { type: "TRINKET_2", label: "Trinket 2" },
];
const WEAPON_SLOTS: SlotSpec[] = [
  { type: "MAIN_HAND", label: "Main Hand" },
  { type: "OFF_HAND", label: "Off Hand" },
];
// Head-to-toe order for the compact list (left column, right column, then weapons).
const ALL_SLOTS: SlotSpec[] = [...LEFT_SLOTS, ...RIGHT_SLOTS, ...WEAPON_SLOTS];

/**
 * The Gear surface: the classic paper doll. The character's full-body render sits centered, with the
 * equipment slots laid out around it — each filled slot showing its item icon, a quality-colored
 * border, and an item-level badge; empty slots muted. Equipment is the primary fetch (its error/pending
 * gate the view); the render is best-effort (render → avatar → a name-initial placeholder), and icons
 * resolve lazily through the persisted `useItemIcons` cache.
 *
 * On narrow viewports the 2D doll can't breathe, so it degrades to a compact, accessible list of the
 * same gear (`GearList`) — driven by a JS media query so the switch is a real DOM swap, not just CSS.
 */
export function PaperDoll({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const equip = useQuery(characterEquipmentQuery(bnet, realmSlug, characterName));
  const mediaQ = useQuery(characterMediaQuery(bnet, realmSlug, characterName));
  const [failedSrcs, setFailedSrcs] = useState<Set<string>>(new Set());
  const compact = useMediaQuery("(max-width: 640px)");
  // Which slot's detail popover is open (by `slot.type`), or null — only one at a time, shared across
  // both layouts. Opening another slot reassigns it, so the old popover unmounts and the new mounts.
  const [openSlot, setOpenSlot] = useState<string | null>(null);

  const items = useMemo(
    () => (equip.data?.equipped_items ?? []).filter((it) => it.slot?.type),
    [equip.data],
  );
  const bySlot = useMemo(() => {
    const map = new Map<string, EquippedItem>();
    for (const it of items) if (it.slot?.type) map.set(it.slot.type, it);
    return map;
  }, [items]);
  const ids = useMemo(
    () => items.map((it) => it.item?.id).filter((id): id is number => typeof id === "number"),
    [items],
  );
  const icons = useItemIcons(bnet, ids);
  // Gear-check findings grouped by `slot.type`, so each slot (filled or empty) can badge its own.
  const findingsBySlot = useMemo(
    () => (equip.data ? groupBySlot(gearCheck(equip.data)) : new Map<string, GearFinding[]>()),
    [equip.data],
  );

  if (equip.isError)
    return <EmptyState message={describeError(equip.error)} onRetry={() => void equip.refetch()} />;
  if (equip.isPending || !equip.data) return <SkeletonLines lines={6} />;

  const iconFor = (item: EquippedItem | undefined) => {
    const id = item?.item?.id;
    return typeof id === "number" ? icons[id] : undefined;
  };

  const openItem = (type: string) => setOpenSlot(type);
  const closePopover = () => setOpenSlot(null);

  // Narrow viewport: the same gear as a compact, labeled table (accessible + width-friendly).
  if (compact) {
    const rows = ALL_SLOTS.flatMap<GearRow>((s) => {
      const item = bySlot.get(s.type);
      const findings = findingsBySlot.get(s.type);
      if (item) return [{ type: s.type, label: s.label, item, icon: iconFor(item), findings }];
      // A flagged empty slot (e.g. a missing off-hand) still earns a row, so the list mirrors the doll.
      if (findings && findings.length > 0)
        return [{ type: s.type, label: s.label, item: undefined, icon: undefined, findings }];
      return [];
    });
    return <GearList rows={rows} openSlot={openSlot} onOpen={openItem} onClose={closePopover} />;
  }

  const media = mediaQ.data ?? { render: null, avatar: null };
  // Prefer the full-body render, then the avatar; skip any source that already failed to load.
  const imageSrc = [media.render, media.avatar].find((s): s is string => !!s && !failedSrcs.has(s));
  const usingRender = imageSrc !== undefined && imageSrc === media.render;

  const renderSlot = (s: SlotSpec) => {
    const item = bySlot.get(s.type);
    return (
      <Slot
        key={s.type}
        label={s.label}
        item={item}
        icon={iconFor(item)}
        findings={findingsBySlot.get(s.type)}
        isOpen={openSlot === s.type}
        onOpen={() => openItem(s.type)}
        onClose={closePopover}
      />
    );
  };

  return (
    <div className="paper-doll">
      <div className="doll-col">{LEFT_SLOTS.map(renderSlot)}</div>
      <div className="doll-center">
        {imageSrc ? (
          <img
            className={usingRender ? "doll-render" : "doll-render avatar-fallback"}
            src={imageSrc}
            alt=""
            onError={() => setFailedSrcs((prev) => new Set(prev).add(imageSrc))}
          />
        ) : (
          <div className="doll-render-placeholder" aria-hidden="true">
            {characterName?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
      </div>
      <div className="doll-col">{RIGHT_SLOTS.map(renderSlot)}</div>
      <div className="doll-weapons">{WEAPON_SLOTS.map(renderSlot)}</div>
    </div>
  );
}

/**
 * A single equipment slot. A filled slot is a real button (the item icon + quality border + ilvl
 * badge) that opens the item-detail popover, anchored just below it; an empty slot is a muted,
 * non-interactive frame.
 */
function Slot({
  label,
  item,
  icon,
  findings,
  isOpen,
  onOpen,
  onClose,
}: {
  label: string;
  item: EquippedItem | undefined;
  icon: string | undefined;
  findings: GearFinding[] | undefined;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const summary = findingSummary(findings);
  // An empty slot the engine flagged (e.g. a missing off-hand) still badges its muted frame.
  if (!item) {
    const emptyName = `${label}: empty${summary}`;
    return (
      <div className="doll-slot empty" aria-label={emptyName} title={emptyName}>
        <FindingBadge findings={findings} className="doll-badge" />
      </div>
    );
  }
  const ilvl = item.level?.value;
  const name = item.name ?? "Unknown item";
  const quality = item.quality?.type;
  const border = quality ? QUALITY_COLORS[quality] : undefined;
  const accessibleName = `${label}: ${name}${typeof ilvl === "number" ? ` (item level ${ilvl})` : ""}${summary}`;

  return (
    <div className="doll-slot-anchor">
      <button
        type="button"
        className="doll-slot"
        aria-label={accessibleName}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={accessibleName}
        style={border ? { borderColor: border } : undefined}
        onClick={onOpen}
      >
        {icon ? (
          <img src={icon} alt="" />
        ) : (
          <div className="doll-icon-pending" aria-hidden="true" />
        )}
        {typeof ilvl === "number" ? <span className="doll-ilvl">{ilvl}</span> : null}
        <FindingBadge findings={findings} className="doll-badge" />
      </button>
      {isOpen ? <ItemPopover item={item} onClose={onClose} /> : null}
    </div>
  );
}

/**
 * The compact fallback for narrow viewports: the equipment as a labeled Slot / Item / iLvl table — a
 * semantic table with column headers, so gear stays keyboard- and screen-reader-reachable without the
 * visual doll. Each item cell is a button that opens the same detail popover as the doll's slots.
 */
function GearList({
  rows,
  openSlot,
  onOpen,
  onClose,
}: {
  rows: GearRow[];
  openSlot: string | null;
  onOpen: (type: string) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="grid gear-list" aria-label="Equipment">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Item</th>
            <th>iLvl</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ type, label, item, icon, findings }) => {
            // A flagged empty slot (e.g. a missing off-hand): the finding as muted text + a badge.
            if (!item) {
              return (
                <tr key={type}>
                  <td>{label}</td>
                  <td>
                    <span className="gear-list-item muted">
                      {findingText(findings)}
                      <FindingBadge findings={findings} className="gear-list-badge" />
                    </span>
                  </td>
                  <td>—</td>
                </tr>
              );
            }
            const quality = item.quality?.type;
            const name = item.name ?? "—";
            const isOpen = openSlot === type;
            return (
              <tr key={type}>
                <td>{label}</td>
                <td>
                  <div className="gear-list-anchor">
                    <button
                      type="button"
                      className="gear-list-item"
                      aria-label={`${label}: ${name}${findingSummary(findings)}`}
                      aria-haspopup="dialog"
                      aria-expanded={isOpen}
                      onClick={() => onOpen(type)}
                    >
                      {icon ? <img className="gear-list-icon" src={icon} alt="" /> : null}
                      <span style={{ color: quality ? QUALITY_COLORS[quality] : undefined }}>
                        {name}
                      </span>
                      <FindingBadge findings={findings} className="gear-list-badge" />
                    </button>
                    {isOpen ? <ItemPopover item={item} onClose={onClose} /> : null}
                  </div>
                </td>
                <td>{item.level?.value ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The worst severity among a slot's findings — a single warning outranks any number of infos. */
function worstSeverity(findings: GearFinding[]): GearFindingSeverity {
  return findings.some((f) => f.severity === "warning") ? "warning" : "info";
}

/** A slot's findings as a comma-separated list of unique labels (empty string when there are none). */
function findingText(findings: GearFinding[] | undefined): string {
  if (!findings || findings.length === 0) return "";
  return [...new Set(findings.map((f) => f.label))].join(", ");
}

/** The accessible-name suffix for a slot's findings — " — <labels>", or "" when there are none. */
function findingSummary(findings: GearFinding[] | undefined): string {
  const text = findingText(findings);
  return text ? ` — ${text}` : "";
}

/**
 * A small count chip flagging a slot's gear-check findings, colored by worst severity. Decorative
 * (`aria-hidden`): the finding text itself lives in the slot's aria-label via {@link findingSummary}.
 */
function FindingBadge({
  findings,
  className,
}: {
  findings: GearFinding[] | undefined;
  className?: string;
}) {
  if (!findings || findings.length === 0) return null;
  return (
    <span
      className={`gear-badge gear-badge-${worstSeverity(findings)}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {findings.length}
    </span>
  );
}
