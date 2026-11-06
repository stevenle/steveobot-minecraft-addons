// Cloud Dimension: a custom dimension of floating islands.
//
// This first release is the test of the foundations: the dimension itself,
// the Cloud Portal that takes you there and back, the starter island, and
// the safety net that floats you home if you fall off. The Sky Castle, the
// Floatatoes, the Nimbus King and the Cloud Staff build on top of it.
//
// The dimension is registered at startup and uses the void generator, so
// everything in it is placed by this script. Blocks can only be placed in
// loaded chunks, so the starter island is built under a ticking area before
// anyone is sent there.
import {
  BlockPermutation,
  BlockTypes,
  ItemStack,
  system,
  world,
  type Dimension,
  type Player,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

const log = createLogger('cloud-dimension');

const DIMENSION_ID = 'steveo:clouds';
const PORTAL_BLOCK = 'steveo:cloud_portal';
const CLOUD_BLOCK = 'steveo:cloud_block';

/** The surface block at the middle of the starter island. */
const ISLAND = { x: 0, y: 100, z: 0 };
const ISLAND_RADIUS = 10;
/** The island's own Cloud Portal, set into the surface. */
const HOME_PORTAL = { x: 0, y: ISLAND.y, z: -4 };
/** Where travellers land: on the island, facing the portal, not on it. */
const ARRIVAL = { x: 0.5, y: ISLAND.y + 1, z: 3.5 };
/** Fall this far below the island and you are floated home. */
const FALL_LIMIT = ISLAND.y - 40;

const ISLAND_BUILT = 'steveo:clouds_island';
const RETURN_POINT = 'steveo:clouds_return';
const TICKING_AREA = 'steveo:clouds_start';

/** Ticks after a trip during which portals ignore you, so you do not bounce back. */
const TRAVEL_COOLDOWN = 60;
const SLOW_FALL_TICKS = 20 * 30;

let registerError: string | undefined;
let lastBuildNote = 'not built this session';
const coolingUntil = new Map<string, number>();
const traveling = new Set<string>();

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function say(player: Player, key: string, ...args: string[]): void {
  const message: RawMessage = args.length ? { translate: key, with: args } : { translate: key };
  player.sendMessage(message);
}

function cloudDimension(): Dimension | undefined {
  try {
    return world.getDimension(DIMENSION_ID);
  } catch {
    return undefined;
  }
}

// ---------- The starter island ----------

/** A small seeded random generator, so a rebuilt island has the same shape. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Placement = { at: Vector3; block: string | BlockPermutation };

/** Lists every block of the starter island, top layers first. */
function islandPlan(): Placement[] {
  const rand = seeded(20261105);
  const wobble = [rand(), rand(), rand()].map((v) => v * Math.PI * 2);
  const plan: Placement[] = [];
  for (let dx = -ISLAND_RADIUS; dx <= ISLAND_RADIUS; dx++) {
    for (let dz = -ISLAND_RADIUS; dz <= ISLAND_RADIUS; dz++) {
      const angle = Math.atan2(dz, dx);
      const edge =
        ISLAND_RADIUS *
        (0.82 + 0.1 * Math.sin(angle * 3 + (wobble[0] ?? 0)) + 0.08 * Math.sin(angle * 5 + (wobble[1] ?? 0)));
      const d = Math.hypot(dx, dz);
      if (d > edge) continue;
      const inner = 1 - d / edge;
      const depth = 1 + Math.round(inner * 7 + rand() * 1.5);
      const grassy = d < edge - 2.5;
      for (let i = 0; i < depth; i++) {
        let block = CLOUD_BLOCK;
        if (grassy && i === 0) block = 'minecraft:grass_block';
        else if (grassy && i < 3) block = 'minecraft:dirt';
        plan.push({ at: { x: ISLAND.x + dx, y: ISLAND.y - i, z: ISLAND.z + dz }, block });
      }
    }
  }

  // An oak tree off to one side.
  const tree = { x: ISLAND.x + 4, y: ISLAND.y + 1, z: ISLAND.z - 1 };
  const leaves = BlockPermutation.resolve('minecraft:oak_leaves', { persistent_bit: true });
  for (let dy = 2; dy <= 5; dy++) {
    const r = dy >= 5 ? 1 : 2;
    for (let lx = -r; lx <= r; lx++) {
      for (let lz = -r; lz <= r; lz++) {
        if (Math.abs(lx) === r && Math.abs(lz) === r && (dy === 5 || rand() < 0.5)) continue;
        plan.push({ at: { x: tree.x + lx, y: tree.y + dy, z: tree.z + lz }, block: leaves });
      }
    }
  }
  for (let dy = 0; dy < 5; dy++) plan.push({ at: { x: tree.x, y: tree.y + dy, z: tree.z }, block: 'minecraft:oak_log' });

  // A few loose puffs of cloud around the island.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + (wobble[2] ?? 0);
    const c = { x: ISLAND.x + Math.round(Math.cos(a) * 15), y: ISLAND.y - 3 + i, z: ISLAND.z + Math.round(Math.sin(a) * 15) };
    for (let px = -1; px <= 1; px++) {
      for (let pz = -1; pz <= 1; pz++) {
        if (Math.abs(px) + Math.abs(pz) < 2) plan.push({ at: { x: c.x + px, y: c.y, z: c.z + pz }, block: CLOUD_BLOCK });
      }
    }
  }

  plan.push({ at: HOME_PORTAL, block: PORTAL_BLOCK });
  return plan;
}

