// The retail equipment slots, shared by the paper doll (per-character) and the warband gear board.

/** A slot's API `slot.type` key and its display label. */
export interface SlotSpec {
  type: string;
  label: string;
}

// The 18 retail equipment slots in classic paper-doll order: two flanking columns and a weapons row.
export const LEFT_SLOTS: SlotSpec[] = [
  { type: "HEAD", label: "Head" },
  { type: "NECK", label: "Neck" },
  { type: "SHOULDER", label: "Shoulder" },
  { type: "BACK", label: "Back" },
  { type: "CHEST", label: "Chest" },
  { type: "SHIRT", label: "Shirt" },
  { type: "TABARD", label: "Tabard" },
  { type: "WRIST", label: "Wrist" },
];
export const RIGHT_SLOTS: SlotSpec[] = [
  { type: "HANDS", label: "Hands" },
  { type: "WAIST", label: "Waist" },
  { type: "LEGS", label: "Legs" },
  { type: "FEET", label: "Feet" },
  { type: "FINGER_1", label: "Ring 1" },
  { type: "FINGER_2", label: "Ring 2" },
  { type: "TRINKET_1", label: "Trinket 1" },
  { type: "TRINKET_2", label: "Trinket 2" },
];
export const WEAPON_SLOTS: SlotSpec[] = [
  { type: "MAIN_HAND", label: "Main Hand" },
  { type: "OFF_HAND", label: "Off Hand" },
];

/** Head-to-toe order (left column, right column, then weapons). */
export const ALL_SLOTS: SlotSpec[] = [...LEFT_SLOTS, ...RIGHT_SLOTS, ...WEAPON_SLOTS];

/** The gear-board columns: every slot that reports an item level (the cosmetic Shirt/Tabard dropped). */
export const BOARD_SLOTS: SlotSpec[] = ALL_SLOTS.filter(
  (s) => s.type !== "SHIRT" && s.type !== "TABARD",
);
