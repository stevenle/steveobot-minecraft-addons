/**
 * Fireballs, for the Fire Flower and for Bowser's breath.
 *
 * Flight is simulated here, the way potato-gun does it: the `steveo:fireball`
 * entity has no projectile component and no gravity, and the script steers
 * it every tick and raycasts along each step to decide what it hit. That
 * sidesteps the engine projectile changes on 1.26.50 (see CLAUDE.md).
 *
 * Fire Flower fireballs arc down and bounce along the ground like Mario's,
 * fizzling on a wall, in water, or after a few bounces. Bowser's fly
 * straight, are twice the size, and only hurt players. Neither kind lights
 * anything: no block fire, no burning mobs. Damage is plain projectile damage.
 */
import { EntityDamageCause, Direction, GameMode, Player, system, world, type Block, type Dimension, type Entity, type Vector3 } from '@minecraft/server';

import { add, length, log, normalize, removeQuietly, scale, sub, forEachDimension } from './common';

const FIREBALL_ENTITY = 'steveo:fireball';
const FIREBALL_FAMILY = 'steveo_fireball';
/** How strongly the entity is pulled back onto the simulated path each tick (0..1). */
const TRACK_GAIN = 0.5;
const SWEEP_INTERVAL_TICKS = 100;

export type FireballKind = 'flower' | 'bowser';

interface Spec {
  /** Blocks per tick. */
  speed: number;
  /** Downward acceleration in blocks per tick². */
  gravity: number;
  /** Bounces off the floor before fizzling. */
  bounces: number;
  /** Upward speed after a bounce. */
  bounceSpeed: number;
  damage: number;
  maxTicks: number;
  /** Hit radius; also how close an entity must pass to be hit. */
  radius: number;
  spawnEvent: string;
  playersOnly: boolean;
}

const SPECS: Readonly<Record<FireballKind, Spec>> = {
  flower: {
    speed: 0.8, gravity: 0.06, bounces: 4, bounceSpeed: 0.4, damage: 5, maxTicks: 80,
    radius: 0.3, spawnEvent: 'steveo:small', playersOnly: false,
  },
  bowser: {
    speed: 0.55, gravity: 0, bounces: 0, bounceSpeed: 0, damage: 6, maxTicks: 100,
    radius: 0.6, spawnEvent: 'steveo:big', playersOnly: true,
  },
};

interface Flight {
  kind: FireballKind;
  spec: Spec;
  entity: Entity;
  dimension: Dimension;
  shooterId: string;
  pos: Vector3;
  vel: Vector3;
  bounces: number;
  age: number;
  teleport: boolean;
  lastActual: Vector3;
}

const flights = new Map<string, Flight>();

/** How many fireballs `shooterId` currently has in the air. */
export function activeFireballs(shooterId: string): number {
  let n = 0;
  for (const f of flights.values()) if (f.shooterId === shooterId) n++;
  return n;
}

export function fireballCount(): number {
  return flights.size;
}

/** Launches a fireball from `from` along `dir`. Returns false if it could not be spawned. */
export function launchFireball(shooter: Entity, kind: FireballKind, from: Vector3, dir: Vector3): boolean {
  const spec = SPECS[kind];
  let entity: Entity;
  try {
    entity = shooter.dimension.spawnEntity(FIREBALL_ENTITY, from, { spawnEvent: spec.spawnEvent });
  } catch (err) {
    log.error('spawning a fireball failed', err);
    return false;
  }
  const flight: Flight = {
    kind, spec, entity, dimension: shooter.dimension, shooterId: shooter.id,
    pos: from, vel: scale(normalize(dir), spec.speed), bounces: spec.bounces,
    age: 0, teleport: false, lastActual: entity.location,
  };
  flights.set(entity.id, flight);
  return true;
}

function canHit(entity: Entity, flight: Flight): boolean {
  try {
    if (!entity.isValid || entity.id === flight.shooterId) return false;
    if (entity instanceof Player) return entity.getGameMode() !== GameMode.Spectator;
    if (flight.spec.playersOnly) return false;
    return entity.getComponent('minecraft:health') !== undefined;
  } catch {
    return false;
  }
}

type Impact = { at: Vector3; entity?: Entity; block?: Block; face?: Direction };

