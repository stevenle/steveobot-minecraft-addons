/**
 * The lucky prize pool: every item type the game knows about, minus the ones a
 * survival player could never legitimately hold.
 *
 * The pool is read from `ItemTypes.getAll()` rather than a hand-kept list, so
 * new vanilla items (and items from other add-ons in the world) show up
 * without a code change. The catch is that the registry also holds operator
 * blocks, technical blocks, and Education Edition content, which the
 * denylists below strip out. Extend them when an illegal item turns up.
 */
import { ItemStack, ItemTypes } from '@minecraft/server';

/** Exact ids (without the `minecraft:` prefix) that are never handed out. */
const DENY = new Set([
  // Operator and creative-only blocks.
  'air', 'bedrock', 'invisible_bedrock', 'barrier', 'structure_block', 'structure_void', 'jigsaw',
  'command_block', 'chain_command_block', 'repeating_command_block', 'command_block_minecart',
  'allow', 'deny', 'border_block', 'light_block', 'debug_stick', 'mob_spawner', 'trial_spawner', 'vault',
  'end_portal_frame', 'reinforced_deepslate', 'budding_amethyst', 'petrified_oak_slab',
  'knowledge_book', 'test_block',
  // Blocks that exist but can never be picked up as an item.
  'farmland', 'grass_path', 'dirt_path', 'frosted_ice', 'fire', 'soul_fire', 'portal', 'end_portal',
  'end_gateway', 'water', 'flowing_water', 'lava', 'flowing_lava', 'moving_block', 'piston_arm_collision',
  'sticky_piston_arm_collision', 'bubble_column', 'chorus_plant', 'tripwire', 'redstone_wire',
  'daylight_detector_inverted', 'unlit_redstone_torch', 'unpowered_repeater', 'unpowered_comparator',
  'powered_repeater', 'powered_comparator', 'standing_sign', 'wall_sign', 'standing_banner', 'wall_banner',
  // Placeholders and leftovers.
  'info_update', 'info_update2', 'reserved6', 'unknown', 'client_request_placeholder_block', 'netherreactor',
  'glowingobsidian', 'stonecutter_legacy', 'camera', 'photo', 'portfolio', 'chalkboard', 'board',
  // Education Edition.
  'chemistry_table', 'compound_creator', 'element_constructor', 'lab_table', 'material_reducer',
  'glow_stick', 'sparkler', 'ice_bomb', 'balloon', 'medicine', 'bleach', 'rapid_fertilizer',
  'underwater_torch', 'underwater_tnt',
]);

/** Id patterns that are never handed out. */
const DENY_PATTERNS = [
  /_spawn_egg$/, // Spawn eggs are creative-only.
  /^light_block_\d+$/,
  /^infested_/, // Silk touch cannot pick these up.
  /^lit_/, // Furnace, redstone ore, pumpkin... mid-state blocks.
  /^item\./,
  /double_.*slab|_double_slab$/,
  /_wall_sign$/,
  /_standing_sign$/,
  /_wall_banner$/,
  /^element_\d+$/,
  /^compound/,
  /^colored_torch_/,
  /^hard_.*glass/,
  /^chemical_heat$/,
];

function isLegal(id: string): boolean {
  if (id.startsWith('minecraft:')) {
    const name = id.slice('minecraft:'.length);
    if (DENY.has(name)) return false;
    return !DENY_PATTERNS.some((pattern) => pattern.test(name));
  }
  // Items from other add-ons: spawn eggs are still creative-only.
  return !/_spawn_egg$/.test(id);
}

let pool: string[] | undefined;

/** Every legal item id. Built on first use, since the registry is not ready during early execution. */
export function prizePool(): string[] {
  if (!pool) {
    pool = ItemTypes.getAll()
      .map((type) => type.id)
      .filter(isLegal)
      .filter((id) => {
        // Some registry entries cannot be made into a stack; skip them up front.
        try {
          new ItemStack(id);
          return true;
        } catch {
          return false;
        }
      })
      .sort();
  }
  return pool;
}

/** A random legal item: one of an unstackable, up to a small handful of a stackable. */
export function randomPrize(): ItemStack {
  const ids = prizePool();
  const id = ids[Math.floor(Math.random() * ids.length)] ?? 'minecraft:diamond';
  const stack = new ItemStack(id);
  const most = Math.min(stack.maxAmount, 8);
  stack.amount = 1 + Math.floor(Math.random() * most);
  return stack;
}
