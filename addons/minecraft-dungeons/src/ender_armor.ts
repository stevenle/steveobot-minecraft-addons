/**
 * Ender Armor — "increase your hit points with armor that is truly
 * otherworldly!"
 *
 * Each piece is diamond-grade armor on its own (item JSON), with no
 * durability, so it never breaks. Wearing all four adds two things:
 *
 * - **Extra hit points.** Health Boost II (+4 hearts) while the set is on.
 *   Scripts cannot set max health directly, and overriding the player entity
 *   would collide with extra-hearts, so the bonus is a real status effect:
 *   applied with a long duration, topped up by a sweep, removed when a piece
 *   comes off. A player tag marks the boost as ours so a Health Boost potion
 *   is never stripped.
 * - **Blink.** Like an enderman, a hit from a mob or a projectile has a
 *   BLINK_CHANCE of missing entirely: the damage is cancelled and the wearer
 *   teleports a few blocks away, to solid ground, in a puff of purple. At
 *   most once every BLINK_COOLDOWN_TICKS.
 */
import {
  EntityComponentTypes,
  EquipmentSlot,
  Player,
  system,
  world,
  type Block,
  type Dimension,
  type Vector3,
} from '@minecraft/server';

import { log, particle, sound } from './common';

export const ENDER_PIECES: ReadonlyArray<[EquipmentSlot, string]> = [
  [EquipmentSlot.Head, 'steveo:ender_helmet'],
  [EquipmentSlot.Chest, 'steveo:ender_chestplate'],
  [EquipmentSlot.Legs, 'steveo:ender_leggings'],
  [EquipmentSlot.Feet, 'steveo:ender_boots'],
];

const BOOST_TAG = 'steveo:ender_boost';
/** Health Boost amplifier 1 is level II: +8 health, four hearts. */
const BOOST_AMPLIFIER = 1;
/** Applied for ten minutes and refreshed when under one, so the refresh is rare. */
const BOOST_TICKS = 20 * 60 * 10;
const BOOST_REFRESH_BELOW = 20 * 60;
const SWEEP_TICKS = 20;

const BLINK_CHANCE = 0.25;
const BLINK_COOLDOWN_TICKS = 60;
const BLINK_MIN = 4;
const BLINK_MAX = 8;
const BLINK_ATTEMPTS = 12;

/** Tick of each player's last blink. */
const lastBlink = new Map<string, number>();

/** How many Ender pieces the player has on, 0..4. */
export function enderPieces(player: Player): number {
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  if (equippable === undefined) return 0;
  let count = 0;
  for (const [slot, id] of ENDER_PIECES) {
    if (equippable.getEquipment(slot)?.typeId === id) count++;
  }
  return count;
}

function wearsFullSet(player: Player): boolean {
  return enderPieces(player) === ENDER_PIECES.length;
}

// ---------- extra hit points ----------

function updateBoost(player: Player): void {
  const effect = player.getEffect('health_boost');
  if (wearsFullSet(player)) {
    // A stronger Health Boost from a potion wins; leave it alone.
    if (effect !== undefined && effect.amplifier > BOOST_AMPLIFIER) return;
    if (effect === undefined || effect.amplifier < BOOST_AMPLIFIER || effect.duration < BOOST_REFRESH_BELOW) {
      player.addEffect('health_boost', BOOST_TICKS, { amplifier: BOOST_AMPLIFIER, showParticles: false });
    }
    player.addTag(BOOST_TAG);
    return;
  }
  if (!player.hasTag(BOOST_TAG)) return;
  player.removeTag(BOOST_TAG);
  if (effect !== undefined && effect.amplifier === BOOST_AMPLIFIER) player.removeEffect('health_boost');
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      updateBoost(player);
    } catch (err) {
      log.warn(`ender boost for ${player.name}: ${String(err)}`);
    }
  }
}, SWEEP_TICKS);

// ---------- blink ----------

function blockAt(dimension: Dimension, location: Vector3): Block | undefined {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

/** Blocks a player can stand in besides air: plants that do not block movement. */
const PASSABLE = new Set([
  'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern',
  'minecraft:snow_layer', 'minecraft:deadbush', 'minecraft:dandelion', 'minecraft:poppy',
]);

function isOpen(block: Block | undefined): boolean {
  return block !== undefined && (block.isAir || PASSABLE.has(block.typeId));
}

/** A spot near `around` with two open blocks over a solid one, or undefined. */
function findLanding(dimension: Dimension, around: Vector3, awayFrom: Vector3 | undefined): Vector3 | undefined {
  // Prefer the half-circle facing away from the attacker.
  const awayAngle =
    awayFrom === undefined ? undefined : Math.atan2(around.z - awayFrom.z, around.x - awayFrom.x);
  for (let attempt = 0; attempt < BLINK_ATTEMPTS; attempt++) {
    const spread = attempt < BLINK_ATTEMPTS / 2 && awayAngle !== undefined ? Math.PI / 2 : Math.PI;
    const angle = (awayAngle ?? 0) + (Math.random() * 2 - 1) * spread;
    const distance = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
    const x = Math.floor(around.x + Math.cos(angle) * distance);
    const z = Math.floor(around.z + Math.sin(angle) * distance);
    const baseY = Math.floor(around.y);
    for (let dy = 2; dy >= -4; dy--) {
      const y = baseY + dy;
      const floor = blockAt(dimension, { x, y: y - 1, z });
      if (floor === undefined || isOpen(floor) || floor.isLiquid) continue;
      if (!isOpen(blockAt(dimension, { x, y, z })) || !isOpen(blockAt(dimension, { x, y: y + 1, z }))) continue;
      return { x: x + 0.5, y, z: z + 0.5 };
    }
  }
  return undefined;
}

function puff(dimension: Dimension, at: Vector3): void {
  particle(dimension, 'steveo:ender_puff', { x: at.x, y: at.y + 1, z: at.z });
  sound(dimension, 'mob.endermen.portal', at);
}

/** Teleports the player away; false if there was nowhere safe to go. */
export function blink(player: Player, attacker: Vector3 | undefined): boolean {
  const from = player.location;
  const dimension = player.dimension;
  const landing = findLanding(dimension, from, attacker);
  if (landing === undefined) return false;
  if (!player.tryTeleport(landing, { checkForBlocks: true, keepVelocity: false })) return false;
  puff(dimension, from);
  puff(dimension, landing);
  return true;
}

world.beforeEvents.entityHurt.subscribe((event) => {
  const player = event.hurtEntity;
  if (!(player instanceof Player)) return;
  const { damagingEntity, damagingProjectile } = event.damageSource;
  const attacker = damagingProjectile ?? damagingEntity;
  if (attacker === undefined) return;
  const now = system.currentTick;
  const last = lastBlink.get(player.id);
  if (last !== undefined && now - last < BLINK_COOLDOWN_TICKS) return;
  if (Math.random() >= BLINK_CHANCE) return;
  // Equipment reads are allowed in a before-event; the teleport is not.
  if (!wearsFullSet(player)) return;
  const attackerAt = attacker.isValid ? { ...attacker.location } : undefined;
  lastBlink.set(player.id, now);
  event.cancel = true;
  system.run(() => {
    if (!player.isValid) return;
    // Nowhere to land: the hit is still dodged, just without the teleport.
    if (!blink(player, attackerAt)) puff(player.dimension, player.location);
  });
});

world.afterEvents.playerLeave.subscribe((event) => lastBlink.delete(event.playerId));