function* placeAll(dimension: Dimension, plan: Placement[], done: (placed: number, failed: number) => void) {
  let placed = 0;
  let failed = 0;
  for (const { at, block } of plan) {
    try {
      if (typeof block === 'string') dimension.setBlockType(at, block);
      else dimension.setBlockPermutation(at, block);
      placed++;
    } catch {
      failed++;
    }
    if ((placed + failed) % 200 === 0) yield;
  }
  done(placed, failed);
}

/** Places the island; resolves once every block has been tried. */
function placeIsland(dimension: Dimension): Promise<void> {
  return new Promise((resolve) => {
    system.runJob(
      placeAll(dimension, islandPlan(), (placed, failed) => {
        lastBuildNote = `placed ${placed}, failed ${failed}`;
        if (failed === 0) world.setDynamicProperty(ISLAND_BUILT, true);
        log.info(`starter island: ${lastBuildNote}`);
        resolve();
      }),
    );
  });
}

/** Loads the island's chunks with a ticking area, builds it, then lets them go. */
async function buildIsland(dimension: Dimension): Promise<void> {
  const manager = world.tickingAreaManager;
  const r = ISLAND_RADIUS + 8;
  try {
    if (manager.hasTickingArea(TICKING_AREA)) manager.removeTickingArea(TICKING_AREA);
    await manager.createTickingArea(TICKING_AREA, {
      dimension,
      from: { x: ISLAND.x - r, y: ISLAND.y - 12, z: ISLAND.z - r },
      to: { x: ISLAND.x + r, y: ISLAND.y + 8, z: ISLAND.z + r },
    });
  } catch (err) {
    lastBuildNote = `ticking area failed (${errorText(err)})`;
    throw err;
  }
  try {
    await placeIsland(dimension);
  } finally {
    try {
      manager.removeTickingArea(TICKING_AREA);
    } catch {
      // Already gone.
    }
  }
}

/** Waits up to `ticks` for the island's middle chunk to load around a player. */
function whenLoaded(dimension: Dimension, ticks: number): Promise<boolean> {
  return new Promise((resolve) => {
    let waited = 0;
    const id = system.runInterval(() => {
      waited++;
      let loaded = false;
      try {
        loaded = dimension.isChunkLoaded(ISLAND);
      } catch {
        // Not yet.
      }
      if (loaded || waited >= ticks) {
        system.clearRun(id);
        resolve(loaded);
      }
    }, 1);
  });
}

