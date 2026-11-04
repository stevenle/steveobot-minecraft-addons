/**
 * What each wave and boss is made of. Pure data and dice: nothing here
 * touches the world, so arena.ts can plan a wave and then spawn it.
 *
 * Difficulty is one number, `gear` (0 to 4), that rises evenly from the
 * first wave to the last. It picks the armor and weapon tier (leather/wood,
 * chainmail/stone, iron, diamond, netherite), how much of the kit each mob
 * gets, and which status effects it carries. A wave's theme picks the mobs.
 */

export type Weapon = 'sword' | 'axe' | 'bow' | 'crossbow' | 'none';

export interface MobKind {
  readonly id: string;
  /** What it holds. `none` keeps whatever vanilla gives it (blazes, witches, breezes). */
  readonly weapon: Weapon;
  /** Whether replaceitem'd armor does anything on it. */
  readonly armor: boolean;
  /** Spawn event for a variant, e.g. a baby zombie. */
  readonly spawnEvent?: string;
}

export interface Theme {
  readonly key: string;
  /** First wave index (0-based) the theme can appear on. */
  readonly from: number;
  readonly mobs: readonly MobKind[];
}

const ZOMBIE: MobKind = { id: 'minecraft:zombie', weapon: 'sword', armor: true };
const HUSK: MobKind = { id: 'minecraft:husk', weapon: 'axe', armor: true };
const ZOMBIE_VILLAGER: MobKind = { id: 'minecraft:zombie_villager_v2', weapon: 'sword', armor: true };
const SKELETON: MobKind = { id: 'minecraft:skeleton', weapon: 'bow', armor: true };
const STRAY: MobKind = { id: 'minecraft:stray', weapon: 'bow', armor: true };
const BOGGED: MobKind = { id: 'minecraft:bogged', weapon: 'bow', armor: true };
const VINDICATOR: MobKind = { id: 'minecraft:vindicator', weapon: 'axe', armor: true };
const PILLAGER: MobKind = { id: 'minecraft:pillager', weapon: 'crossbow', armor: true };
const WITHER_SKELETON: MobKind = { id: 'minecraft:wither_skeleton', weapon: 'sword', armor: true };
const BLAZE: MobKind = { id: 'minecraft:blaze', weapon: 'none', armor: false };
const WITCH: MobKind = { id: 'minecraft:witch', weapon: 'none', armor: false };
const BREEZE: MobKind = { id: 'minecraft:breeze', weapon: 'none', armor: false };

// Creepers are left out on purpose: they would blow the arena apart. So are
// piglins (they turn into neutral zombified piglins in the Overworld) and
// spiders (neutral in daylight), which would leave a wave unfinishable.
export const THEMES: readonly Theme[] = [
  { key: 'zombies', from: 0, mobs: [ZOMBIE, ZOMBIE, HUSK, ZOMBIE_VILLAGER] },
  { key: 'skeletons', from: 0, mobs: [SKELETON, SKELETON, STRAY, BOGGED] },
  { key: 'illagers', from: 2, mobs: [VINDICATOR, PILLAGER, PILLAGER] },
  { key: 'nether', from: 4, mobs: [WITHER_SKELETON, WITHER_SKELETON, BLAZE] },
  { key: 'witchcraft', from: 3, mobs: [WITCH, ZOMBIE, SKELETON, BREEZE] },
  {
    key: 'horde',
    from: 5,
    mobs: [ZOMBIE, HUSK, SKELETON, STRAY, VINDICATOR, PILLAGER, WITHER_SKELETON, BLAZE, WITCH],
  },
];

const ARMOR_MATERIAL = ['leather', 'chainmail', 'iron', 'diamond', 'netherite'] as const;
const TOOL_MATERIAL = ['wooden', 'stone', 'iron', 'diamond', 'netherite'] as const;
export const ARMOR_SLOTS = [
  { slot: 'slot.armor.head', piece: 'helmet' },
  { slot: 'slot.armor.chest', piece: 'chestplate' },
  { slot: 'slot.armor.legs', piece: 'leggings' },
  { slot: 'slot.armor.feet', piece: 'boots' },
] as const;
export const MAX_GEAR = 4;

export interface Kit {
  /** replaceitem slot to item id. */
  readonly items: readonly { slot: string; item: string }[];
  /** Effect name to amplifier. */
  readonly effects: readonly { name: string; amplifier: number }[];
}

