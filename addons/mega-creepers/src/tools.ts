/**
 * Creeperite tools are defined almost entirely in item JSON: `digger` speeds,
 * attack damage, 2000 durability, and the `is_<tool>` / `diamond_tier` tags
 * that make the game treat them as the real thing.
 *
 * Whether those tags alone let a custom hoe till, a shovel make paths, and
 * an axe strip logs depends on the game build, so this is the fallback (as
 * in the paxel add-on): after the interaction, if the block is still
 * untouched, the script converts it and wears the tool by one point. If the
 * game already did it, the block has changed and nothing happens twice.
 */
import {
  BlockPermutation,
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  ItemComponentTypes,
  world,
  type Block,
  type Player,
} from '@minecraft/server';

import { log } from './common';

const TILLABLE = new Set(['minecraft:grass_block', 'minecraft:dirt', 'minecraft:dirt_path', 'minecraft:grass_path']);
const PATHABLE = new Set(['minecraft:grass_block', 'minecraft:dirt', 'minecraft:coarse_dirt', 'minecraft:podzol', 'minecraft:mycelium', 'minecraft:rooted_dirt']);
const STRIPPABLE = /^minecraft:(?!stripped_)([a-z_]+_(log|wood|stem|hyphae)|bamboo_block)$/;

function wear(player: Player): void {
  if (player.getGameMode() === GameMode.Creative) return;
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
  const durability = held?.getComponent(ItemComponentTypes.Durability);
  if (equippable === undefined || held === undefined || durability === undefined) return;
  if (durability.damage + 1 >= durability.maxDurability) {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    player.playSound('random.break');
    return;
  }
  durability.damage += 1;
  equippable.setEquipment(EquipmentSlot.Mainhand, held);
}

function openAbove(block: Block): boolean {
  return block.above()?.isAir === true;
}

function till(block: Block): string | undefined {
  if (!TILLABLE.has(block.typeId) || !openAbove(block)) return undefined;
  block.setPermutation(BlockPermutation.resolve('minecraft:farmland'));
  return 'use.gravel';
}

function path(block: Block): string | undefined {
  if (!PATHABLE.has(block.typeId) || !openAbove(block)) return undefined;
  block.setPermutation(BlockPermutation.resolve('minecraft:grass_path'));
  return 'use.grass';
}

function strip(block: Block): string | undefined {
  if (!STRIPPABLE.test(block.typeId)) return undefined;
  const stripped = block.typeId.replace('minecraft:', 'minecraft:stripped_');
  const axis = block.permutation.getState('pillar_axis');
  block.setPermutation(
    typeof axis === 'string' ? BlockPermutation.resolve(stripped, { pillar_axis: axis }) : BlockPermutation.resolve(stripped),
  );
  return 'use.wood';
}

const ACTIONS: Record<string, (block: Block) => string | undefined> = {
  'steveo:creeperite_hoe': till,
  'steveo:creeperite_shovel': path,
  'steveo:creeperite_axe': strip,
};

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent || event.itemStack === undefined || event.player.isSneaking) return;
  const action = ACTIONS[event.itemStack.typeId];
  if (action === undefined) return;
  try {
    const soundId = action(event.block);
    if (soundId === undefined) return;
    event.player.playSound(soundId, { location: event.block.location });
    wear(event.player);
  } catch (err) {
    log.warn(`creeperite tool on ${event.block.typeId}: ${String(err)}`);
  }
});
