// The Nimbus King: called with a Storm Crystal at the throne altar, fought
// on the keep's roof, drops the Cloud Staff.
//
// The entity (a giant breeze) already shoots wind charges on its own. The
// script adds volleys (3 charges, 5 below half health), summons Charge
// minions, keeps the king inside the arena so it cannot fall off with the
// staff, and handles the drop. Fight state is not saved: every second the
// script looks for kings in the dimension, so a reload mid-fight carries on.
import {
  GameMode,
  ItemStack,
  system,
  world,
  type Dimension,
  type Entity,
  type Player,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';

import {
  ARENA,
  ARENA_RADIUS,
  CASTLE,
  CHARGE,
  CLOUD_STAFF,
  COURTYARD_SPOTS,
  DIMENSION_ID,
  KING_SPAWN,
  NIMBUS_KING,
  STORM_ALTAR,
  STORM_CRYSTAL,
} from './layout';

const log = createLogger('cloud-dimension');

const WIND_CHARGE = 'minecraft:breeze_wind_charge_projectile';
const MINION_TAG = 'steveo_king_minion';
const VOLLEY_EVERY = 100;
const SUMMON_EVERY = 300;
const MAX_MINIONS = 8;
/** Guards kept in the courtyard while players are near and no fight is on. */
const GUARDS = 4;
const GUARD_EVERY = 400;

type KingState = { volleyAt: number; summonAt: number };
const kings = new Map<string, KingState>();
let guardAt = 0;

function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage(args.length ? { translate: key, with: args } : { translate: key });
}

function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function norm(v: Vector3): Vector3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function flatDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A burst of wind, if this game version has the particle. */
function puff(dimension: Dimension, at: Vector3): void {
  try {
    dimension.spawnParticle('minecraft:wind_explosion_emitter', at);
  } catch {
    // Unknown particle; the fight works without it.
  }
}

export function findKings(dimension: Dimension): Entity[] {
  try {
    return dimension.getEntities({ type: NIMBUS_KING });
  } catch {
    return [];
  }
}

function playersInArena(dimension: Dimension): Player[] {
  return dimension
    .getPlayers()
    .filter((p) => flatDistance(p.location, ARENA) <= ARENA_RADIUS + 12 && Math.abs(p.location.y - ARENA.y) < 20);
}

/** Spawns the king, with a title for everyone in the castle. */
export function summonKing(dimension: Dimension): Entity {
  const king = dimension.spawnEntity(NIMBUS_KING, KING_SPAWN);
  kings.set(king.id, { volleyAt: system.currentTick + 60, summonAt: system.currentTick + 200 });
  for (const player of dimension.getPlayers({ location: ARENA, maxDistance: 80 })) {
    player.onScreenDisplay.setTitle({ translate: 'clouds.king.title' }, {
      subtitle: { translate: 'clouds.king.subtitle' },
      fadeInDuration: 10,
      stayDuration: 60,
      fadeOutDuration: 20,
    });
    player.playSound('mob.breeze.charge', { pitch: 0.5, volume: 1 });
  }
  puff(dimension, { x: KING_SPAWN.x, y: KING_SPAWN.y + 2, z: KING_SPAWN.z });
  return king;
}

/** The altar: a Storm Crystal in hand calls the king, if none is about. */
export function useAltar(player: Player): void {
  const dimension = player.dimension;
  if (dimension.id !== DIMENSION_ID) return;
  if (findKings(dimension).length > 0) {
    say(player, 'clouds.altar.busy');
    return;
  }
  const inventory = player.getComponent('minecraft:inventory')?.container;
  const slot = player.selectedSlotIndex;
  const held = inventory?.getItem(slot);
  if (held?.typeId !== STORM_CRYSTAL) {
    say(player, 'clouds.altar.need_crystal');
    return;
  }
  if (player.getGameMode() !== GameMode.Creative) {
    if (held.amount > 1) {
      held.amount -= 1;
      inventory?.setItem(slot, held);
    } else {
      inventory?.setItem(slot, undefined);
    }
  }
  summonKing(dimension);
}

function fireVolley(king: Entity, target: Player, count: number): void {
  const dimension = king.dimension;
  const from = { x: king.location.x, y: king.location.y + 4, z: king.location.z };
  const aim = norm(sub({ x: target.location.x, y: target.location.y + 1, z: target.location.z }, from));
  const side = norm({ x: -aim.z, y: 0, z: aim.x });
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) / 2) * 0.18;
    const dir = norm({ x: aim.x + side.x * spread, y: aim.y, z: aim.z + side.z * spread });
    const at = { x: from.x + dir.x * 2, y: from.y + dir.y * 2, z: from.z + dir.z * 2 };
    try {
      const charge = dimension.spawnEntity(WIND_CHARGE, at);
      const projectile = charge.getComponent('minecraft:projectile');
      if (projectile) {
        projectile.owner = king;
        projectile.shoot({ x: dir.x * 1.1, y: dir.y * 1.1, z: dir.z * 1.1 });
      }
    } catch (err) {
      log.warn(`volley failed: ${String(err)}`);
      return;
    }
  }
  dimension.playSound('mob.breeze.shoot', from, { pitch: 0.6, volume: 1 });
}

