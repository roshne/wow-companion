import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import {
  characterEquipmentQuery,
  characterMediaQuery,
  describeError,
  type CharacterEquipment,
} from "../lib/queries";
import { QUALITY_COLORS } from "../lib/wow";
import { useItemIcons } from "../lib/useItemIcons";
import { SkeletonLines } from "./Skeleton";
import { EmptyState } from "./EmptyState";

/** One entry of the equipment doc's `equipped_items`. */
type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/** A slot's API `slot.type` key and its display label. */
interface SlotSpec {
  type: string;
  label: string;
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

/**
 * The Gear surface: the classic paper doll. The character's full-body render sits centered, with the
 * equipment slots laid out around it — each filled slot showing its item icon, a quality-colored
 * border, and an item-level badge; empty slots muted. Equipment is the primary fetch (its error/pending
 * gate the view); the render is best-effort (render → avatar → a name-initial placeholder), and icons
 * resolve lazily through the persisted `useItemIcons` cache.
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

  if (equip.isError)
    return <EmptyState message={describeError(equip.error)} onRetry={() => void equip.refetch()} />;
  if (equip.isPending || !equip.data) return <SkeletonLines lines={6} />;

  const media = mediaQ.data ?? { render: null, avatar: null };
  // Prefer the full-body render, then the avatar; skip any source that already failed to load.
  const imageSrc = [media.render, media.avatar].find((s): s is string => !!s && !failedSrcs.has(s));
  const usingRender = imageSrc !== undefined && imageSrc === media.render;

  const renderSlot = (s: SlotSpec) => {
    const item = bySlot.get(s.type);
    const id = item?.item?.id;
    return (
      <Slot
        key={s.type}
        label={s.label}
        item={item}
        icon={typeof id === "number" ? icons[id] : undefined}
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

/** A single equipment slot: the item icon + quality border + ilvl badge, or a muted empty frame. */
function Slot({
  label,
  item,
  icon,
}: {
  label: string;
  item: EquippedItem | undefined;
  icon: string | undefined;
}) {
  if (!item) {
    return <div className="doll-slot empty" aria-label={`${label}: empty`} title={`${label}: empty`} />;
  }
  const ilvl = item.level?.value;
  const name = item.name ?? "Unknown item";
  const quality = item.quality?.type;
  const border = quality ? QUALITY_COLORS[quality] : undefined;
  const accessibleName = `${label}: ${name}${typeof ilvl === "number" ? ` (item level ${ilvl})` : ""}`;

  return (
    <div
      className="doll-slot"
      aria-label={accessibleName}
      title={accessibleName}
      style={border ? { borderColor: border } : undefined}
    >
      {icon ? <img src={icon} alt="" /> : <div className="doll-icon-pending" aria-hidden="true" />}
      {typeof ilvl === "number" ? <span className="doll-ilvl">{ilvl}</span> : null}
    </div>
  );
}
