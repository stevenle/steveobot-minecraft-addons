/**
 * Corrupted Beacon — "holds immense power within. It waits for the moment
 * to unleash its wrath."
 *
 * In Minecraft Dungeons it is an artifact that fires a sustained beam. Here,
 * using it (tap or right-click) unleashes a laser for BEAM_TICKS that follows
 * wherever the player looks. The beam reaches BEAM_RANGE blocks or the first
 * solid block, and every PULSE_TICKS it deals PULSE_DAMAGE magic damage to
 * every mob along it, not just the first. The holder is slowed while it
 * fires, and it stops early if they switch items. Then it recharges: the
 * item's `minecraft:cooldown` (9 s) covers beam plus recharge, so the hotbar
 * sweep shows when it is ready again, and the script enforces the same.
 *
 * Players and tamed pets (Tim, wolves, cats) are never hit.
 *
 * A tap-to-fire beam rather than hold-to-fire: holding a custom item's use
 * is not reported reliably on every platform, while a single use is (see
 * `onItemUse`), and a tap works the same on touch screens.
 */
import { EntityDamageCause, MolangVariableMap, Player, system, world, type Dimension, type Entity, type Vector3 } from '@minecraft/server';

import { onItemUse } from '@shared/use';

import { actionBar, add, isMob, isPet, log, mainhand, particle, say, scale, sound } from './common';

export const BEACON_ID = 'steveo:corrupted_beacon';
const COOLDOWN_CATEGORY = 'steveo_corrupted_beacon';

const BEAM_TICKS = 100;
const RECHARGE_TICKS = 80;
/** Must match `minecraft:cooldown.duration` in the item JSON (9 s). */
const COOLDOWN_TICKS = BEAM_TICKS + RECHARGE_TICKS;
const BEAM_RANGE = 20;
const PULSE_TICKS = 5;
const PULSE_DAMAGE = 6;
/** How close to the beam's line a mob's body must be to get hit. */
const HIT_RADIUS = 1.1;
/**
 * The laser is redrawn every tick in stretches this long. Each particle call
 * fills its whole stretch with motes laid along `variable.dir`, so a few
 * calls draw a solid line instead of a row of dots.
 */
const SEGMENT = 2;
const MUZZLE_OFFSET = 0.8;
/** Slowness III while firing. */
const SLOW_AMPLIFIER = 2;

interface Beam {
  player: Player;
  startedAt: number;
}

/** Beams currently firing, keyed by player id. */
const beams = new Map<string, Beam>();
/** Tick each player last fired, for the cooldown. */
const lastFired = new Map<string, number>();

export function beamCount(): number {
  return beams.size;
}

export function cooldownLeft(player: Player): number {
  const last = lastFired.get(player.id);
  return last === undefined ? 0 : Math.max(0, COOLDOWN_TICKS - (system.currentTick - last));
}

