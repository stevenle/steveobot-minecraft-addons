/**
 * Firebrand — "crafted in the blackest depths of the Fiery Forge and
 * enchanted with fiery powers."
 *
 * The item JSON makes it a diamond-grade axe (damage, chopping speed, axe
 * tags) with no durability, so it never breaks. This module adds the fire:
 *
 * - Every attack swing, hit or miss, sweeps an arc of flame through the air
 *   in front of the player, from upper right to lower left, drawn over a
 *   few ticks so it moves with the arm.
 * - Every melee hit sets the target alight for BURN_SECONDS and throws a
 *   puff of flame, like Minecraft Dungeons' Burning enchantment. It stacks
 *   with a vanilla Fire Aspect book (the longer burn wins).
 */
import { EntitySwingSource, Player, system, world, type Vector3 } from '@minecraft/server';

import { add, centerOf, mainhand, particle, scale, sound } from './common';

export const FIREBRAND_ID = 'steveo:firebrand';

/** How long a Firebrand hit keeps the target burning. */
const BURN_SECONDS = 5;
const FLAMES_PER_HIT = 6;
/** Points along the swing arc, and the ticks they are spread over. */
const ARC_POINTS = 9;
const ARC_TICKS = 3;
/** How far in front of the eyes the arc sits, and how wide it sweeps. */
const ARC_REACH = 1.3;
const ARC_WIDTH = 1.0;

function normalize(v: Vector3): Vector3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return scale(v, 1 / len);
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** Sweeps flame from the player's upper right to lower left, in their view's frame. */
function fireArc(player: Player): void {
  const forward = player.getViewDirection();
  // Looking straight up or down leaves no horizontal "right"; pick one.
  const right = Math.abs(forward.y) > 0.99 ? { x: 1, y: 0, z: 0 } : normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const eye = player.getHeadLocation();
  const dimension = player.dimension;
  for (let i = 0; i < ARC_POINTS; i++) {
    const t = i / (ARC_POINTS - 1);
    // A shallow curve that bulges forward in the middle of the swing.
    const bulge = Math.sin(t * Math.PI) * 0.35;
    const at = add(
      add(eye, scale(forward, ARC_REACH + bulge)),
      add(scale(right, ARC_WIDTH * (0.9 - 1.8 * t)), scale(up, ARC_WIDTH * (0.45 - 1.1 * t))),
    );
    system.runTimeout(() => {
      particle(dimension, 'steveo:fire_swipe', at);
      if (i % 2 === 0) particle(dimension, 'minecraft:basic_flame_particle', at);
    }, Math.floor(t * ARC_TICKS));
  }
  sound(dimension, 'fire.ignite', eye, 1.3, 0.5);
}

world.afterEvents.playerSwingStart.subscribe(
  (event) => {
    if (event.heldItemStack?.typeId !== FIREBRAND_ID) return;
    fireArc(event.player);
  },
  { swingSource: EntitySwingSource.Attack },
);

world.afterEvents.entityHitEntity.subscribe((event) => {
  const { damagingEntity: attacker, hitEntity: target } = event;
  if (!(attacker instanceof Player)) return;
  if (mainhand(attacker)?.typeId !== FIREBRAND_ID) return;
  if (!target.isValid) return;
  try {
    target.setOnFire(BURN_SECONDS, true);
  } catch {
    // Some entities (items, paintings) cannot burn; the hit itself still lands.
    return;
  }
  const center = centerOf(target);
  for (let i = 0; i < FLAMES_PER_HIT; i++) {
    particle(target.dimension, 'minecraft:basic_flame_particle', {
      x: center.x + (Math.random() - 0.5) * 0.6,
      y: center.y + (Math.random() - 0.5) * 0.8,
      z: center.z + (Math.random() - 0.5) * 0.6,
    });
  }
  sound(target.dimension, 'mob.blaze.shoot', center, 1.4, 0.5);
});
