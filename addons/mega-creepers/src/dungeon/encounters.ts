/**
 * What happens inside a creeper dungeon once it exists.
 *
 * - **Ambushes.** Creepers are not placed when the dungeon is built (they
 *   would despawn long before anyone arrived). Instead, the first time a
 *   survival or adventure player steps into a room, its creepers hiss into
 *   being at the room's spawn points. A room re-arms after AMBUSH_COOLDOWN
 *   ticks, unless creepers are still lurking in it.
 * - **Trap plates.** One corridor per dungeon has a pressure plate that
 *   spawns a creeper at each end of the corridor.
 * - **The boss.** Walking into the arena wakes the Mega Creeper. If it goes
 *   missing while awake (a /kill, a lost chunk) it comes back.
 * - **The vault.** Sealed creeperite does not mine or blow up. When the
 *   dungeon's Mega Creeper dies, the door crumbles to air and the rest of
 *   the seal turns into ordinary creeperite bricks.
 */
import { Player, system, world, type Dimension, type Entity, type Vector3 } from '@minecraft/server';

import { HOME_PROPERTY } from '../boss';
import { actionBar, distance, horizontalDistance, isVulnerable, log, MEGA_CREEPER, particle, say, sound } from '../common';
import type { Box } from './layout';
import { BLOCKS } from './layout';
import { allDungeons, getDungeon, saveDungeon, type DungeonRecord } from './records';

export const DUNGEON_PROPERTY = 'steveo:dungeon';

const CHECK_INTERVAL = 10;
const NEAR = 72;
const AMBUSH_COOLDOWN = 6000;
const TRAP_COOLDOWN = 2400;
/** Creepers already in a room that stop it re-arming. */
const LURKING_LIMIT = 2;
const ANNOUNCE_RANGE = 48;
/** AI passes a waking boss may be missing before it is brought back. */
const MISSING_PASSES = 6;

const nextAmbush = new Map<string, number>();
const nextTrap = new Map<string, number>();
const missing = new Map<string, number>();
/** Boss entity id to dungeon id, in case a dead entity's dynamic properties cannot be read. */
const bossDungeon = new Map<string, string>();

function inside(box: Box, at: Vector3, margin = 0.5): boolean {
  return (
    at.x >= box.min.x - margin && at.x < box.max.x + 1 + margin &&
    at.y >= box.min.y - margin && at.y < box.max.y + 1 + margin &&
    at.z >= box.min.z - margin && at.z < box.max.z + 1 + margin
  );
}

function center(box: Box): Vector3 {
  return {
    x: (box.min.x + box.max.x + 1) / 2,
    y: (box.min.y + box.max.y + 1) / 2,
    z: (box.min.z + box.max.z + 1) / 2,
  };
}

function spawnCreeper(dimension: Dimension, at: Vector3, charged: boolean): void {
  const location = { x: at.x + 0.5, y: at.y, z: at.z + 0.5 };
  try {
    dimension.spawnEntity('minecraft:creeper', location, charged ? { spawnEvent: 'minecraft:become_charged' } : undefined);
    particle(dimension, 'minecraft:large_explosion', { ...location, y: location.y + 1 });
  } catch (err) {
    log.warn(`spawning a creeper: ${String(err)}`);
  }
}

function creepersIn(dimension: Dimension, box: Box): number {
  const c = center(box);
  const reach = distance(box.min, box.max) / 2 + 1;
  return dimension.getEntities({ type: 'minecraft:creeper', location: c, maxDistance: reach }).filter((e) => inside(box, e.location, 0)).length;
}

function ambush(dimension: Dimension, record: DungeonRecord, index: number): void {
  const room = record.rooms[index];
  if (room === undefined || room.spawns.length === 0) return;
  const roomKey = `${record.id}#${index}`;
  const now = system.currentTick;
  if (now < (nextAmbush.get(roomKey) ?? 0)) return;
  nextAmbush.set(roomKey, now + AMBUSH_COOLDOWN);
  if (creepersIn(dimension, room) >= LURKING_LIMIT) return;
  room.spawns.forEach((spawn, i) => spawnCreeper(dimension, spawn, i < room.charged));
  sound(dimension, 'random.fuse', center(room), 0.8, 2);
}

// ---------- the boss ----------

export function wakeBoss(record: DungeonRecord): Entity | undefined {
  const dimension = world.getDimension(record.dimension);
  let boss: Entity;
  try {
    boss = dimension.spawnEntity(MEGA_CREEPER, { x: record.boss.x + 0.5, y: record.boss.y, z: record.boss.z + 0.5 });
  } catch (err) {
    log.warn(`waking the Mega Creeper: ${String(err)}`);
    return undefined;
  }
  boss.setDynamicProperty(DUNGEON_PROPERTY, record.id);
  bossDungeon.set(boss.id, record.id);
  boss.setDynamicProperty(HOME_PROPERTY, JSON.stringify({ x: record.boss.x + 0.5, y: record.boss.y, z: record.boss.z + 0.5 }));
  record.bossState = 'awake';
  saveDungeon(record);
  missing.delete(record.id);
  const at = { ...record.boss, y: record.boss.y + 2 };
  particle(dimension, 'minecraft:huge_explosion_emitter', at);
  particle(dimension, 'steveo:creeperite_burst', at);
  sound(dimension, 'mob.creeper.say', at, 0.4, 4);
  sound(dimension, 'random.fuse', at, 0.5, 4);
  for (const player of dimension.getPlayers({ location: record.boss, maxDistance: ANNOUNCE_RANGE })) {
    try {
      player.onScreenDisplay.setTitle({ translate: 'megacreepers.boss.title' }, {
        subtitle: { translate: 'megacreepers.boss.subtitle' },
        fadeInDuration: 10,
        stayDuration: 50,
        fadeOutDuration: 20,
      });
    } catch {
      // The player may be mid-disconnect.
    }
    say(player, 'megacreepers.boss.awakens');
  }
  return boss;
}

