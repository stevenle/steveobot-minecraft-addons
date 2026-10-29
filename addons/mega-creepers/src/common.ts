/** Helpers shared by the Mega Creepers modules. */
import {
  EntityComponentTypes,
  GameMode,
  ItemStack,
  Player,
  type Dimension,
  type Entity,
  type MolangVariableMap,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

export const log = createLogger('mega-creepers');
const PREFIX: RawMessage = { text: `${Format.green}[Mega Creepers]${Format.reset} ` };

export const MEGA_CREEPER = 'steveo:mega_creeper';

/** Sends a translated, prefixed chat line. */
export function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage({ rawtext: [PREFIX, args.length ? { translate: key, with: args } : { translate: key }] });
}

export function actionBar(player: Player, key: string, ...args: string[]): void {
  try {
    player.onScreenDisplay.setActionBar(args.length ? { translate: key, with: args } : { translate: key });
  } catch {
    // The player may be mid-disconnect.
  }
}

/** True for players a mob should bother: not creative, not spectating. */
export function isVulnerable(player: Player): boolean {
  try {
    const mode = player.getGameMode();
    return mode !== GameMode.Creative && mode !== GameMode.Spectator;
  } catch {
    return false;
  }
}

export function isTamed(entity: Entity): boolean {
  try {
    return entity.getComponent(EntityComponentTypes.IsTamed) !== undefined;
  } catch {
    return false;
  }
}

export function give(player: Player, id: string, amount = 1): void {
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (inventory === undefined) return;
  const leftover = inventory.addItem(new ItemStack(id, amount));
  if (leftover !== undefined) player.dimension.spawnItem(leftover, player.location);
}

// ---------- vectors ----------

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// ---------- effects ----------

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
