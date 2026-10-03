/**
 * The Fire Flower and the question block.
 *
 * Fire Flower: use it (right-click / tap) to throw a bouncing fireball. It
 * never runs out, but each player can have only a few fireballs in the air
 * at once, as in the games.
 *
 * Question block: what it drops is its loot table
 * (loot_tables/blocks/question_block.json), so explosions pay out too. The
 * script only adds the coin sound when a player breaks one.
 */
import { system, world, type Player } from '@minecraft/server';

import { onItemUse } from '@shared/use';

import { activeFireballs, launchFireball } from './fireball';
import { add, say, scale } from './common';

export const FIRE_FLOWER = 'steveo:fire_flower';
export const QUESTION_BLOCK = 'steveo:question_block';

const MAX_FIREBALLS = 3;
const THROW_COOLDOWN_TICKS = 6;
const HOLD_CHECK_TICKS = 10;

const lastThrow = new Map<string, number>();
const hinted = new Set<string>();

/** Throws a Fire Flower fireball from the player's eyes, slightly downward so it bounces. */
export function throwFireball(player: Player): boolean {
  const now = system.currentTick;
  if (now - (lastThrow.get(player.id) ?? -THROW_COOLDOWN_TICKS) < THROW_COOLDOWN_TICKS) return false;
  if (activeFireballs(player.id) >= MAX_FIREBALLS) return false;
  lastThrow.set(player.id, now);
  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  const dir = { x: view.x, y: view.y - 0.15, z: view.z };
  const ok = launchFireball(player, 'flower', add(head, scale(view, 0.6)), dir);
  if (ok) player.dimension.playSound('mob.blaze.shoot', head, { volume: 0.6, pitch: 1.5 });
  return ok;
}

onItemUse(
  (typeId) => typeId === FIRE_FLOWER,
  (player) => {
    throwFireball(player);
  },
);

system.beforeEvents.startup.subscribe((event) => {
  event.blockComponentRegistry.registerCustomComponent(QUESTION_BLOCK, {
    onPlayerBreak: (e) => {
      const at = { x: e.block.location.x + 0.5, y: e.block.location.y + 0.5, z: e.block.location.z + 0.5 };
      e.dimension.playSound('random.orb', at, { pitch: 1.8 });
      e.dimension.playSound('random.pop', at, { pitch: 1.2 });
    },
  });
});

// Explain the Fire Flower the first time a player holds it.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (hinted.has(player.id)) continue;
    try {
      const held = player.getComponent('minecraft:inventory')?.container.getItem(player.selectedSlotIndex);
      if (held?.typeId !== FIRE_FLOWER) continue;
      hinted.add(player.id);
      say(player, 'mario.hint.fire_flower');
    } catch {
      // Player is mid-respawn.
    }
  }
}, HOLD_CHECK_TICKS);

world.afterEvents.playerLeave.subscribe((event) => {
  lastThrow.delete(event.playerId);
  hinted.delete(event.playerId);
});
