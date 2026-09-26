/**
 * Using a held item without stealing clicks from the world.
 *
 * A custom item's "use" reaches scripts two ways: `itemUse` (in the air) and
 * `playerInteractWithBlock` (on a block). Listening to both is what makes a
 * gun fire when you point it at the ground, but it also makes it fire when
 * you open a chest, get into bed, or flip a lever with it in hand.
 * `onItemUse` listens to both and skips any click whose real target was an
 * interactive block or a rideable/tradeable entity, unless the player is
 * sneaking, which is vanilla's "use the item, not the block" gesture.
 */
import { system, world, type Block, type Entity, type ItemStack, type Player } from '@minecraft/server';

/** Blocks (by name without namespace) whose own "use" action should win over a held item's. */
const INTERACTIVE_BLOCKS: ReadonlySet<string> = new Set([
  'crafting_table', 'crafter', 'enchanting_table', 'grindstone', 'loom', 'cartography_table',
  'stonecutter_block', 'smithing_table', 'beacon', 'lectern', 'noteblock', 'jukebox', 'composter',
  'respawn_anchor', 'cauldron', 'flower_pot', 'ender_chest', 'decorated_pot', 'chiseled_bookshelf',
  'bell', 'lever', 'daylight_detector', 'daylight_detector_inverted', 'vault', 'dragon_egg',
  'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw',
  // Our own: super-enchantments' fountain opens a menu.
  'enchantment_fountain',
]);

/** Families of interactive blocks, matched on the end of the name: `oak_fence_gate`, `glow_frame`. */
const INTERACTIVE_SUFFIX =
  /(^|_)(bed|door|trapdoor|fence_gate|button|anvil|sign|campfire|cake|frame|repeater|comparator|shulker_box)$/;

/** Entities a click talks to (trade, ride, open) rather than shoots. */
const INTERACTIVE_ENTITIES: ReadonlySet<string> = new Set([
  'villager', 'villager_v2', 'wandering_trader', 'horse', 'donkey', 'mule', 'skeleton_horse',
  'zombie_horse', 'llama', 'trader_llama', 'camel', 'boat', 'chest_boat', 'minecart',
  'chest_minecart', 'hopper_minecart', 'command_block_minecart', 'armor_stand', 'allay',
]);

function nameOf(typeId: string): string {
  const colon = typeId.indexOf(':');
  return colon < 0 ? typeId : typeId.slice(colon + 1);
}

/** True when clicking `block` opens, toggles, or otherwise uses it. */
export function isInteractiveBlock(block: Block): boolean {
  try {
    const name = nameOf(block.typeId);
    if (INTERACTIVE_BLOCKS.has(name) || INTERACTIVE_SUFFIX.test(name)) return true;
    // Chests, barrels, furnaces, hoppers, dispensers, brewing stands, ...
    return block.getComponent('minecraft:inventory') !== undefined;
  } catch {
    return false;
  }
}

/** True when clicking `entity` trades with, mounts, or opens it. */
export function isInteractiveEntity(entity: Entity): boolean {
  try {
    return INTERACTIVE_ENTITIES.has(nameOf(entity.typeId));
  } catch {
    return false;
  }
}

/** Tick at which each player last clicked something interactive. */
const interactedAt = new Map<string, number>();
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  // Before-events run ahead of the after-events for the same click, so the
  // mark is always in place by the time a use is considered.
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!event.player.isSneaking && isInteractiveBlock(event.block)) {
      interactedAt.set(event.player.id, system.currentTick);
    }
  });
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!event.player.isSneaking && isInteractiveEntity(event.target)) {
      interactedAt.set(event.player.id, system.currentTick);
    }
  });
  world.afterEvents.playerLeave.subscribe((event) => {
    interactedAt.delete(event.playerId);
  });
}

/**
 * Calls `onUse` once per click when a player uses an item matching `matches`,
 * in the air or on a block, except when the click opened a chest, a door, a
 * bed, a villager's trades, and so on. Sneak-clicking always uses the item.
 */
export function onItemUse(
  matches: (typeId: string) => boolean,
  onUse: (player: Player, item: ItemStack) => void,
): void {
  install();
  /** Tick of each player's last delivered use, to fold itemUse + block interaction into one. */
  const usedAt = new Map<string, number>();
  world.afterEvents.playerLeave.subscribe((event) => usedAt.delete(event.playerId));
  const deliver = (player: Player, item: ItemStack) => {
    if (!matches(item.typeId)) return;
    const now = system.currentTick;
    // The after-events can land a tick after the click on a busy server.
    const interacted = interactedAt.get(player.id);
    if (interacted !== undefined && now - interacted <= 1) return;
    if (usedAt.get(player.id) === now) return;
    usedAt.set(player.id, now);
    onUse(player, item);
  };
  world.afterEvents.itemUse.subscribe((event) => deliver(event.source, event.itemStack));
  // Using an item on a block fires this instead of (or as well as) itemUse.
  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.itemStack && event.isFirstEvent) deliver(event.player, event.itemStack);
  });
}
