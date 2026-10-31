/**
 * Creeperite armor.
 *
 * Each piece is netherite-grade armor with 2000 durability (item JSON). On
 * top of that:
 *
 * - **Blast-proof.** Each piece worn cuts explosion damage by 12.5%, so the
 *   full set halves it. Creeperite is the stone creepers build with.
 * - **Volatile.** With the full set on, a hit from a mob (or a mob's arrow)
 *   has a BLAST_CHANCE of setting the wearer off like a creeper: an
 *   explosion centred on them that hurts the mobs around them. The wearer,
 *   other players, and tamed pets take no damage from it, and it never
 *   breaks blocks, so it is safe to wear at home. At most once every
 *   BLAST_COOLDOWN_TICKS.
 */
import {
  EntityComponentTypes,
  EntityDamageCause,
  EquipmentSlot,
  Player,
  system,
  world,
  type Entity,
  type Vector3,
} from '@minecraft/server';

import { distance, isTamed, log, particle, sound } from './common';

export const ARMOR_PIECES: ReadonlyArray<[EquipmentSlot, string]> = [
  [EquipmentSlot.Head, 'steveo:creeperite_helmet'],
  [EquipmentSlot.Chest, 'steveo:creeperite_chestplate'],
  [EquipmentSlot.Legs, 'steveo:creeperite_leggings'],
  [EquipmentSlot.Feet, 'steveo:creeperite_boots'],
];

const BLAST_CHANCE = 0.2;
const BLAST_COOLDOWN_TICKS = 100;
const BLAST_POWER = 3;
/** Players and pets this close to a creeperite blast are spared by it. */
const BLAST_SPARE_RADIUS = 10;
const BLAST_REDUCTION_PER_PIECE = 0.125;

const lastBlast = new Map<string, number>();

/**
 * Recent armor blasts. Their damage events should fire inside
 * createExplosion, but each is kept for one more tick in case the game
 * applies the damage later in the frame.
 */
let activeBlasts: Array<{ tick: number; at: Vector3; wearerId: string }> = [];

function pruneBlasts(): void {
  const now = system.currentTick;
  activeBlasts = activeBlasts.filter((blast) => now - blast.tick <= 1);
}

/** How many creeperite pieces the entity has on, 0..4. */
export function creeperitePieces(entity: Entity): number {
  const equippable = entity.getComponent(EntityComponentTypes.Equippable);
  if (equippable === undefined) return 0;
  let count = 0;
  for (const [slot, id] of ARMOR_PIECES) {
    if (equippable.getEquipment(slot)?.typeId === id) count++;
  }
  return count;
}

/** Sets the player off like a creeper. Returns false if the explosion did not happen. */
export function armorBlast(player: Player): boolean {
  const dimension = player.dimension;
  const at = { x: player.location.x, y: player.location.y + 0.5, z: player.location.z };
  pruneBlasts();
  activeBlasts.push({ tick: system.currentTick, at, wearerId: player.id });
  lastBlast.set(player.id, system.currentTick);
  try {
    sound(dimension, 'random.fuse', at, 1.4);
    particle(dimension, 'steveo:creeperite_burst', at);
    return dimension.createExplosion(at, BLAST_POWER, { breaksBlocks: false, causesFire: false, source: player });
  } catch (err) {
    log.warn(`armor blast: ${String(err)}`);
    return false;
  }
}

function isExplosion(cause: string): boolean {
  return cause === EntityDamageCause.entityExplosion || cause === EntityDamageCause.blockExplosion;
}

world.afterEvents.entityHurt.subscribe((event) => {
  const player = event.hurtEntity;
  if (!(player instanceof Player) || !player.isValid) return;
  const { cause, damagingEntity } = event.damageSource;
  if (damagingEntity === undefined || damagingEntity instanceof Player || isExplosion(cause)) return;
  const last = lastBlast.get(player.id);
  if (last !== undefined && system.currentTick - last < BLAST_COOLDOWN_TICKS) return;
  if (Math.random() >= BLAST_CHANCE) return;
  if (creeperitePieces(player) < ARMOR_PIECES.length) return;
  armorBlast(player);
});

world.beforeEvents.entityHurt.subscribe((event) => {
  if (!isExplosion(event.damageSource.cause)) return;
  const hurt = event.hurtEntity;
  pruneBlasts();
  // Inside an armor blast: spare the wearer, other players, and pets.
  for (const blast of activeBlasts) {
    const spared = hurt.id === blast.wearerId || hurt instanceof Player || isTamed(hurt);
    if (spared && distance(hurt.location, blast.at) <= BLAST_SPARE_RADIUS) {
      event.cancel = true;
      return;
    }
  }
  if (!(hurt instanceof Player)) return;
  const pieces = creeperitePieces(hurt);
  if (pieces > 0) event.damage *= 1 - pieces * BLAST_REDUCTION_PER_PIECE;
});

world.afterEvents.playerLeave.subscribe((event) => lastBlast.delete(event.playerId));