function sweep(flight: Flight, from: Vector3, dir: Vector3, distance: number): Impact | undefined {
  const { radius } = flight.spec;
  let best: Impact | undefined;
  let bestDist = Infinity;

  const hit = flight.dimension.getBlockFromRay(from, dir, {
    maxDistance: distance + radius,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });
  if (hit) {
    const at = add(hit.block.location, hit.faceLocation);
    bestDist = length(sub(at, from));
    best = { at, block: hit.block, face: hit.face };
  }

  for (const e of flight.dimension.getEntitiesFromRay(from, dir, { maxDistance: distance + radius, excludeFamilies: [FIREBALL_FAMILY] })) {
    if (e.distance >= bestDist || !canHit(e.entity, flight)) continue;
    bestDist = e.distance;
    best = { at: add(from, scale(dir, e.distance)), entity: e.entity };
  }
  if (best?.entity) return best;

  // Fat fireballs also catch anything passing within their radius of the path's end.
  const end = add(from, scale(dir, Math.min(distance, bestDist)));
  for (const e of flight.dimension.getEntities({ location: end, maxDistance: radius + 0.5, excludeFamilies: [FIREBALL_FAMILY] })) {
    if (!canHit(e, flight)) continue;
    return { at: end, entity: e };
  }
  return best;
}

function fizzle(flight: Flight, at: Vector3): void {
  try {
    flight.dimension.spawnParticle('minecraft:lava_particle', at);
    flight.dimension.playSound('random.fizz', at, { volume: 0.5, pitch: 1.6 });
  } catch {
    // Cosmetic.
  }
  finish(flight);
}

function finish(flight: Flight): void {
  flights.delete(flight.entity.id);
  removeQuietly(flight.entity);
}

function hurt(target: Entity, flight: Flight): void {
  const shooter = world.getEntity(flight.shooterId);
  try {
    target.applyDamage(flight.spec.damage, {
      damagingProjectile: flight.entity,
      ...(shooter ? { damagingEntity: shooter } : {}),
    });
  } catch {
    try {
      target.applyDamage(flight.spec.damage, {
        cause: EntityDamageCause.projectile,
        ...(shooter ? { damagingEntity: shooter } : {}),
      });
    } catch (err) {
      log.warn(`fireball damage on ${target.typeId} failed: ${String(err)}`);
    }
  }
}

function step(flight: Flight): void {
  const { entity, spec } = flight;
  if (!entity.isValid || flight.age >= spec.maxTicks) {
    finish(flight);
    return;
  }

  try {
    if (flight.dimension.getBlock(flight.pos)?.isLiquid) {
      fizzle(flight, flight.pos);
      return;
    }
    const distance = length(flight.vel);
    if (distance > 0) {
      const impact = sweep(flight, flight.pos, scale(flight.vel, 1 / distance), distance);
      if (impact?.entity) {
        hurt(impact.entity, flight);
        fizzle(flight, impact.at);
        return;
      }
      if (impact) {
        if (impact.face === Direction.Up && flight.bounces > 0 && flight.vel.y < 0) {
          // Bounce: sit on the floor, then hop back up keeping the forward motion.
          flight.bounces--;
          flight.pos = add(impact.at, { x: 0, y: 0.05, z: 0 });
          flight.vel = { x: flight.vel.x, y: spec.bounceSpeed, z: flight.vel.z };
        } else {
          fizzle(flight, impact.at);
          return;
        }
      }
    }
  } catch {
    // Flew into an unloaded chunk or out of the world.
    finish(flight);
    return;
  }

  const next = add(flight.pos, flight.vel);
  try {
    const actual = entity.location;
    if (flight.age === 2 && length(sub(actual, flight.lastActual)) < 0.05) {
      log.warn('fireball entity ignores impulses; falling back to teleporting');
      flight.teleport = true;
    }
    if (flight.teleport) {
      entity.teleport(next);
    } else {
      entity.clearVelocity();
      entity.applyImpulse(add(flight.vel, scale(sub(flight.pos, actual), TRACK_GAIN)));
    }
  } catch (err) {
    log.warn(`moving a fireball failed: ${String(err)}`);
    finish(flight);
    return;
  }

  flight.pos = next;
  flight.vel = { x: flight.vel.x, y: flight.vel.y - spec.gravity, z: flight.vel.z };
  flight.age++;
}

system.runInterval(() => {
  for (const flight of flights.values()) step(flight);
}, 1);

// Remove fireballs nobody is flying: left over from a script reload, or /summon'd.
system.runInterval(() => {
  forEachDimension((dimension) => {
    for (const e of dimension.getEntities({ type: FIREBALL_ENTITY })) {
      if (!flights.has(e.id)) removeQuietly(e);
    }
  });
}, SWEEP_INTERVAL_TICKS);
