/**
 * The trim tables: which tools can be trimmed, with what, and how the item ids
 * fit together. Keep TIERS, TOOLS, and MATERIALS in step with
 * assets/generate.mjs, which writes one item per combination.
 *
 * Bedrock gives every item type exactly one texture, so a trimmed tool cannot
 * be the vanilla item with a flag on it. Each trimmed tool is its own custom
 * item, `steveo:<tier>_<tool>_<material>_trim`, that copies the vanilla tool's
 * stats, and trimming swaps one item for the other.
 *
 * The paxel is the one tool that is not vanilla: its untrimmed item is
 * `steveo:<tier>_paxel` from the paxel add-on, so trimming one needs that
 * add-on too. The trimmed paxels themselves live here.
 */

export const TIERS = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'] as const;
export type Tier = (typeof TIERS)[number];

export const TOOLS = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'paxel'] as const;
export type Tool = (typeof TOOLS)[number];

export interface Material {
  readonly id: string;
  /** The item a trim consumes. */
  readonly item: string;
  /** Vanilla texture path for the menu button. */
  readonly icon: string;
}

/** The vanilla armor trim materials, in the order the menu lists them. */
export const MATERIALS: readonly Material[] = [
  { id: 'quartz', item: 'minecraft:quartz', icon: 'textures/items/quartz' },
  { id: 'iron', item: 'minecraft:iron_ingot', icon: 'textures/items/iron_ingot' },
  { id: 'netherite', item: 'minecraft:netherite_ingot', icon: 'textures/items/netherite_ingot' },
  { id: 'redstone', item: 'minecraft:redstone', icon: 'textures/items/redstone_dust' },
  { id: 'copper', item: 'minecraft:copper_ingot', icon: 'textures/items/copper_ingot' },
  { id: 'gold', item: 'minecraft:gold_ingot', icon: 'textures/items/gold_ingot' },
  { id: 'emerald', item: 'minecraft:emerald', icon: 'textures/items/emerald' },
  { id: 'diamond', item: 'minecraft:diamond', icon: 'textures/items/diamond' },
  { id: 'lapis', item: 'minecraft:lapis_lazuli', icon: 'textures/items/dye_powder_blue_new' },
  { id: 'amethyst', item: 'minecraft:amethyst_shard', icon: 'textures/items/amethyst_shard' },
  { id: 'resin', item: 'minecraft:resin_brick', icon: 'textures/items/resin_brick' },
];

/** A tool the table can work on, trimmed or not. */
export interface TrimmableTool {
  readonly tier: Tier;
  readonly tool: Tool;
  readonly trim: Material | undefined;
}

/** Tools that come from another add-on, keyed to their untrimmed item's namespace. */
const CUSTOM: Partial<Record<Tool, string>> = { paxel: 'steveo' };

/** The untrimmed tool: vanilla, or the paxel add-on's item. */
export function vanillaId(tier: Tier, tool: Tool): string {
  return `${CUSTOM[tool] ?? 'minecraft'}:${tier}_${tool}`;
}

export function trimmedId(tier: Tier, tool: Tool, material: Material): string {
  return `steveo:${tier}_${tool}_${material.id}_trim`;
}

export function idOf(tool: TrimmableTool): string {
  return tool.trim === undefined ? vanillaId(tool.tier, tool.tool) : trimmedId(tool.tier, tool.tool, tool.trim);
}

export function findMaterial(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}

export function isTier(name: string): name is Tier {
  return (TIERS as readonly string[]).includes(name);
}

export function isTool(name: string): name is Tool {
  return (TOOLS as readonly string[]).includes(name);
}

const VANILLA = /^minecraft:([a-z]+)_([a-z]+)$/;
const PAXEL = /^steveo:([a-z]+)_(paxel)$/;
const TRIMMED = /^steveo:([a-z]+)_([a-z]+)_([a-z]+)_trim$/;

/** Reads an item id as a trimmable tool, or undefined when the table cannot work on it. */
export function parseTool(typeId: string): TrimmableTool | undefined {
  const trimmed = TRIMMED.exec(typeId);
  if (trimmed) {
    const [, tier = '', tool = '', material = ''] = trimmed;
    const trim = findMaterial(material);
    return isTier(tier) && isTool(tool) && trim ? { tier, tool, trim } : undefined;
  }
  const plain = VANILLA.exec(typeId) ?? PAXEL.exec(typeId);
  if (plain) {
    const [, tier = '', tool = ''] = plain;
    return isTier(tier) && isTool(tool) ? { tier, tool, trim: undefined } : undefined;
  }
  return undefined;
}

/**
 * Every item id the add-on relies on: the vanilla tools, the materials, and
 * every trimmed tool. Untrimmed paxels are left out; they exist only when the
 * paxel add-on is on too.
 */
export function allItemIds(): string[] {
  const ids: string[] = MATERIALS.map((m) => m.item);
  for (const tier of TIERS) {
    for (const tool of TOOLS) {
      if (CUSTOM[tool] === undefined) ids.push(vanillaId(tier, tool));
      for (const material of MATERIALS) ids.push(trimmedId(tier, tool, material));
    }
  }
  return ids;
}
