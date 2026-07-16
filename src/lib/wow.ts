// Shared WoW display constants.

/** Item quality → display colour, keyed by the API's `quality.type` (e.g. "EPIC"). */
export const QUALITY_COLORS: Record<string, string> = {
  POOR: "#9d9d9d",
  COMMON: "#ffffff",
  UNCOMMON: "#1eff00",
  RARE: "#0070dd",
  EPIC: "#a335ee",
  LEGENDARY: "#ff8000",
  ARTIFACT: "#e6cc80",
  HEIRLOOM: "#00ccff",
};

/** Blizzard class colours, keyed by the class file key (`classKey`, e.g. "DeathKnight"). */
export const CLASS_COLORS: Record<string, string> = {
  Warrior: "#C69B6D",
  Paladin: "#F48CBA",
  Hunter: "#AAD372",
  Rogue: "#FFF468",
  Priest: "#FFFFFF",
  DeathKnight: "#C41E3A",
  Shaman: "#0070DD",
  Mage: "#3FC7EB",
  Warlock: "#8788EE",
  Monk: "#00FF98",
  Druid: "#FF7C0A",
  DemonHunter: "#A330C9",
  Evoker: "#33937F",
};

/**
 * Playable-class id → display name + class file key. The guild roster returns only the numeric
 * `playable_class.id` (no name), so this static map turns it into a name and — via the `key` into
 * `CLASS_COLORS` — a colour, without an extra API call per class.
 */
export const CLASS_BY_ID: Record<number, { name: string; key: string }> = {
  1: { name: "Warrior", key: "Warrior" },
  2: { name: "Paladin", key: "Paladin" },
  3: { name: "Hunter", key: "Hunter" },
  4: { name: "Rogue", key: "Rogue" },
  5: { name: "Priest", key: "Priest" },
  6: { name: "Death Knight", key: "DeathKnight" },
  7: { name: "Shaman", key: "Shaman" },
  8: { name: "Mage", key: "Mage" },
  9: { name: "Warlock", key: "Warlock" },
  10: { name: "Monk", key: "Monk" },
  11: { name: "Druid", key: "Druid" },
  12: { name: "Demon Hunter", key: "DemonHunter" },
  13: { name: "Evoker", key: "Evoker" },
};

/**
 * Playable-race id → display name. The roster returns only the numeric `playable_race.id`. Faction
 * variants that share a name (the three Pandaren, both Dracthyr, both Earthen) collapse to one entry.
 */
export const RACE_BY_ID: Record<number, string> = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "Night Elf",
  5: "Undead",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  9: "Goblin",
  10: "Blood Elf",
  11: "Draenei",
  22: "Worgen",
  24: "Pandaren",
  25: "Pandaren",
  26: "Pandaren",
  27: "Nightborne",
  28: "Highmountain Tauren",
  29: "Void Elf",
  30: "Lightforged Draenei",
  31: "Zandalari Troll",
  32: "Kul Tiran",
  34: "Dark Iron Dwarf",
  35: "Vulpera",
  36: "Mag'har Orc",
  37: "Mechagnome",
  52: "Dracthyr",
  70: "Dracthyr",
  84: "Earthen",
  85: "Earthen",
};

/** Faction → display colour, keyed by the API's `faction.type` (e.g. "HORDE"). */
export const FACTION_COLORS: Record<string, string> = {
  ALLIANCE: "#1E90FF",
  HORDE: "#C41E3A",
};

/** Class display name for a numeric id: known name, `Class #id` for an unknown id, `—` when absent. */
export function className(id: number | undefined | null): string {
  if (id == null) return "—";
  return CLASS_BY_ID[id]?.name ?? `Class #${id}`;
}

/** Class colour for a numeric id, or `undefined` when the id is absent or unknown. */
export function classColor(id: number | undefined | null): string | undefined {
  if (id == null) return undefined;
  const key = CLASS_BY_ID[id]?.key;
  return key ? CLASS_COLORS[key] : undefined;
}

/** Race display name for a numeric id: known name, `Race #id` for an unknown id, `—` when absent. */
export function raceName(id: number | undefined | null): string {
  if (id == null) return "—";
  return RACE_BY_ID[id] ?? `Race #${id}`;
}
