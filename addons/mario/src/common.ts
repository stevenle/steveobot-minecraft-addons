/** Shared helpers for the Mario add-on's modules. */
import { GameMode, Player, world, type Dimension, type Entity, type RawMessage, type Vector3 } from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

export const log = createLogger('mario');
export const PREFIX: RawMessage = { text: `${Format.gray}[Mario]${Format.reset} ` };

export const DIMENSIONS = ['overworld', 'nether', 'the_end'] as const;

/** Sends a translated, prefixed chat line. */
export function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage({
    rawtext: [PREFIX, args.length ? { translate: key, with: args } : { translate: key }],
  });
}

/** Runs `fn` for every loaded dimension, skipping any that throw. */
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

/** True for players a mob should bother: not creative, not spectating. */
export function isVulnerable(player: Player): boolean {
  try {
    const mode = player.getGameMode();
    return mode !== GameMode.Creative && mode !== GameMode.Spectator;
  } catch {
    return false;
  }
}

// ---------- vectors ----------

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

export function normalize(v: Vector3): Vector3 {
  const len = length(v);
  return len === 0 ? v : scale(v, 1 / len);
}

/** Rotates `v` about the vertical axis by `degrees`. */
export function yaw(v: Vector3, degrees: number): Vector3 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}
