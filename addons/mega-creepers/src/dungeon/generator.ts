/**
 * Places creeper dungeons into the world as players explore.
 *
 * Why a script and not a world-gen feature: features only run on chunks
 * generated after the add-on is installed, and the worlds this is for (a
 * Realm) are already explored. So the world is divided into REGION-sized
 * squares; each has a fixed chance of one dungeon at a site picked from
 * the region's coordinates and a per-world salt. When a player comes within
 * BUILD_RANGE of an unvisited site (but no nearer than KEEP_AWAY, so nobody
 * watches it appear), the site is surveyed and, if it passes, built:
 *
 * - The whole footprint must be loaded, underground (mostly solid), dry
 *   enough, and free of anything artificial: no player builds, no
 *   mineshafts, strongholds, ancient cities, or other dungeons. A site that
 *   fails at every candidate depth is marked empty for good.
 * - Blocks go in through `system.runJob`, a few dozen per step, solid
 *   blocks first and supported ones (ladders, rails, plates, chests) last.
 * - The ladder shaft to a surface ruin is added only when the ground above
 *   is found and the column is untouched; otherwise the dungeon is still
 *   built and is found by caving, like a vanilla dungeon.
 */
import { BlockPermutation, system, world, type Block, type Dimension, type Vector3 } from '@minecraft/server';

import { horizontalDistance, log } from '../common';
import { FOOTPRINT, planDungeon, planShaft, seededRandom, type BlockSpec, type ChestSpot, type DungeonPlan, type Facing } from './layout';
import { isLoaded, regionStatus, saveDungeon, setRegionStatus, worldSalt, type DungeonRecord } from './records';
import { isArtificial, isCover, isGround, isLiquid, isReplaceable } from './terrain';

export const REGION = 192;
/** Keeps the footprint inside its region. */
const MARGIN = 40;
const DUNGEON_CHANCE = 0.6;
const BUILD_RANGE = 112;
/** No player may be this close (horizontally) to the footprint while it is built. */
const KEEP_AWAY = 24;
const MIN_Y = -40;
const MAX_Y = 10;
const DEPTH_TRIES = 4;
const SCAN_INTERVAL = 40;

const MIN_SOLID = 0.65;
const MAX_LIQUID = 0.1;
const STEPS_PER_YIELD = 48;

let busy = false;

export function isBusy(): boolean {
  return busy;
}

interface Site {
  rx: number;
  rz: number;
  x: number;
  z: number;
  depths: number[];
  seed: number;
}