// ---------- Travel ----------

function cool(player: Player): void {
  coolingUntil.set(player.id, system.currentTick + TRAVEL_COOLDOWN);
}

function isCooling(player: Player): boolean {
  return (coolingUntil.get(player.id) ?? 0) > system.currentTick;
}

type ReturnPoint = { dim: string; x: number; y: number; z: number };

function saveReturnPoint(player: Player, at: Vector3): void {
  const point: ReturnPoint = { dim: player.dimension.id, x: at.x, y: at.y, z: at.z };
  player.setDynamicProperty(RETURN_POINT, JSON.stringify(point));
}

function returnPoint(player: Player): ReturnPoint {
  const raw = player.getDynamicProperty(RETURN_POINT);
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ReturnPoint;
    } catch {
      // Fall through to world spawn.
    }
  }
  const spawn = world.getDefaultSpawnLocation();
  // An unset spawn height comes back as a sentinel far above the world.
  const y = spawn.y > 320 ? 120 : spawn.y;
  return { dim: 'minecraft:overworld', x: spawn.x + 0.5, y, z: spawn.z + 0.5 };
}

async function goUp(player: Player, from: Vector3): Promise<void> {
  if (traveling.has(player.id)) return;
  const dimension = cloudDimension();
  if (!dimension) {
    say(player, 'clouds.broken', loadCheck());
    return;
  }
  traveling.add(player.id);
  cool(player);
  try {
    saveReturnPoint(player, from);
    const first = world.getDynamicProperty(ISLAND_BUILT) !== true;
    if (first) {
      say(player, 'clouds.building');
      try {
        await buildIsland(dimension);
      } catch (err) {
        // No ticking area: send the player up high on Slow Falling, wait
        // for the chunks to load around them, and build under them.
        log.warn(`ticking area failed, building around the player: ${errorText(err)}`);
        player.addEffect('slow_falling', SLOW_FALL_TICKS, { showParticles: false });
        player.teleport({ x: ARRIVAL.x, y: ISLAND.y + 30, z: ARRIVAL.z }, { dimension });
        if (await whenLoaded(dimension, 200)) await placeIsland(dimension);
      }
    }
    if (!player.isValid) return;
    player.teleport(ARRIVAL, { dimension, facingLocation: { x: HOME_PORTAL.x + 0.5, y: ARRIVAL.y, z: HOME_PORTAL.z + 0.5 } });
    cool(player);
    player.onScreenDisplay.setTitle({ translate: 'clouds.arrive.title' }, {
      subtitle: { translate: 'clouds.arrive.subtitle' },
      fadeInDuration: 10,
      stayDuration: 50,
      fadeOutDuration: 20,
    });
    player.playSound('mob.breeze.idle_ground', { volume: 0.8 });
    if (first || player.getDynamicProperty('steveo:clouds_visited') !== true) {
      player.setDynamicProperty('steveo:clouds_visited', true);
      say(player, 'clouds.arrive.first');
    }
  } catch (err) {
    log.warn(`trip up failed: ${errorText(err)}`);
    if (player.isValid) say(player, 'clouds.debug.error', errorText(err));
  } finally {
    traveling.delete(player.id);
  }
}

/** Sends a player home. A fall drops them into the sky above their return point. */
function goHome(player: Player, fell: boolean): void {
  const point = returnPoint(player);
  let dimension: Dimension;
  try {
    dimension = world.getDimension(point.dim);
  } catch {
    dimension = world.getDimension('minecraft:overworld');
  }
  cool(player);
  const top = dimension.heightRange.max - 2;
  const y = fell ? Math.min(point.y + 40, top) : point.y;
  player.addEffect('slow_falling', fell ? SLOW_FALL_TICKS : 100, { showParticles: false });
  player.teleport({ x: point.x, y, z: point.z }, { dimension });
  say(player, fell ? 'clouds.fell' : 'clouds.home');
}

