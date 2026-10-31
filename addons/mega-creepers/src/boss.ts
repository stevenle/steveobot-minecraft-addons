/**
 * The Mega Creeper, boss of the creeper dungeons.
 *
 * Walking and targeting come from its entity JSON. This module runs the
 * fight as a small state machine, mirrored into the synced `steveo:state`
 * property so the client can animate and tint it:
 *
 *   IDLE      walks at the nearest player. Close in and it lights its fuse;
 *             stay away and it may launch a firework barrage instead.
 *   FUSE      swells and flashes for FUSE_TICKS, barely moving, then
 *             explodes like a big creeper. It does not die. Explosions
 *             break blocks only when the `mobGriefing` game rule is on.
 *   CHARGE    rainbow-flashes for CHARGE_TICKS, then fires a barrage of
 *             rockets that rain down on the players; a red ring marks where
 *             each will land.
 *   RECHARGE  slumped and dizzy, nearly still: 2-7 s after an explosion,
 *             6-25 s after a barrage. This is the window to hit it.
 *
 * Outside RECHARGE its hide shrugs off most damage (ARMORED_FACTOR), so the
 * fight is about baiting attacks and punishing the recovery. It is immune
 * to explosions (its own included), fireworks, and fall damage via its
 * damage sensor, and it never leaves home for long: past LEASH_RANGE it
 * teleports back to where it spawned.
 */
import {
  EntityDamageCause,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  type Vector3,
} from '@minecraft/server';

import {
  actionBar,
  distance,
  isVulnerable,
  log,
  MEGA_CREEPER,
  particle,
  randomInt,
  sound,
} from './common';

export const State = { Idle: 0, Fuse: 1, Recharge: 2, Charge: 3 } as const;
type StateValue = (typeof State)[keyof typeof State];

const STATE_PROPERTY = 'steveo:state';
export const HOME_PROPERTY = 'steveo:home';

const AI_INTERVAL = 2;
const TARGET_RANGE = 24;
const FUSE_START_RANGE = 4.5;
const FUSE_TICKS = { calm: 30, enraged: 22 };
const EXPLOSION_POWER = 4;
const EXPLOSION_RECHARGE: [number, number] = [40, 140];

const CHARGE_TICKS = 30;
const FIREWORK_MIN_RANGE = 6;
const FIREWORK_RECHARGE: [number, number] = [120, 500];
/** Gap after a barrage's recharge before the next barrage may start. */
const FIREWORK_COOLDOWN: [number, number] = [100, 240];
const FIRST_FIREWORK_DELAY = 200;
/** Chance per AI pass that an idle boss with a ready barrage uses it. */
const FIREWORK_CHANCE = 0.04;
/** A target kept out of fuse range this long always draws a barrage. */
const KITE_TICKS = 100;

const ROCKET_FLIGHT_TICKS = 24;
const ROCKET_STAGGER_TICKS = 3;
const ROCKET_POWER = 2;
const ROCKETS_MAX = 12;

const ENRAGED_FRACTION = 0.4;
/** Share of damage that gets through outside the recharge window. */
const ARMORED_FACTOR = 0.25;
const ARMOR_HINT_COOLDOWN = 80;
const LEASH_RANGE = 24;
/** Slowness amplifier while swelling, charging, or recharging: level 6, 90% slower. */
const ROOTED_AMPLIFIER = 5;

interface Brain {
  state: StateValue;
  /** Tick the current FUSE/CHARGE/RECHARGE ends. */
  until: number;
  fireworkReadyAt: number;
  /** Ticks the target has spent out of fuse range. */
  kiting: number;
}

interface Rocket {
  dimension: Dimension;
  from: Vector3;
  to: Vector3;
  start: number;
  apex: number;
  source: Entity;
  ringShown: boolean;
}

const brains = new Map<string, Brain>();
const rockets: Rocket[] = [];
const armorHintAt = new Map<string, number>();

function brainOf(boss: Entity): Brain {
  let brain = brains.get(boss.id);
  if (brain === undefined) {
    // New, or the world was reloaded mid-fight: start calm.
    brain = { state: State.Idle, until: 0, fireworkReadyAt: system.currentTick + FIRST_FIREWORK_DELAY, kiting: 0 };
    brains.set(boss.id, brain);
    setState(boss, brain, State.Idle, 0);
  }
  return brain;
}

export function bossState(boss: Entity): StateValue | undefined {
  return brains.get(boss.id)?.state;
}

function setState(boss: Entity, brain: Brain, state: StateValue, duration: number): void {
  brain.state = state;
  brain.until = system.currentTick + duration;
  try {
    boss.setProperty(STATE_PROPERTY, state);
    if (state === State.Idle) {
      boss.removeEffect('slowness');
    } else {
      boss.addEffect('slowness', duration + 20, { amplifier: ROOTED_AMPLIFIER, showParticles: false });
    }
  } catch (err) {
    log.warn(`mega creeper state: ${String(err)}`);
  }
}