function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f) ^ Math.imul(c, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** The region's dungeon site, or undefined if the region has none. */
function siteFor(rx: number, rz: number, salt: number): Site | undefined {
  const seed = mix(rx, rz, salt);
  const rand = seededRandom(seed);
  if (rand() >= DUNGEON_CHANCE) return undefined;
  const span = REGION - 2 * MARGIN;
  const depths: number[] = [];
  for (let i = 0; i < DEPTH_TRIES; i++) depths.push(MIN_Y + Math.floor(rand() * (MAX_Y - MIN_Y)));
  return {
    rx,
    rz,
    x: rx * REGION + MARGIN + Math.floor(rand() * span),
    z: rz * REGION + MARGIN + Math.floor(rand() * span),
    depths,
    seed,
  };
}

/** Horizontal distance from `at` to the footprint rectangle of a dungeon centred at `site`. */
function distanceToFootprint(at: Vector3, site: { x: number; z: number }): number {
  const dx = Math.max(site.x + FOOTPRINT.min.x - at.x, 0, at.x - (site.x + FOOTPRINT.max.x));
  const dz = Math.max(site.z + FOOTPRINT.min.z - at.z, 0, at.z - (site.z + FOOTPRINT.max.z));
  return Math.hypot(dx, dz);
}

function blockAt(dimension: Dimension, location: Vector3): Block | undefined {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

function boxLoaded(dimension: Dimension, min: Vector3, max: Vector3): boolean {
  for (let x = min.x; x <= max.x + 15; x += 16) {
    for (let z = min.z; z <= max.z + 15; z += 16) {
      const at = { x: Math.min(x, max.x), y: min.y, z: Math.min(z, max.z) };
      if (!dimension.isChunkLoaded(at)) return false;
    }
  }
  return true;
}

type Survey = 'ok' | 'unloaded' | 'artificial' | 'open' | 'wet';

/** Samples the footprint on a coarse grid and judges whether a dungeon belongs here. */
function* survey(dimension: Dimension, plan: DungeonPlan): Generator<void, Survey, void> {
  const { min, max } = plan.footprint;
  let total = 0;
  let solid = 0;
  let liquid = 0;
  let steps = 0;
  for (let x = min.x; x <= max.x; x += 3) {
    for (let z = min.z; z <= max.z; z += 3) {
      for (let y = min.y; y <= max.y; y += 2) {
        const block = blockAt(dimension, { x, y, z });
        if (block === undefined) return 'unloaded';
        const id = block.typeId;
        if (isArtificial(id)) return 'artificial';
        total++;
        if (isLiquid(id)) liquid++;
        else if (!block.isAir) solid++;
        if (++steps % STEPS_PER_YIELD === 0) yield;
      }
    }
  }
  if (liquid / total > MAX_LIQUID) return 'wet';
  if (solid / total < MIN_SOLID) return 'open';
  return 'ok';
}

/** The top ground block above the shaft, or undefined if there is no usable ground. */
function findSurface(dimension: Dimension, x: number, z: number): number | undefined {
  let block: Block | undefined;
  try {
    block = dimension.getTopmostBlock({ x, z });
  } catch {
    return undefined;
  }
  for (let i = 0; i < 48 && block !== undefined; i++) {
    const id = block.typeId;
    if (isGround(id)) return block.location.y;
    if (!isCover(id)) return undefined;
    block = blockAt(dimension, { x, y: block.location.y - 1, z });
  }
  return undefined;
}

/** True if the shaft column and the ruin's platform are untouched ground. */
function* shaftClear(dimension: Dimension, plan: DungeonPlan, surfaceY: number): Generator<void, boolean, void> {
  const { x: sx, z: sz } = plan.shaft;
  let steps = 0;
  for (let y = plan.shaftStartY; y <= surfaceY; y++) {
    const reach = y === surfaceY ? 2 : 1;
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
      const block = blockAt(dimension, { x: sx + dx, y, z: sz + dz });
      if (block === undefined || isArtificial(block.typeId)) return false;
      if (++steps % STEPS_PER_YIELD === 0) yield;
    }
  }
  return true;
}

// ---------- placing blocks ----------

const permutations = new Map<string, BlockPermutation | null>();

function permutationOf(spec: BlockSpec): BlockPermutation | undefined {
  const cacheKey = typeof spec === 'string' ? spec : JSON.stringify(spec);
  let permutation = permutations.get(cacheKey);
  if (permutation === undefined) {
    try {
      permutation = typeof spec === 'string' ? BlockPermutation.resolve(spec) : BlockPermutation.resolve(spec.id, spec.states);
    } catch (err) {
      // A state the game rejects: fall back to the plain block, then give up.
      log.warn(`cannot resolve ${cacheKey}: ${String(err)}`);
      try {
        permutation = typeof spec === 'string' ? null : BlockPermutation.resolve(spec.id);
      } catch {
        permutation = null;
      }
    }
    permutations.set(cacheKey, permutation);
  }
  return permutation ?? undefined;
}

const CHEST_DIRECTIONS: Record<Facing, number> = { north: 2, south: 3, west: 4, east: 5 };

function chestPermutation(facing: Facing): BlockPermutation {
  const base = BlockPermutation.resolve('minecraft:chest');
  try {
    return base.withState('minecraft:cardinal_direction', facing);
  } catch {
    try {
      return base.withState('facing_direction', CHEST_DIRECTIONS[facing]);
    } catch {
      return base;
    }
  }
}

function fillChest(dimension: Dimension, spot: ChestSpot): boolean {
  const container = blockAt(dimension, spot)?.getComponent('minecraft:inventory')?.container;
  if (container === undefined) return false;
  const manager = world.getLootTableManager();
  const table = manager.getLootTable(`chests/creeper_dungeon_${spot.table}`);
  if (table === undefined) {
    log.warn(`missing loot table chests/creeper_dungeon_${spot.table}`);
    return true;
  }
  const items = manager.generateLootFromTable(table) ?? [];
  const free: number[] = [];
  for (let slot = 0; slot < container.size; slot++) free.push(slot);
  for (const item of items) {
    const index = Math.floor(Math.random() * free.length);
    const slot = free.splice(index, 1)[0];
    if (slot === undefined) break;
    container.setItem(slot, item);
  }
  return true;
}

/** Places the plan, then its chests. Returns how many placements failed (unloaded chunks). */
function* build(dimension: Dimension, plan: DungeonPlan): Generator<void, number, void> {
  let failed = 0;
  let steps = 0;
  const all = [...plan.placements.values()];
  for (const late of [false, true]) {
    for (const placement of all) {
      if ((placement.late ?? false) !== late) continue;
      const block = blockAt(dimension, placement);
      if (block === undefined) {
        failed++;
        continue;
      }
      if (placement.ifReplaceable === true && !isReplaceable(block.typeId)) continue;
      const permutation = permutationOf(placement.block);
      if (permutation === undefined) continue;
      try {
        block.setPermutation(permutation);
      } catch {
        failed++;
      }
      if (++steps % STEPS_PER_YIELD === 0) yield;
    }
  }
  for (const spot of plan.chests) {
    try {
      blockAt(dimension, spot)?.setPermutation(chestPermutation(spot.facing));
    } catch {
      failed++;
    }
  }
  // Give the chests a tick to grow their block entities before filling them.
  yield;
  for (const spot of plan.chests) {
    try {
      if (!fillChest(dimension, spot)) {
        yield;
        fillChest(dimension, spot);
      }
    } catch (err) {
      log.warn(`filling chest: ${String(err)}`);
    }
  }
  return failed;
}

export function recordFor(id: string, dimension: Dimension, plan: DungeonPlan): DungeonRecord {
  return {
    id,
    dimension: dimension.id,
    rooms: plan.rooms,
    traps: plan.traps,
    vault: plan.vault,
    door: plan.door,
    boss: plan.boss,
    bossState: 'asleep',
    sealed: true,
  };
}

/** Builds a dungeon with its arena centred at `origin`, ladder shaft included if the ground allows. */
export function* buildDungeon(dimension: Dimension, plan: DungeonPlan, id: string): Generator<void, DungeonRecord, void> {
  const surfaceY = findSurface(dimension, plan.shaft.x, plan.shaft.z);
  if (surfaceY !== undefined && surfaceY > plan.shaftStartY + 3) {
    if (yield* shaftClear(dimension, plan, surfaceY)) planShaft(plan, surfaceY, plan.origin.x ^ plan.origin.z);
  }
  const failed = yield* build(dimension, plan);
  if (failed > 0) log.warn(`dungeon ${id}: ${failed} block(s) could not be placed`);
  const record = recordFor(id, dimension, plan);
  saveDungeon(record);
  log.info(`built creeper dungeon ${id} at ${plan.boss.x} ${plan.boss.y} ${plan.boss.z}`);
  return record;
}

function* generateSite(dimension: Dimension, site: Site): Generator<void, void, void> {
  try {
    for (const y of site.depths) {
      const plan = planDungeon({ x: site.x, y, z: site.z }, site.seed);
      if (!boxLoaded(dimension, plan.footprint.min, plan.footprint.max)) return;
      const verdict = yield* survey(dimension, plan);
      if (verdict === 'unloaded') return;
      if (verdict !== 'ok') continue;
      yield* buildDungeon(dimension, plan, `${site.rx},${site.rz}`);
      setRegionStatus(site.rx, site.rz, 'built');
      return;
    }
    setRegionStatus(site.rx, site.rz, 'none');
  } catch (err) {
    log.error(`generating dungeon in region ${site.rx},${site.rz}`, err);
  } finally {
    busy = false;
  }
}

function scan(): void {
  if (busy || !isLoaded()) return;
  const dimension = world.getDimension('overworld');
  const players = dimension.getPlayers();
  if (players.length === 0) return;
  const salt = worldSalt();
  const seen = new Set<string>();
  for (const player of players) {
    const prx = Math.floor(player.location.x / REGION);
    const prz = Math.floor(player.location.z / REGION);
    for (let rx = prx - 1; rx <= prx + 1; rx++) {
      for (let rz = prz - 1; rz <= prz + 1; rz++) {
        const regionKey = `${rx},${rz}`;
        if (seen.has(regionKey)) continue;
        seen.add(regionKey);
        if (regionStatus(rx, rz) !== undefined) continue;
        const site = siteFor(rx, rz, salt);
        if (site === undefined) {
          setRegionStatus(rx, rz, 'none');
          continue;
        }
        if (horizontalDistance(player.location, { x: site.x, y: 0, z: site.z }) > BUILD_RANGE) continue;
        if (players.some((p) => distanceToFootprint(p.location, site) < KEEP_AWAY)) continue;
        busy = true;
        system.runJob(generateSite(dimension, site));
        return;
      }
    }
  }
}

system.runInterval(() => {
  try {
    scan();
  } catch (err) {
    busy = false;
    log.error('dungeon scan', err);
  }
}, SCAN_INTERVAL);

/** Starts building a dungeon at `origin` right away, skipping the survey (debug). */
export function buildNow(dimension: Dimension, origin: Vector3): boolean {
  if (busy) return false;
  busy = true;
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const plan = planDungeon(origin, seed);
  const id = `debug:${origin.x},${origin.y},${origin.z}`;
  system.runJob(
    (function* () {
      try {
        yield* buildDungeon(dimension, plan, id);
      } catch (err) {
        log.error('debug dungeon build', err);
      } finally {
        busy = false;
      }
    })(),
  );
  return true;
}

