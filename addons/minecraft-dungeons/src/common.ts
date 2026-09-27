/** Helpers shared by the four items in this add-on. */
import {
  EntityComponentTypes,
  EquipmentSlot,
  Player,
  type Dimension,
  type Entity,
  type ItemStack,
  type MolangVariableMap,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

export const log = createLogger('minecraft-dungeons');
const PREFIX: RawMessage = { text: `${Format.gray}[Dungeons]${Format.reset} ` };

/** Sends a translated, prefixed chat line. */
export function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage({ rawtext: [PREFIX, { translate: key, with: args }] });
}

export function actionBar(player: Player, key: string, ...args: string[]): void {
  try {
    player.onScreenDisplay.setActionBar({ translate: key, with: args });
  } catch {
    // The player may be mid-disconnect.
  }
}

export function mainhand(player: Player): ItemStack | undefined {
  return player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function particle(dimension: Dimension, id: string, location: Vector3, vars?: MolangVariableMap): void {
  try {
    dimension.spawnParticle(id, location, vars);
  } catch {
    // Particles are decoration; an unloaded chunk should not break anything.
  }
}

export function sound(dimension: Dimension, id: string, location: Vector3, pitch = 1, volume = 1): void {
  try {
    dimension.playSound(id, location, { pitch, volume });
  } catch {
    // Sound is decoration.
  }
}

/** Middle of an entity's body; `location` is its feet. */
export function centerOf(entity: Entity): Vector3 {
  const feet = entity.location;
  const head = entity.getHeadLocation();
  return { x: feet.x, y: (feet.y + head.y) / 2, z: feet.z };
}

/** True for things with health that are not players: mobs, not items, arrows, or orbs. */
export function isMob(entity: Entity): boolean {
  try {
    return entity.isValid && !(entity instanceof Player) && entity.getComponent('minecraft:health') !== undefined;
  } catch {
    return false;
  }
}

/**
 * True for tamed pets (Tim, wolves, cats, parrots), which friendly fire should
 * skip. Anyone's pets, not just the shooter's: once tamed, a mob usually
 * drops its `minecraft:tameable` component (Tim does, like a wolf), so the
 * owner is no longer readable from script, but `minecraft:is_tamed` stays.
 */
export function isPet(entity: Entity): boolean {
  try {
    return entity.getComponent(EntityComponentTypes.IsTamed) !== undefined;
  } catch {
    return false;
  }
}
