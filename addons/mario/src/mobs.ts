/**
 * The small mobs' script-side behavior.
 *
 * - Goombas spawn at night through spawn_rules/goomba.json like any monster.
 *   Spawn rules have no time-of-day filter, so the "confused" early risers at
 *   sunset are spawned here: during the sunset window each player in the
 *   Overworld has a small chance every few seconds of a Goomba wandering in.
 * - Koopa Troopas may duck into their shell when hurt (once per life). The
 *   shell adds 20 health on top of what is left (entities/koopa_troopa.json
 *   allows up to 40), so it takes 20 more damage to finish one off.
 * - Landing on a Goomba or Koopa from above stomps it, as in the games: a
 *   Goomba is squashed outright, a Koopa is knocked into its shell, and the
 *   player bounces.
 */
import { Difficulty, EntityDamageCause, Player, system, world, type Entity, type Vector3 } from '@minecraft/server';

import { log } from './common';

export const GOOMBA = 'steveo:goomba';
export const KOOPA = 'steveo:koopa_troopa';
export const BOMB_GUY = 'steveo:bomb_guy';

// ---------- sunset Goombas ----------

/** Time of day (ticks) when the sun starts setting, and when night mobs take over. */
const SUNSET_START = 11500;
const SUNSET_END = 13000;
const SUNSET_CHECK_TICKS = 200;
/** Per player, per check. With 7-8 checks per sunset, most sunsets bring one or two. */
const SUNSET_CHANCE = 0.2;
/** No more early risers once this many Goombas are already near the player. */
const SUNSET_CAP = 3;

export function isSunset(): boolean {
  const t = world.getTimeOfDay();
  return t >= SUNSET_START && t < SUNSET_END;
}

/**
 * Spawns a Goomba on the surface 10-20 blocks from the player. Returns it, or
 * undefined when no suitable spot was found (water, unloaded chunk, a cliff).
 */
export function spawnConfusedGoomba(player: Player): Entity | undefined {
  const dimension = player.dimension;
  for (let attempt = 0; attempt < 6; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * 10;
    const x = Math.floor(player.location.x + Math.cos(angle) * dist);
    const z = Math.floor(player.location.z + Math.sin(angle) * dist);
    try {
      const top = dimension.getTopmostBlock({ x, z });
      if (!top || top.isLiquid || top.isAir) continue;
      if (Math.abs(top.location.y - player.location.y) > 12) continue;
      const spot: Vector3 = { x: x + 0.5, y: top.location.y + 1, z: z + 0.5 };
      return dimension.spawnEntity(GOOMBA, spot);
    } catch {
      // Unloaded chunk or out of bounds; try another spot.
    }
  }
  return undefined;
}

system.runInterval(() => {
  if (!isSunset()) return;
  try {
    if (world.getDifficulty() === Difficulty.Peaceful) return;
  } catch {
    return;
  }
  for (const player of world.getAllPlayers()) {
    try {
      if (player.dimension.id !== 'minecraft:overworld' || Math.random() >= SUNSET_CHANCE) continue;
      const near = player.dimension.getEntities({ type: GOOMBA, location: player.location, maxDistance: 32 });
      if (near.length >= SUNSET_CAP) continue;
      spawnConfusedGoomba(player);
    } catch (err) {
      log.warn(`sunset goomba for ${player.name} failed: ${String(err)}`);
    }
  }
}, SUNSET_CHECK_TICKS);

// ---------- Koopa shells ----------

const SHELLED_PROP = 'steveo:shelled';
/** Chance a surviving Koopa ducks into its shell when hurt. */
const SHELL_CHANCE = 0.4;
const SHELL_BONUS_HEALTH = 20;

export function isShelled(koopa: Entity): boolean {
  try {
    return koopa.getDynamicProperty(SHELLED_PROP) === true;
  } catch {
    return false;
  }
}

/** Sends a Koopa into its shell, once per life. Returns false if it already used its shell. */
export function hideInShell(koopa: Entity): boolean {
  if (!koopa.isValid || isShelled(koopa)) return false;
  try {
    const health = koopa.getComponent('minecraft:health');
    if (!health || health.currentValue <= 0) return false;
    koopa.setDynamicProperty(SHELLED_PROP, true);
    koopa.triggerEvent('steveo:hide_in_shell');
    health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + SHELL_BONUS_HEALTH));
    koopa.dimension.playSound('mob.shulker.close', koopa.location, { pitch: 1.4 });
    return true;
  } catch (err) {
    log.warn(`koopa shell failed: ${String(err)}`);
    return false;
  }
}

world.afterEvents.entityHurt.subscribe(
  (event) => {
    const koopa = event.hurtEntity;
    if (Math.random() < SHELL_CHANCE) hideInShell(koopa);
  },
  { entityTypes: [KOOPA] },
);

// ---------- stomping ----------

const STOMP_FAMILY = 'steveo_stompable';
/** Falling at least this fast (blocks per tick) counts as landing on something. */
const STOMP_MIN_FALL = 0.2;
const STOMP_COOLDOWN_TICKS = 8;
const STOMP_BOUNCE = 0.6;
const GOOMBA_STOMP_DAMAGE = 100;
const KOOPA_STOMP_DAMAGE = 6;

const lastStomp = new Map<string, number>();

function stomp(player: Player, target: Entity): void {
  lastStomp.set(player.id, system.currentTick);
  const isKoopa = target.typeId === KOOPA;
  try {
    if (isKoopa) hideInShell(target);
    target.applyDamage(isKoopa ? KOOPA_STOMP_DAMAGE : GOOMBA_STOMP_DAMAGE, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: player,
    });
    player.dimension.playSound('mob.slime.small', target.location, { pitch: isKoopa ? 0.8 : 1.4 });
    player.applyKnockback({ x: 0, z: 0 }, STOMP_BOUNCE);
  } catch (err) {
    log.warn(`stomp failed: ${String(err)}`);
  }
}

system.runInterval(() => {
  const tick = system.currentTick;
  for (const player of world.getAllPlayers()) {
    try {
      if (player.isOnGround || player.isFlying || player.isGliding) continue;
      if (player.getVelocity().y > -STOMP_MIN_FALL) continue;
      if (tick - (lastStomp.get(player.id) ?? -STOMP_COOLDOWN_TICKS) < STOMP_COOLDOWN_TICKS) continue;
      const feet = player.location;
      const targets = player.dimension.getEntities({ location: feet, maxDistance: 2, families: [STOMP_FAMILY] });
      for (const target of targets) {
        const dy = feet.y - target.location.y;
        const dxz = Math.hypot(feet.x - target.location.x, feet.z - target.location.z);
        // Feet near the top of the mob (Goombas ~0.9 tall, Koopas 1.1, shells 0.4), and over it.
        if (dy < 0.3 || dy > 1.4 || dxz > 0.8) continue;
        stomp(player, target);
        break;
      }
    } catch {
      // Player left or is in an unloaded area.
    }
  }
}, 1);

world.afterEvents.playerLeave.subscribe((event) => lastStomp.delete(event.playerId));