export interface MobPlan {
  readonly kind: MobKind;
  readonly kit: Kit;
}

export interface WavePlan {
  readonly theme: Theme;
  readonly mobs: readonly MobPlan[];
}

export interface BossDef {
  readonly key: string;
  /** Shown over its head. Name tags are plain strings; they cannot be translated. */
  readonly name: string;
  readonly kind: MobKind;
  /** Gear tier bonus over the wave level (bosses dress one tier up). */
  readonly gearBonus: number;
  readonly effects: readonly { name: string; amplifier: number }[];
  /** Escorts, as a theme to draw from, and how many per player. */
  readonly escortTheme: string;
  readonly escorts: number;
}

/** Bosses by tier. Boss slots are spread across the tiers; see `planBosses`. */
const BOSS_TIERS: readonly (readonly BossDef[])[] = [
  [
    {
      key: 'warlord',
      name: '§6Zombie Warlord',
      kind: ZOMBIE,
      gearBonus: 1,
      effects: [{ name: 'resistance', amplifier: 1 }, { name: 'strength', amplifier: 1 }, { name: 'speed', amplifier: 0 }],
      escortTheme: 'zombies',
      escorts: 3,
    },
    {
      key: 'marksman',
      name: '§bFrost Marksman',
      kind: STRAY,
      gearBonus: 1,
      effects: [{ name: 'resistance', amplifier: 2 }, { name: 'speed', amplifier: 1 }],
      escortTheme: 'skeletons',
      escorts: 3,
    },
  ],
  [
    {
      key: 'archmage',
      name: '§5Evoker Archmage',
      kind: { id: 'minecraft:evoker', weapon: 'none', armor: false },
      gearBonus: 0,
      effects: [{ name: 'resistance', amplifier: 2 }],
      escortTheme: 'illagers',
      escorts: 3,
    },
    {
      key: 'stormcaller',
      name: '§3Storm Caller',
      kind: BREEZE,
      gearBonus: 0,
      effects: [{ name: 'resistance', amplifier: 2 }, { name: 'strength', amplifier: 1 }],
      escortTheme: 'witchcraft',
      escorts: 3,
    },
  ],
  [
    {
      key: 'ravager',
      name: '§cThe Ravager',
      kind: { id: 'minecraft:ravager', weapon: 'none', armor: false },
      gearBonus: 0,
      effects: [{ name: 'resistance', amplifier: 1 }, { name: 'strength', amplifier: 0 }],
      escortTheme: 'illagers',
      escorts: 3,
    },
    {
      key: 'witherking',
      name: '§8Wither Skeleton King',
      kind: WITHER_SKELETON,
      gearBonus: 1,
      effects: [{ name: 'resistance', amplifier: 2 }, { name: 'strength', amplifier: 1 }, { name: 'speed', amplifier: 1 }],
      escortTheme: 'nether',
      escorts: 3,
    },
  ],
];

/** Epic's final boss. 500 health and a sonic boom that ignores armor. */
const WARDEN: BossDef = {
  key: 'warden',
  name: '§3§lThe Warden',
  kind: { id: 'minecraft:warden', weapon: 'none', armor: false },
  gearBonus: 0,
  effects: [],
  escortTheme: 'horde',
  escorts: 0,
};

export interface Mode {
  readonly key: string;
  readonly bosses: number;
  readonly wavesPerBoss: number;
}

export const MODES: readonly Mode[] = [
  { key: 'quick', bosses: 2, wavesPerBoss: 3 },
  { key: 'standard', bosses: 3, wavesPerBoss: 4 },
  { key: 'epic', bosses: 5, wavesPerBoss: 4 },
];

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function clampTier(n: number): number {
  return Math.max(0, Math.min(MAX_GEAR, Math.round(n)));
}

/** Gear level for the `index`th fight (waves and bosses counted together) out of `total`. */
export function gearLevel(index: number, total: number): number {
  return total <= 1 ? 0 : (MAX_GEAR * index) / (total - 1);
}

function weaponItem(weapon: Weapon, tier: number): string | undefined {
  switch (weapon) {
    case 'sword':
      return `minecraft:${TOOL_MATERIAL[tier]}_sword`;
    case 'axe':
      return `minecraft:${TOOL_MATERIAL[tier]}_axe`;
    case 'bow':
      return 'minecraft:bow';
    case 'crossbow':
      return 'minecraft:crossbow';
    case 'none':
      return undefined;
  }
}