function bossPresent(dimension: Dimension, record: DungeonRecord): boolean {
  for (const boss of dimension.getEntities({ type: MEGA_CREEPER, location: record.boss, maxDistance: 64 })) {
    if (boss.getDynamicProperty(DUNGEON_PROPERTY) !== record.id) continue;
    bossDungeon.set(boss.id, record.id);
    return true;
  }
  return false;
}

// ---------- the vault ----------

/** Opens the vault: the door to air, the rest of the seal to plain bricks. */
export function unseal(record: DungeonRecord): void {
  const dimension = world.getDimension(record.dimension);
  // Cleared now so the loop does not start a second job; set again if blocks were missed.
  record.sealed = false;
  system.runJob(
    (function* () {
      const { min, max } = record.vault;
      let complete = true;
      let steps = 0;
      for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
        if (++steps % 64 === 0) yield;
        let block;
        try {
          block = dimension.getBlock({ x, y, z });
        } catch {
          block = undefined;
        }
        if (block === undefined) {
          complete = false;
          continue;
        }
        if (block.typeId !== BLOCKS.sealed) continue;
        const door = inside(record.door, { x, y, z }, 0);
        block.setType(door ? BLOCKS.air : Math.random() < 0.25 ? BLOCKS.cracked : BLOCKS.bricks);
      }
      const door = center(record.door);
      particle(dimension, 'steveo:creeperite_burst', door);
      particle(dimension, 'minecraft:huge_explosion_emitter', door);
      sound(dimension, 'random.explode', door, 0.6, 3);
      sound(dimension, 'random.levelup', door, 0.8, 2);
      record.sealed = !complete;
      saveDungeon(record);
    })(),
  );
}

world.afterEvents.entityDie.subscribe(
  (event) => {
    const dead = event.deadEntity;
    let id: unknown = bossDungeon.get(dead.id);
    bossDungeon.delete(dead.id);
    let at: Vector3 | undefined;
    let dimension: Dimension | undefined;
    try {
      id = dead.getDynamicProperty(DUNGEON_PROPERTY) ?? id;
      at = dead.location;
      dimension = dead.dimension;
    } catch {
      // Gone already; fall back to what we remembered.
    }
    const record = typeof id === 'string' ? getDungeon(id) : undefined;
    at ??= record?.boss;
    dimension ??= record === undefined ? undefined : world.getDimension(record.dimension);
    if (at !== undefined && dimension !== undefined) {
      for (const player of dimension.getPlayers({ location: at, maxDistance: ANNOUNCE_RANGE })) {
        say(player, record !== undefined ? 'megacreepers.boss.defeated' : 'megacreepers.boss.defeated_wild');
      }
    }
    if (record === undefined || record.bossState === 'defeated') return;
    record.bossState = 'defeated';
    saveDungeon(record);
    if (record.sealed) unseal(record);
  },
  { entityTypes: [MEGA_CREEPER] },
);

// ---------- the loop ----------

function visit(record: DungeonRecord, players: Player[]): void {
  const dimension = world.getDimension(record.dimension);
  const fighters = players.filter(isVulnerable);
  record.rooms.forEach((room, index) => {
    const occupied = fighters.some((p) => inside(room, p.location));
    if (!occupied) return;
    if (room.kind === 'arena') {
      if (record.bossState === 'asleep') wakeBoss(record);
      return;
    }
    ambush(dimension, record, index);
  });

  if (record.bossState === 'awake') {
    const arena = record.rooms.find((room) => room.kind === 'arena');
    const inArena = arena !== undefined && fighters.some((p) => inside(arena, p.location));
    if (bossPresent(dimension, record)) {
      missing.delete(record.id);
    } else if (inArena) {
      const passes = (missing.get(record.id) ?? 0) + 1;
      missing.set(record.id, passes);
      if (passes >= MISSING_PASSES) wakeBoss(record);
    }
  }
  if (record.bossState === 'defeated' && record.sealed) unseal(record);
}

system.runInterval(() => {
  const byDimension = new Map<string, Player[]>();
  for (const player of world.getAllPlayers()) {
    const list = byDimension.get(player.dimension.id) ?? [];
    list.push(player);
    byDimension.set(player.dimension.id, list);
  }
  for (const record of allDungeons()) {
    const players = (byDimension.get(record.dimension) ?? []).filter(
      (p) => horizontalDistance(p.location, record.boss) < NEAR,
    );
    if (players.length === 0) continue;
    try {
      visit(record, players);
    } catch (err) {
      log.warn(`dungeon ${record.id}: ${String(err)}`);
    }
  }
}, CHECK_INTERVAL);

world.afterEvents.pressurePlatePush.subscribe((event) => {
  const player = event.source;
  if (!(player instanceof Player) || !isVulnerable(player)) return;
  const { x, y, z } = event.block.location;
  const dimensionId = event.block.dimension.id;
  for (const record of allDungeons()) {
    if (record.dimension !== dimensionId) continue;
    for (const trap of record.traps) {
      if (trap.x !== x || trap.y !== y || trap.z !== z) continue;
      const trapKey = `${record.id}@${x},${y},${z}`;
      const now = system.currentTick;
      if (now < (nextTrap.get(trapKey) ?? 0)) return;
      nextTrap.set(trapKey, now + TRAP_COOLDOWN);
      for (const spawn of trap.spawns) spawnCreeper(event.block.dimension, spawn, false);
      sound(event.block.dimension, 'random.fuse', event.block.location, 1, 2);
      actionBar(player, 'megacreepers.trap');
      return;
    }
  }
});