function summonMinions(king: Entity): void {
  const dimension = king.dimension;
  const alive = dimension.getEntities({ type: CHARGE, tags: [MINION_TAG] }).length;
  const n = Math.min(2 + Math.floor(Math.random() * 3), MAX_MINIONS - alive);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 5;
    const at = { x: ARENA.x + 0.5 + Math.cos(a) * r, y: ARENA.y + 0.5, z: ARENA.z + 0.5 + Math.sin(a) * r };
    try {
      const minion = dimension.spawnEntity(CHARGE, at);
      minion.addTag(MINION_TAG);
      puff(dimension, at);
    } catch {
      return;
    }
  }
  if (n > 0) dimension.playSound('mob.breeze.inhale', king.location, { pitch: 0.6, volume: 1 });
}

/** Back to the middle if it wanders off the roof. */
function tether(king: Entity): void {
  const loc = king.location;
  if (flatDistance(loc, ARENA) > ARENA_RADIUS || loc.y < ARENA.y - 3 || loc.y > ARENA.y + 25) {
    king.teleport({ x: ARENA.x + 0.5, y: ARENA.y + 0.5, z: ARENA.z + 0.5 });
  }
}

function healthFraction(king: Entity): number {
  const health = king.getComponent('minecraft:health');
  return health ? health.currentValue / health.effectiveMax : 1;
}

function tickKing(king: Entity): void {
  const now = system.currentTick;
  let state = kings.get(king.id);
  if (!state) kings.set(king.id, (state = { volleyAt: now + 60, summonAt: now + 200 }));
  tether(king);
  const targets = playersInArena(king.dimension).filter((p) => p.getGameMode() !== GameMode.Spectator);
  if (targets.length === 0) return;
  if (now >= state.volleyAt) {
    state.volleyAt = now + VOLLEY_EVERY;
    let nearest = targets[0];
    for (const p of targets) {
      if (nearest && flatDistance(p.location, king.location) < flatDistance(nearest.location, king.location)) nearest = p;
    }
    if (nearest) fireVolley(king, nearest, healthFraction(king) < 0.5 ? 5 : 3);
  }
  if (now >= state.summonAt) {
    state.summonAt = now + SUMMON_EVERY;
    summonMinions(king);
  }
}

/** Keeps a few Charges in the courtyard while players are near and no fight is on. */
function tickGuards(dimension: Dimension): void {
  if (system.currentTick < guardAt) return;
  guardAt = system.currentTick + GUARD_EVERY;
  const near = dimension.getPlayers({ location: CASTLE, maxDistance: 48 });
  if (near.length === 0) return;
  const guards = dimension.getEntities({ type: CHARGE, location: CASTLE, maxDistance: 40 }).length;
  if (guards >= GUARDS) return;
  const free = COURTYARD_SPOTS.filter((spot) => near.every((p) => Math.hypot(p.location.x - spot.x, p.location.z - spot.z) > 10));
  const spot = free[Math.floor(Math.random() * free.length)];
  if (!spot) return;
  try {
    if (!dimension.isChunkLoaded(spot)) return;
    dimension.spawnEntity(CHARGE, spot);
  } catch {
    // Not loaded yet.
  }
}

export function tickBosses(dimension: Dimension): void {
  const found = findKings(dimension);
  for (const king of found) tickKing(king);
  if (found.length === 0) tickGuards(dimension);
}

function onKingDeath(king: Entity): void {
  kings.delete(king.id);
  let dimension: Dimension;
  try {
    dimension = king.dimension;
  } catch {
    dimension = world.getDimension(DIMENSION_ID);
  }
  // Dropped in the middle of the arena, wherever the king fell.
  const at = { x: ARENA.x + 0.5, y: ARENA.y + 1, z: ARENA.z + 0.5 };
  const staff = new ItemStack(CLOUD_STAFF, 1);
  staff.setLore([{ translate: 'clouds.staff.lore' }, { translate: 'clouds.staff.lore_cooldown' }]);
  const loot = [staff, new ItemStack('minecraft:diamond', 5), new ItemStack('minecraft:golden_apple', 2), new ItemStack('minecraft:breeze_rod', 6)];
  for (const item of loot) dimension.spawnItem(item, at);
  puff(dimension, at);
  for (const minion of dimension.getEntities({ type: CHARGE, tags: [MINION_TAG] })) {
    try {
      puff(dimension, minion.location);
      minion.remove();
    } catch {
      // Already gone.
    }
  }
  for (const player of dimension.getPlayers({ location: ARENA, maxDistance: 80 })) {
    player.onScreenDisplay.setTitle({ translate: 'clouds.king.defeated.title' }, {
      subtitle: { translate: 'clouds.king.defeated.subtitle' },
      fadeInDuration: 10,
      stayDuration: 80,
      fadeOutDuration: 20,
    });
    player.playSound('random.totem', { volume: 0.8 });
  }
}

export function installBosses(): void {
  // No entityTypes filter: it throws at startup if the type failed to load.
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    let typeId: string;
    try {
      typeId = dead.typeId;
    } catch {
      return;
    }
    if (typeId === NIMBUS_KING) onKingDeath(dead);
  });
}

export const ALTAR_BLOCK = STORM_ALTAR;