/**
 * Rolls a kit for one mob at `gear`. Each armor piece is present with a
 * chance that grows with the level, and its tier wobbles around it, so a
 * wave looks mismatched rather than uniformed. The first wave still always
 * has its leather caps.
 */
export function rollKit(kind: MobKind, gear: number, forceFull = false): Kit {
  const items: { slot: string; item: string }[] = [];
  if (kind.armor) {
    const chance = forceFull ? 1 : Math.min(1, 0.35 + 0.18 * gear);
    for (const { slot, piece } of ARMOR_SLOTS) {
      const isHelmet = piece === 'helmet';
      if (!isHelmet && Math.random() > chance) continue;
      const tier = forceFull ? clampTier(gear) : clampTier(gear + Math.random() * 1.3 - 0.8);
      const material = ARMOR_MATERIAL[tier];
      // Chainmail has no cap in the leather sense; all five materials have every piece.
      items.push({ slot, item: `minecraft:${material}_${piece}` });
    }
  }
  const weaponTier = forceFull ? clampTier(gear) : clampTier(gear + Math.random() * 1.2 - 0.6);
  const weapon = weaponItem(kind.weapon, weaponTier);
  // Skeletons and pillagers already carry their bow; only swap it if missing.
  if (weapon && kind.weapon !== 'bow' && kind.weapon !== 'crossbow') {
    if (forceFull || Math.random() < 0.55 + 0.12 * gear) items.push({ slot: 'slot.weapon.mainhand', item: weapon });
  }

  const effects: { name: string; amplifier: number }[] = [];
  if (gear >= 1.5 && Math.random() < 0.15 * gear) effects.push({ name: 'speed', amplifier: 0 });
  if (gear >= 2.5 && Math.random() < 0.12 * gear) effects.push({ name: 'strength', amplifier: gear >= 3.5 ? 1 : 0 });
  if (gear >= 3.5 && Math.random() < 0.4) effects.push({ name: 'resistance', amplifier: 0 });
  return { items, effects };
}

/** How many mobs a wave has: grows with the wave and with the number of fighters. */
export function waveSize(index: number, total: number, players: number): number {
  const base = 3 + Math.floor((5 * index) / Math.max(1, total - 1));
  return Math.min(16, base + 2 * Math.max(0, players - 1));
}

export function planWave(index: number, total: number, players: number): WavePlan {
  const open = THEMES.filter((t) => t.from <= index);
  // The very first wave is zombies, so the opener is the gentle one.
  const theme = index === 0 ? (THEMES[0] as Theme) : pick(open);
  const gear = gearLevel(index, total);
  const mobs: MobPlan[] = [];
  const count = waveSize(index, total, players);
  for (let i = 0; i < count; i++) {
    const kind = index === 0 ? ZOMBIE : pick(theme.mobs);
    mobs.push({ kind, kit: rollKit(kind, gear) });
  }
  return { theme, mobs };
}

/** Picks the boss lineup for a mode: tiers spread from easiest to hardest, final last. */
export function planBosses(mode: Mode): BossDef[] {
  const bosses: BossDef[] = [];
  const lastTier = BOSS_TIERS.length - 1;
  for (let i = 0; i < mode.bosses; i++) {
    const isFinal = i === mode.bosses - 1;
    if (isFinal && mode.key === 'epic') {
      bosses.push(WARDEN);
      continue;
    }
    const tier = isFinal ? lastTier : Math.min(lastTier - 1, Math.floor((i * BOSS_TIERS.length) / mode.bosses));
    const pool = (BOSS_TIERS[tier] ?? []).filter((b) => !bosses.includes(b));
    bosses.push(pick(pool.length ? pool : (BOSS_TIERS[tier] ?? [])));
  }
  return bosses;
}

export function themeByKey(key: string): Theme {
  return THEMES.find((t) => t.key === key) ?? (THEMES[0] as Theme);
}

/** Every item id a kit can hand out, so arena.ts can sweep them off the floor after a death. */
export const GEAR_ITEMS: ReadonlySet<string> = new Set([
  ...ARMOR_MATERIAL.flatMap((m) => ARMOR_SLOTS.map(({ piece }) => `minecraft:${m}_${piece}`)),
  ...TOOL_MATERIAL.flatMap((m) => [`minecraft:${m}_sword`, `minecraft:${m}_axe`]),
]);