/** Where the beam starts and how far it goes before a wall stops it. */
function beamLine(player: Player): { origin: Vector3; direction: Vector3; length: number } {
  const direction = player.getViewDirection();
  const origin = add(player.getHeadLocation(), scale(direction, MUZZLE_OFFSET));
  let length = BEAM_RANGE;
  try {
    const hit = player.dimension.getBlockFromRay(origin, direction, {
      maxDistance: BEAM_RANGE,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (hit !== undefined) {
      const face = add(hit.block.location, hit.faceLocation);
      length = Math.min(BEAM_RANGE, Math.hypot(face.x - origin.x, face.y - origin.y, face.z - origin.z));
    }
  } catch {
    // Out of the world: the beam runs its full length.
  }
  return { origin, direction, length };
}

function drawBeam(dimension: Dimension, origin: Vector3, direction: Vector3, length: number, impact: boolean): void {
  for (let d = 0; d < length; d += SEGMENT) {
    const vars = new MolangVariableMap();
    vars.setVector3('variable.dir', direction);
    vars.setFloat('variable.len', Math.min(SEGMENT, length - d));
    const at = add(origin, scale(direction, d));
    particle(dimension, 'steveo:laser_core', at, vars);
    particle(dimension, 'steveo:laser_glow', at, vars);
  }
  if (impact) particle(dimension, 'steveo:beam_impact', add(origin, scale(direction, length)));
}

/** Distance from point `p` to the nearest point on the beam segment. */
function distanceToBeam(p: Vector3, origin: Vector3, direction: Vector3, length: number): number {
  const rel = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
  const along = Math.max(0, Math.min(length, rel.x * direction.x + rel.y * direction.y + rel.z * direction.z));
  const foot = add(origin, scale(direction, along));
  return Math.hypot(p.x - foot.x, p.y - foot.y, p.z - foot.z);
}

/** Every mob close enough to the beam, found by sampling spheres along it. */
function mobsOnBeam(player: Player, origin: Vector3, direction: Vector3, length: number): Entity[] {
  const found = new Map<string, Entity>();
  const step = HIT_RADIUS * 1.5;
  for (let d = 0; d <= length + step; d += step) {
    let nearby: Entity[];
    try {
      nearby = player.dimension.getEntities({ location: add(origin, scale(direction, Math.min(d, length))), maxDistance: HIT_RADIUS + 1 });
    } catch {
      continue;
    }
    for (const entity of nearby) {
      if (found.has(entity.id) || !isMob(entity) || isPet(entity)) continue;
      // Test the body's middle, so tall and short mobs are both hittable.
      const feet = entity.location;
      const head = entity.getHeadLocation();
      const mid = { x: feet.x, y: (feet.y + head.y) / 2, z: feet.z };
      if (distanceToBeam(mid, origin, direction, length) <= HIT_RADIUS) found.set(entity.id, entity);
    }
  }
  return [...found.values()];
}

function stopBeam(player: Player): void {
  if (!beams.delete(player.id)) return;
  if (!player.isValid) return;
  // Only lift our own slowness, not a potion's or a stray's arrow.
  if (player.getEffect('slowness')?.amplifier === SLOW_AMPLIFIER) player.removeEffect('slowness');
  sound(player.dimension, 'beacon.deactivate', player.location, 1.2, 0.7);
}

function tickBeam(beam: Beam, now: number): void {
  const { player } = beam;
  const age = now - beam.startedAt;
  if (!player.isValid || age >= BEAM_TICKS || mainhand(player)?.typeId !== BEACON_ID) {
    stopBeam(player);
    return;
  }
  const { origin, direction, length } = beamLine(player);
  drawBeam(player.dimension, origin, direction, length, age % 3 === 0);
  if (age % PULSE_TICKS !== 0) return;
  let hits = 0;
  for (const mob of mobsOnBeam(player, origin, direction, length)) {
    try {
      if (mob.applyDamage(PULSE_DAMAGE, { cause: EntityDamageCause.magic, damagingEntity: player })) hits++;
    } catch (err) {
      log.warn(`beam could not damage ${mob.typeId}: ${String(err)}`);
    }
  }
  if (hits > 0) sound(player.dimension, 'mob.guardian.attack_loop', player.location, 1.6, 0.4);
  actionBar(player, 'dungeons.beacon.firing', ((BEAM_TICKS - age) / 20).toFixed(1));
}

export function fireBeacon(player: Player): void {
  const now = system.currentTick;
  if (beams.has(player.id)) return;
  if (cooldownLeft(player) > 0) {
    actionBar(player, 'dungeons.beacon.recharging', (cooldownLeft(player) / 20).toFixed(1));
    return;
  }
  lastFired.set(player.id, now);
  beams.set(player.id, { player, startedAt: now });
  try {
    player.startItemCooldown(COOLDOWN_CATEGORY, COOLDOWN_TICKS);
  } catch {
    // The item component shows the sweep on its own; the check above enforces it.
  }
  // Rooted in place while it fires, as in Dungeons, but not completely.
  player.addEffect('slowness', BEAM_TICKS + 5, { amplifier: SLOW_AMPLIFIER, showParticles: false });
  sound(player.dimension, 'beacon.activate', player.location, 1.4);
}

onItemUse((typeId) => typeId === BEACON_ID, (player) => fireBeacon(player));

system.runInterval(() => {
  const now = system.currentTick;
  for (const beam of [...beams.values()]) {
    try {
      tickBeam(beam, now);
    } catch (err) {
      log.error('beam tick failed', err);
      stopBeam(beam.player);
    }
  }
}, 1);

world.afterEvents.playerLeave.subscribe((event) => {
  beams.delete(event.playerId);
  lastFired.delete(event.playerId);
});

/** Debug: fire regardless of cooldown, so the beam can be checked from chat. */
export function forceFire(player: Player): void {
  lastFired.delete(player.id);
  beams.delete(player.id);
  if (mainhand(player)?.typeId !== BEACON_ID) {
    say(player, 'dungeons.debug.beam.hold');
    return;
  }
  fireBeacon(player);
}
