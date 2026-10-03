/**
 * Bowser, the boss of Bowser's Castle.
 *
 * The castle (behavior_pack/structures/, from assets/generate.mjs) has a
 * `steveo:bowser_seal` block in the throne-room floor. The seal ticks every
 * second (and on random ticks, in case a world-generated block never gets
 * its first scheduled tick); when a player comes within range it raises
 * Bowser and turns into nether brick, so each castle has one Bowser.
 *
 * Bowser fights in melee through his entity JSON. His fire breath is here:
 * every few seconds he spits a fan of big fireballs at the nearest player,
 * faster and wider once he is down to a third of his health.
 */
import { system, world, type Block, type Entity, type Vector3 } from '@minecraft/server';

import { launchFireball } from './fireball';
import { add, forEachDimension, isVulnerable, log, normalize, PREFIX, sub, yaw } from './common';

export const BOWSER = 'steveo:bowser';
const SEAL_COMPONENT = 'steveo:bowser_seal';
const SEAL_SPENT_BLOCK = 'minecraft:nether_brick';
/** A player this close to the seal wakes Bowser. */
const WAKE_RANGE = 14;
/** No new Bowser if one is already this close (re-entering a castle, a second seal tick). */
const ONE_BOWSER_RANGE = 48;
const ANNOUNCE_RANGE = 48;

const AI_INTERVAL_TICKS = 10;
const BREATH_RANGE = 24;
const BREATH_MIN_RANGE = 3;
const BREATH_COOLDOWN = { calm: 90, enraged: 50 };
const ENRAGED_FRACTION = 1 / 3;

/** Next tick each Bowser may breathe fire, by entity id. */
const nextBreath = new Map<string, number>();

function center(block: Block): Vector3 {
  return { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 };
}

/** Spawns Bowser just above `location` and tells everyone nearby. */
export function raiseBowser(dimensionId: string, location: Vector3): Entity | undefined {
  const dimension = world.getDimension(dimensionId);
  let bowser: Entity;
  try {
    bowser = dimension.spawnEntity(BOWSER, location);
  } catch (err) {
    log.error('spawning Bowser failed', err);
    return undefined;
  }
  // Give the players a moment before the first fireball.
  nextBreath.set(bowser.id, system.currentTick + 60);
  dimension.playSound('mob.enderdragon.growl', location, { volume: 4, pitch: 0.8 });
  for (const player of dimension.getPlayers({ location, maxDistance: ANNOUNCE_RANGE })) {
    player.sendMessage({ rawtext: [PREFIX, { translate: 'mario.bowser.awakens' }] });
  }
  return bowser;
}

function wake(block: Block): void {
  const dimension = block.dimension;
  const at = center(block);
  const players = dimension.getPlayers({ location: at, maxDistance: WAKE_RANGE }).filter(isVulnerable);
  if (players.length === 0) return;
  const location = block.location;
  // Changing blocks from inside a block callback is deferred to a normal tick.
  system.run(() => {
    try {
      const seal = dimension.getBlock(location);
      if (seal?.typeId !== 'steveo:bowser_seal') return;
      seal.setType(SEAL_SPENT_BLOCK);
      const existing = dimension.getEntities({ type: BOWSER, location: at, maxDistance: ONE_BOWSER_RANGE });
      if (existing.length === 0) raiseBowser(dimension.id, add(at, { x: 0, y: 1, z: 0 }));
    } catch (err) {
      log.warn(`waking Bowser failed: ${String(err)}`);
    }
  });
}

system.beforeEvents.startup.subscribe((event) => {
  event.blockComponentRegistry.registerCustomComponent(SEAL_COMPONENT, {
    onTick: (e) => wake(e.block),
    onRandomTick: (e) => wake(e.block),
  });
});

/** Spits a fan of fireballs from Bowser's mouth at `target`. */
export function breatheFire(bowser: Entity, target: Entity, enraged: boolean): void {
  const mouth = bowser.getHeadLocation();
  const aim = normalize(sub(add(target.location, { x: 0, y: 1, z: 0 }), mouth));
  const spread = enraged ? [-20, -10, 0, 10, 20] : [-12, 0, 12];
  const from = add(mouth, { x: aim.x * 1.2, y: aim.y * 1.2, z: aim.z * 1.2 });
  for (const angle of spread) launchFireball(bowser, 'bowser', from, yaw(aim, angle));
  bowser.dimension.playSound('mob.ghast.fireball', mouth, { volume: 2, pitch: 0.7 });
}

function think(bowser: Entity): void {
  const tick = system.currentTick;
  const next = nextBreath.get(bowser.id) ?? 0;
  if (tick < next) return;
  const target = bowser.dimension
    .getPlayers({ location: bowser.location, maxDistance: BREATH_RANGE })
    .filter(isVulnerable)
    .sort((a, b) => dist(a, bowser) - dist(b, bowser))[0];
  if (!target || dist(target, bowser) < BREATH_MIN_RANGE) return;
  const health = bowser.getComponent('minecraft:health');
  const enraged = health !== undefined && health.currentValue <= health.effectiveMax * ENRAGED_FRACTION;
  breatheFire(bowser, target, enraged);
  const cooldown = enraged ? BREATH_COOLDOWN.enraged : BREATH_COOLDOWN.calm;
  nextBreath.set(bowser.id, tick + cooldown + Math.floor(Math.random() * 30));
}

function dist(a: Entity, b: Entity): number {
  const d = sub(a.location, b.location);
  return Math.hypot(d.x, d.y, d.z);
}

system.runInterval(() => {
  forEachDimension((dimension) => {
    for (const bowser of dimension.getEntities({ type: BOWSER })) {
      try {
        think(bowser);
      } catch (err) {
        log.warn(`Bowser AI failed: ${String(err)}`);
      }
    }
  });
}, AI_INTERVAL_TICKS);

world.afterEvents.entityDie.subscribe(
  (event) => {
    const bowser = event.deadEntity;
    nextBreath.delete(bowser.id);
    try {
      const location = bowser.location;
      bowser.dimension.playSound('random.levelup', location, { volume: 2 });
      for (const player of bowser.dimension.getPlayers({ location, maxDistance: ANNOUNCE_RANGE })) {
        player.sendMessage({ rawtext: [PREFIX, { translate: 'mario.bowser.defeated' }] });
      }
    } catch {
      // The world is unloading.
    }
  },
  { entityTypes: [BOWSER] },
);

/** Number of Bowsers loaded across all dimensions, for the debug status. */
export function bowserCount(): number {
  let n = 0;
  forEachDimension((d) => { n += d.getEntities({ type: BOWSER }).length; });
  return n;
}
