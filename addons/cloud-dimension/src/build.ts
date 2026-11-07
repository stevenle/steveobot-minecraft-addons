// Builds the Cloud Dimension from the plans in layout.ts.
//
// The dimension uses the void generator, so every block is placed here, and
// blocks can only be placed in loaded chunks. Each section's plan is split
// into 32x32 tiles (2x2 chunks); a tile is loaded with a ticking area,
// placed, then released, one tile at a time. Finished tiles are saved in a
// world dynamic property, so a restart picks up where it stopped and a
// finished tile is never placed twice (which would duplicate its mobs).
//
// If ticking areas fail, tiles are built lazily instead: whenever a player
// is in the dimension and a tile's chunks happen to be loaded.
import { system, world, type Dimension, type Vector3 } from '@minecraft/server';

import { createLogger } from '@shared/log';

import { SECTIONS, type Placement, type Section } from './layout';

const log = createLogger('cloud-dimension');

const BUILT = 'steveo:clouds_built';
/** Set by 1.0.0 once the starter island was up. */
const LEGACY_ISLAND_BUILT = 'steveo:clouds_island';
const TICKING_AREA = 'steveo:clouds_build';
const TILE = 32;

export let buildNote = 'idle';
let running: Promise<void> | undefined;
let tickingAreasFail = false;

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function builtTiles(): Set<string> {
  const raw = world.getDynamicProperty(BUILT);
  const done = new Set<string>();
  if (typeof raw === 'string') {
    try {
      for (const key of JSON.parse(raw) as string[]) done.add(key);
    } catch {
      // Start over; placing again is harmless for blocks.
    }
  }
  return done;
}

function markBuilt(key: string): void {
  const done = builtTiles();
  done.add(key);
  world.setDynamicProperty(BUILT, JSON.stringify([...done]));
}

type Tile = { key: string; tx: number; tz: number; placements: Placement[] };

function tilesOf(section: Section): Tile[] {
  const byTile = new Map<string, Tile>();
  for (const p of section.plan()) {
    const tx = Math.floor(p.at.x / TILE);
    const tz = Math.floor(p.at.z / TILE);
    const key = `${section.key}:${tx}:${tz}`;
    let tile = byTile.get(key);
    if (!tile) byTile.set(key, (tile = { key, tx, tz, placements: [] }));
    tile.placements.push(p);
  }
  return [...byTile.values()];
}

export function sectionDone(key: string): boolean {
  if (key === 'start' && world.getDynamicProperty(LEGACY_ISLAND_BUILT) === true) return true;
  return builtTiles().has(`${key}:done`);
}

/** How far along each section is, for the debug check. */
export function progress(): string {
  return SECTIONS.map((s) => `${s.key} ${sectionDone(s.key) ? 'built' : 'pending'}`).join(', ');
}

function* placeTile(dimension: Dimension, tile: Tile, counts: { placed: number; failed: number }) {
  let n = 0;
  for (const p of tile.placements) {
    try {
      if (p.kind === 'block') {
        if (typeof p.block === 'string') dimension.setBlockType(p.at, p.block);
        else dimension.setBlockPermutation(p.at, p.block);
      } else if (p.kind === 'chest') {
        dimension.setBlockType(p.at, 'minecraft:chest');
        const container = dimension.getBlock(p.at)?.getComponent('minecraft:inventory')?.container;
        p.items().forEach((item, slot) => container?.setItem(slot * 4 + 2, item));
      } else {
        continue;
      }
      counts.placed++;
    } catch {
      counts.failed++;
    }
    if (++n % 250 === 0) yield;
  }
  // Mobs last, and only on a clean pass: a tile with failures is placed
  // again later, and its mobs must not be spawned twice.
  if (counts.failed > 0) return;
  for (const p of tile.placements) {
    if (p.kind !== 'spawn') continue;
    for (let i = 0; i < p.count; i++) {
      const offset = { x: (i % 2) - 0.5, y: 0, z: Math.floor(i / 2) - 0.5 };
      try {
        dimension.spawnEntity(p.id, { x: p.at.x + offset.x, y: p.at.y, z: p.at.z + offset.z });
      } catch (err) {
        log.warn(`could not spawn ${p.id}: ${errorText(err)}`);
      }
    }
  }
}

