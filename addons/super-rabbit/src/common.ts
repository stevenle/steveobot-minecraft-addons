/** Shared helpers and entity identifiers for the Super Rabbit add-on. */
import { GameMode, Player, world, type Dimension, type Entity, type RawMessage, type Vector3 } from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

export const log = createLogger('super-rabbit');
export const PREFIX: RawMessage = { text: `${Format.yellow}[Super Rabbit]${Format.reset} ` };

export const SINGING_DOG = 'steveo:singing_dog';
export const VIKING_BOT = 'steveo:viking_bot';
export const ROBO_CRAB = 'steveo:robo_crab';
export const ROBO_LIZARD = 'steveo:robo_lizard';
export const ROCKET_ROBO = 'steveo:rocket_robo';
export const KING_VIKING = 'steveo:king_viking';
export const BILLIP = 'steveo:billip';
export const ROBO_RABBIT_BOY = 'steveo:robo_rabbit_boy';
export const SUPER_RABBIT_BOSS = 'steveo:super_rabbit_boss';
export const MEGA_ROBO = 'steveo:mega_robo';
export const BOOM_BOLT = 'steveo:boom_bolt';

export const CREW_BOSSES = [ROBO_RABBIT_BOY, BILLIP, SUPER_RABBIT_BOSS, MEGA_ROBO] as const;

export const DIMENSIONS = ['overworld', 'nether', 'the_end'] as const;

export function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage({
    rawtext: [PREFIX, args.length ? { translate: key, with: args } : { translate: key }],
  });
}

export function announceNear(dimension: Dimension, location: Vector3, maxDistance: number, key: string, ...args: string[]): void {
  for (const player of dimension.getPlayers({ location, maxDistance })) {
    say(player, key, ...args);
  }
}

export function forEachDimension(fn: (dimension: Dimension) => void): void {
  for (const id of DIMENSIONS) {
    try {
      fn(world.getDimension(id));
    } catch {
      // Dimension not loaded.
    }
  }
}

export function removeQuietly(entity: Entity): void {
  try {
    if (entity.isValid) entity.remove();
  } catch {
    // Already gone.
  }
}

export function isVulnerable(player: Player): boolean {
  try {
    const mode = player.getGameMode();
    return mode !== GameMode.Creative && mode !== GameMode.Spectator;
  } catch {
    return false;
  }
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function length(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function dist(a: Vector3, b: Vector3): number {
  return length(sub(a, b));
}

export function normalize(v: Vector3): Vector3 {
  const len = length(v);
  return len === 0 ? v : scale(v, 1 / len);
}

export function yaw(v: Vector3, degrees: number): Vector3 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}