function healthFraction(boss: Entity): number {
  const health = boss.getComponent('minecraft:health');
  return health === undefined ? 1 : health.currentValue / health.effectiveMax;
}

function isEnraged(boss: Entity): boolean {
  return healthFraction(boss) < ENRAGED_FRACTION;
}

function headOf(boss: Entity): Vector3 {
  return { x: boss.location.x, y: boss.location.y + 3.2, z: boss.location.z };
}

function targetsNear(boss: Entity): Player[] {
  return boss.dimension
    .getPlayers({ location: boss.location, maxDistance: TARGET_RANGE })
    .filter(isVulnerable)
    .sort((a, b) => distance(a.location, boss.location) - distance(b.location, boss.location));
}

function tellNearby(boss: Entity, key: string): void {
  for (const player of boss.dimension.getPlayers({ location: boss.location, maxDistance: TARGET_RANGE + 8 })) {
    actionBar(player, key);
  }
}

// ---------- attacks ----------

function startRecharge(boss: Entity, brain: Brain, [min, max]: [number, number]): void {
  const ticks = randomInt(min, max);
  setState(boss, brain, State.Recharge, ticks);
  tellNearby(boss, 'megacreepers.boss.recharging');
}

function explode(boss: Entity, brain: Brain): void {
  const at = { x: boss.location.x, y: boss.location.y + 1, z: boss.location.z };
  try {
    boss.dimension.createExplosion(at, EXPLOSION_POWER, {
      breaksBlocks: world.gameRules.mobGriefing,
      causesFire: false,
      source: boss,
    });
  } catch (err) {
    log.warn(`mega creeper explosion: ${String(err)}`);
  }
  startRecharge(boss, brain, EXPLOSION_RECHARGE);
}

/** Queues a barrage of rockets at the players near `boss`. */
export function launchBarrage(boss: Entity): number {
  const targets = targetsNear(boss);
  if (targets.length === 0) return 0;
  const count = Math.min(ROCKETS_MAX, 3 + targets.length * 2 + (isEnraged(boss) ? 3 : 0));
  const from = headOf(boss);
  const now = system.currentTick;
  for (let i = 0; i < count; i++) {
    const player = targets[i % targets.length];
    if (player === undefined) continue;
    // The first rocket at each player is dead on; the rest scatter round them.
    const spread = i < targets.length ? 0 : 2 + Math.random() * 3;
    const angle = Math.random() * Math.PI * 2;
    const to = {
      x: player.location.x + Math.cos(angle) * spread,
      y: player.location.y,
      z: player.location.z + Math.sin(angle) * spread,
    };
    rockets.push({
      dimension: boss.dimension,
      from,
      to,
      start: now + i * ROCKET_STAGGER_TICKS,
      apex: Math.max(from.y, to.y) + 3,
      source: boss,
      ringShown: false,
    });
  }
  sound(boss.dimension, 'firework.launch', from, 0.8, 3);
  return count;
}

function rocketAt(rocket: Rocket, t: number): Vector3 {
  // Straight line in x/z, a parabola in y peaking at `apex`.
  const lineY = rocket.from.y + (rocket.to.y - rocket.from.y) * t;
  const peak = rocket.apex - (rocket.from.y + rocket.to.y) / 2;
  return {
    x: rocket.from.x + (rocket.to.x - rocket.from.x) * t,
    y: lineY + 4 * peak * t * (1 - t),
    z: rocket.from.z + (rocket.to.z - rocket.from.z) * t,
  };
}

function updateRockets(): void {
  const now = system.currentTick;
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rocket = rockets[i];
    if (rocket === undefined) continue;
    if (now < rocket.start) continue;
    if (!rocket.ringShown) {
      rocket.ringShown = true;
      particle(rocket.dimension, 'steveo:target_ring', { ...rocket.to, y: rocket.to.y + 0.1 });
      sound(rocket.dimension, 'firework.launch', rocket.from, 1.2);
    }
    const t = (now - rocket.start) / ROCKET_FLIGHT_TICKS;
    if (t < 1) {
      particle(rocket.dimension, 'steveo:firework_trail', rocketAt(rocket, t));
      continue;
    }
    rockets.splice(i, 1);
    const at = { ...rocket.to, y: rocket.to.y + 0.5 };
    particle(rocket.dimension, 'steveo:firework_burst', { ...at, y: at.y + 1 });
    sound(rocket.dimension, 'firework.large_blast', at, 1, 2);
    sound(rocket.dimension, 'firework.twinkle', at, 1, 1);
    try {
      rocket.dimension.createExplosion(at, ROCKET_POWER, {
        breaksBlocks: false,
        causesFire: false,
        ...(rocket.source.isValid ? { source: rocket.source } : {}),
      });
    } catch {
      // The landing spot unloaded; the rocket fizzles.
    }
  }
}

