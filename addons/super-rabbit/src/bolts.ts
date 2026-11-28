/**
 * Script-driven Boom Bolts for Robo-Lizards, Robo-Rabbit Boy, Mega-Robo, and
 * King Viking. Flies straight, deals damage (and optional safe splash knockback
 * for Mega-Robo rockets), and fizzles on solid blocks without breaking terrain.
 */
import { EntityDamageCause, system, type Entity, type Vector3 } from '@minecraft/server';

import { add, BOOM_BOLT, dist, isVulnerable, log, normalize, removeQuietly, scale } from './common';

export interface BoltSpec {
  speed: number;
  damage: number;
  splashRadius: number;
  maxTicks: number;
}

interface ActiveBolt {
  entity: Entity;
  owner: Entity;
  vel: Vector3;
  spec: BoltSpec;
  age: number;
}

const active = new Map<string, ActiveBolt>();

export function launchBolt(owner: Entity, from: Vector3, direction: Vector3, spec: BoltSpec): void {
  try {
    const entity = owner.dimension.spawnEntity(BOOM_BOLT, from);
    const vel = scale(normalize(direction), spec.speed);
    active.set(entity.id, { entity, owner, vel, spec, age: 0 });
  } catch (err) {
    log.warn(`launchBolt failed: ${String(err)}`);
  }
}

function detonate(bolt: ActiveBolt, at: Vector3): void {
  const dim = bolt.entity.dimension;
  const radius = Math.max(1.1, bolt.spec.splashRadius);
  try {
    if (bolt.spec.splashRadius > 0) {
      dim.spawnParticle('minecraft:large_explosion', at);
      dim.playSound('random.explode', at, { volume: 1.0, pitch: 1.2 });
    } else {
      dim.spawnParticle('minecraft:basic_flame_particle', at);
    }
    const damagingEntity = bolt.owner.isValid ? bolt.owner : undefined;
    for (const player of dim.getPlayers({ location: at, maxDistance: radius })) {
      if (!isVulnerable(player)) continue;
      const damageOpts = damagingEntity
        ? { cause: EntityDamageCause.projectile, damagingEntity }
        : { cause: EntityDamageCause.projectile };
      player.applyDamage(bolt.spec.damage, damageOpts);
      if (bolt.spec.splashRadius > 0) {
        const push = normalize({ x: player.location.x - at.x, y: 0, z: player.location.z - at.z });
        player.applyKnockback({ x: push.x * 1.1, z: push.z * 1.1 }, 0.45);
      }
    }
  } catch {
    // Dimension unloaded.
  }
  removeQuietly(bolt.entity);
}

system.runInterval(() => {
  for (const [id, bolt] of active) {
    bolt.age++;
    if (!bolt.entity.isValid || bolt.age > bolt.spec.maxTicks) {
      active.delete(id);
      removeQuietly(bolt.entity);
      continue;
    }
    try {
      const next = add(bolt.entity.location, bolt.vel);
      const dim = bolt.entity.dimension;
      const block = dim.getBlock({ x: Math.floor(next.x), y: Math.floor(next.y), z: Math.floor(next.z) });
      if (block && !block.isAir && !block.isLiquid) {
        active.delete(id);
        detonate(bolt, bolt.entity.location);
        continue;
      }
      // Check direct player impact
      const hit = dim
        .getPlayers({ location: next, maxDistance: 1.15 })
        .find((p) => isVulnerable(p) && dist(p.location, next) < 1.35);
      if (hit) {
        active.delete(id);
        detonate(bolt, next);
        continue;
      }
      bolt.entity.teleport(next);
      if (bolt.age % 2 === 0) {
        dim.spawnParticle('minecraft:basic_smoke_particle', next);
      }
    } catch {
      active.delete(id);
      removeQuietly(bolt.entity);
    }
  }
}, 1);

export function boltCount(): number {
  return active.size;
}