function onPortal(player: Player, at: Vector3): void {
  if (isCooling(player) || traveling.has(player.id)) return;
  if (player.dimension.id === DIMENSION_ID) goHome(player, false);
  else void goUp(player, { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 });
}

// ---------- Registration ----------

system.beforeEvents.startup.subscribe((event) => {
  try {
    event.dimensionRegistry.registerCustomDimension(DIMENSION_ID);
  } catch (err) {
    // Already registered is fine (a script reload); anything else is reported by the load check.
    if (!(err instanceof Error && err.name === 'CustomDimensionAlreadyRegisteredError')) registerError = errorText(err);
  }

  event.blockComponentRegistry.registerCustomComponent(PORTAL_BLOCK, {
    onStepOn: (e) => {
      const entity = e.entity;
      if (entity?.typeId !== 'minecraft:player') return;
      const player = entity as Player;
      const at = e.block.location;
      system.run(() => {
        if (player.isValid) onPortal(player, at);
      });
    },
    onPlayerInteract: (e) => {
      const player = e.player;
      if (!player) return;
      const at = e.block.location;
      system.run(() => {
        if (player.isValid) onPortal(player, at);
      });
    },
  });
});

// The island's own portal is the way home, so it cannot be mined.
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.dimension.id !== DIMENSION_ID || event.block.typeId !== PORTAL_BLOCK) return;
  const at = event.block.location;
  if (at.x !== HOME_PORTAL.x || at.y !== HOME_PORTAL.y || at.z !== HOME_PORTAL.z) return;
  event.cancel = true;
  const player = event.player;
  system.run(() => {
    if (player.isValid) say(player, 'clouds.island_portal');
  });
});

// The safety net: fall off an island and you float down home.
system.runInterval(() => {
  const dimension = cloudDimension();
  if (!dimension) return;
  for (const player of dimension.getPlayers()) {
    if (player.location.y < FALL_LIMIT && !traveling.has(player.id)) goHome(player, true);
  }
}, 10);

// ---------- Load check and debug ----------

function loadCheck(): string {
  const parts: string[] = [];
  const dimension = cloudDimension();
  if (dimension) {
    const range = dimension.heightRange;
    parts.push(`dimension ok (y ${range.min}..${range.max})`);
  } else {
    parts.push(`dimension MISSING${registerError ? ` (${registerError})` : ''}`);
  }
  parts.push(`portal ${BlockTypes.get(PORTAL_BLOCK) ? 'ok' : 'MISSING'}`);
  parts.push(`cloud ${BlockTypes.get(CLOUD_BLOCK) ? 'ok' : 'MISSING'}`);
  parts.push(`island ${world.getDynamicProperty(ISLAND_BUILT) === true ? 'built' : 'not built'} (${lastBuildNote})`);
  return parts.join(', ');
}

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  if (!cloudDimension()) say(event.player, 'clouds.broken', loadCheck());
});

async function debug(player: Player, command: string): Promise<void> {
  switch (command) {
    case 'check':
      say(player, 'clouds.debug.check', loadCheck());
      return;
    case 'go':
      await goUp(player, player.location);
      return;
    case 'home':
      goHome(player, false);
      return;
    case 'portal':
      player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(PORTAL_BLOCK, 1));
      say(player, 'clouds.debug.portal');
      return;
    case 'rebuild': {
      const dimension = cloudDimension();
      if (!dimension) throw new Error('the dimension did not load');
      await buildIsland(dimension);
      say(player, 'clouds.debug.rebuilt');
      say(player, 'clouds.debug.check', loadCheck());
      return;
    }
    default:
      say(player, 'clouds.debug.help');
  }
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:clouds') return;
    const player = event.sourceEntity;
    if (player?.typeId !== 'minecraft:player') return;
    debug(player as Player, event.message.trim().toLowerCase()).catch((err: unknown) => {
      if (player.isValid) (player as Player).sendMessage(`${Format.red}${errorText(err)}`);
    });
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