/** Forces the boss straight into a barrage, for the debug command. */
export function forceBarrage(boss: Entity): void {
  const brain = brainOf(boss);
  setState(boss, brain, State.Charge, CHARGE_TICKS);
}

// ---------- the state machine ----------

function leash(boss: Entity): void {
  const raw = boss.getDynamicProperty(HOME_PROPERTY);
  if (typeof raw !== 'string') return;
  const home = JSON.parse(raw) as Vector3;
  if (distance(boss.location, home) <= LEASH_RANGE) return;
  particle(boss.dimension, 'steveo:creeperite_burst', headOf(boss));
  boss.tryTeleport(home, { checkForBlocks: false });
  particle(boss.dimension, 'steveo:creeperite_burst', { ...home, y: home.y + 2 });
}

function think(boss: Entity): void {
  const brain = brainOf(boss);
  const now = system.currentTick;
  const dimension = boss.dimension;
  switch (brain.state) {
    case State.Idle: {
      leash(boss);
      const target = targetsNear(boss)[0];
      if (target === undefined) {
        brain.kiting = 0;
        return;
      }
      const range = distance(target.location, boss.location);
      if (range <= FUSE_START_RANGE) {
        brain.kiting = 0;
        setState(boss, brain, State.Fuse, isEnraged(boss) ? FUSE_TICKS.enraged : FUSE_TICKS.calm);
        sound(dimension, 'random.fuse', boss.location, 0.6, 3);
        return;
      }
      brain.kiting += AI_INTERVAL;
      const ready = now >= brain.fireworkReadyAt && range >= FIREWORK_MIN_RANGE;
      if (ready && (brain.kiting >= KITE_TICKS || Math.random() < FIREWORK_CHANCE)) {
        brain.kiting = 0;
        setState(boss, brain, State.Charge, CHARGE_TICKS);
        sound(dimension, 'mob.creeper.say', boss.location, 0.5, 3);
        tellNearby(boss, 'megacreepers.boss.charging');
      }
      return;
    }
    case State.Fuse:
      if (now >= brain.until) explode(boss, brain);
      return;
    case State.Charge:
      if (now % 6 < AI_INTERVAL) particle(dimension, 'steveo:charge', headOf(boss));
      if (now >= brain.until) {
        launchBarrage(boss);
        startRecharge(boss, brain, FIREWORK_RECHARGE);
        brain.fireworkReadyAt = brain.until + randomInt(...FIREWORK_COOLDOWN) * (isEnraged(boss) ? 0.5 : 1);
      }
      return;
    case State.Recharge:
      if (now % 8 < AI_INTERVAL) particle(dimension, 'steveo:dizzy', { ...headOf(boss), y: boss.location.y + 3.9 });
      if (now >= brain.until) {
        setState(boss, brain, State.Idle, 0);
        sound(dimension, 'mob.creeper.say', boss.location, 0.5, 2);
      }
      return;
  }
}

export function allBosses(): Entity[] {
  const found: Entity[] = [];
  for (const id of ['overworld', 'nether', 'the_end']) {
    try {
      found.push(...world.getDimension(id).getEntities({ type: MEGA_CREEPER }));
    } catch {
      // Dimension not loaded.
    }
  }
  return found;
}

system.runInterval(() => {
  for (const boss of allBosses()) {
    try {
      if (boss.isValid) think(boss);
    } catch (err) {
      log.warn(`mega creeper AI: ${String(err)}`);
    }
  }
}, AI_INTERVAL);

system.runInterval(updateRockets, 1);

// ---------- damage ----------

const UNSTOPPABLE = new Set<string>([EntityDamageCause.void, EntityDamageCause.selfDestruct, EntityDamageCause.override]);

world.beforeEvents.entityHurt.subscribe((event) => {
  const boss = event.hurtEntity;
  if (boss.typeId !== MEGA_CREEPER) return;
  if (UNSTOPPABLE.has(event.damageSource.cause)) return;
  if (brains.get(boss.id)?.state === State.Recharge) return;
  event.damage *= ARMORED_FACTOR;
  const attacker = event.damageSource.damagingEntity;
  if (!(attacker instanceof Player)) return;
  const last = armorHintAt.get(attacker.id);
  if (last !== undefined && system.currentTick - last < ARMOR_HINT_COOLDOWN) return;
  armorHintAt.set(attacker.id, system.currentTick);
  system.run(() => actionBar(attacker, 'megacreepers.boss.armored'));
});

world.afterEvents.entityRemove.subscribe((event) => brains.delete(event.removedEntityId), {
  entityTypes: [MEGA_CREEPER],
});

world.afterEvents.playerLeave.subscribe((event) => armorHintAt.delete(event.playerId));