function runTile(dimension: Dimension, tile: Tile): Promise<{ placed: number; failed: number }> {
  const counts = { placed: 0, failed: 0 };
  return new Promise((resolve) => {
    system.runJob(
      (function* () {
        yield* placeTile(dimension, tile, counts);
        resolve(counts);
      })(),
    );
  });
}

function tileBox(tile: Tile): { from: Vector3; to: Vector3 } {
  return {
    from: { x: tile.tx * TILE, y: 64, z: tile.tz * TILE },
    to: { x: tile.tx * TILE + TILE - 1, y: 140, z: tile.tz * TILE + TILE - 1 },
  };
}

function tileLoaded(dimension: Dimension, tile: Tile): boolean {
  const { from, to } = tileBox(tile);
  try {
    return [from, to, { x: from.x, y: 100, z: to.z }, { x: to.x, y: 100, z: from.z }].every((at) =>
      dimension.isChunkLoaded({ x: at.x, y: 100, z: at.z }),
    );
  } catch {
    return false;
  }
}

async function loadTile(dimension: Dimension, tile: Tile): Promise<boolean> {
  if (tileLoaded(dimension, tile)) return true;
  if (tickingAreasFail) return false;
  const manager = world.tickingAreaManager;
  try {
    if (manager.hasTickingArea(TICKING_AREA)) manager.removeTickingArea(TICKING_AREA);
    await manager.createTickingArea(TICKING_AREA, { dimension, ...tileBox(tile) });
    return true;
  } catch (err) {
    tickingAreasFail = true;
    log.warn(`ticking areas failed, building lazily: ${errorText(err)}`);
    buildNote = `ticking areas failed (${errorText(err)}); building as players explore`;
    return false;
  }
}

function releaseTile(): void {
  try {
    const manager = world.tickingAreaManager;
    if (manager.hasTickingArea(TICKING_AREA)) manager.removeTickingArea(TICKING_AREA);
  } catch {
    // Already gone.
  }
}

/**
 * Builds every unfinished section (or only `only`), tile by tile. Returns
 * once everything it could build is built. Only one build runs at a time;
 * a second call waits for the first.
 */
export function buildPending(dimension: Dimension, only?: string): Promise<void> {
  if (running) return running.then(() => (only && !sectionDone(only) ? buildPending(dimension, only) : undefined));
  running = (async () => {
    try {
      for (const section of SECTIONS) {
        if (only && section.key !== only) continue;
        if (sectionDone(section.key)) continue;
        const done = builtTiles();
        let complete = true;
        for (const tile of tilesOf(section)) {
          if (done.has(tile.key)) continue;
          buildNote = `building ${tile.key}`;
          if (!(await loadTile(dimension, tile))) {
            complete = false;
            continue;
          }
          const counts = await runTile(dimension, tile);
          releaseTile();
          log.info(`${tile.key}: placed ${counts.placed}, failed ${counts.failed}`);
          // A tile with failures (unloaded edges) is retried next time.
          if (counts.failed === 0) markBuilt(tile.key);
          else complete = false;
        }
        if (complete) {
          markBuilt(`${section.key}:done`);
          if (section.key === 'castle') onCastleBuilt?.(dimension);
        }
      }
      buildNote = 'idle';
    } catch (err) {
      buildNote = `build failed: ${errorText(err)}`;
      log.warn(buildNote);
    } finally {
      releaseTile();
      running = undefined;
    }
  })();
  return running;
}

/** Forgets that a section was built, so the next build places it again (debug). */
export function forget(key: string): void {
  const done = [...builtTiles()].filter((k) => !k.startsWith(`${key}:`));
  world.setDynamicProperty(BUILT, JSON.stringify(done));
  if (key === 'start') world.setDynamicProperty(LEGACY_ISLAND_BUILT, undefined);
}

export function isBuilding(): boolean {
  return running !== undefined;
}

let onCastleBuilt: ((dimension: Dimension) => void) | undefined;
export function whenCastleBuilt(callback: (dimension: Dimension) => void): void {
  onCastleBuilt = callback;
}
