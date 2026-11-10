// Cloud Dimension: a custom dimension of floating islands.
//
// A Cloud Portal takes you to the starter island; Gust Pads launch you
// along a chain of islands to the Sky Castle, where Charge minions guard
// the courtyard, Floatatoes wait in a glass case on the keep's roof, and a
// Storm Crystal on the throne altar calls the Nimbus King. Beating him drops
// the Cloud Staff. Fall off anywhere and you float down home.
//
// The dimension is registered at startup and uses the void generator, so
// build.ts places everything in it from the plans in layout.ts.
import {
  BlockTypes,
  EntityTypes,
  ItemStack,
  system,
  world,
  type Dimension,
  type Entity,
  type Player,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

import { installBosses, summonKing, tickBosses, useAltar } from './boss';
import { buildNote, buildPending, forget, isBuilding, progress, sectionDone, whenCastleBuilt } from './build';
import { bringAlong, floatatoesOf, installFloatatoes } from './floatato';
import {
  ARENA,
  ARRIVAL,
  CASE_CENTER,
  CASTLE_GATE,
  CHARGE,
  CLOUD_BLOCK,
  CLOUD_STAFF,
  DIMENSION_ID,
  FALL_LIMIT,
  FLOATATO,
  GUST_PAD,
  HOME_PORTAL,
  ISLAND,
  NIMBUS_KING,
  PORTAL_BLOCK,
  STORM_ALTAR,
  STORM_CRYSTAL,
} from './layout';
import { installStaff } from './staff';

const log = createLogger('cloud-dimension');

const RETURN_POINT = 'steveo:clouds_return';
const VISITED = 'steveo:clouds_visited';

/** Ticks after a trip during which portals ignore you, so you do not bounce back. */
const TRAVEL_COOLDOWN = 60;
const SLOW_FALL_TICKS = 20 * 30;
/** Gust Pad launch: forward along your look, and up. Tunable in-game with `padpower`. */
const PAD_POWER = 'steveo:clouds_pad_power';
const PAD_DEFAULT = { forward: 1.5, up: 1.1 };

function padPower(): { forward: number; up: number } {
  const raw = world.getDynamicProperty(PAD_POWER);
  if (typeof raw === 'string') {
    try {
      return { ...PAD_DEFAULT, ...(JSON.parse(raw) as Partial<typeof PAD_DEFAULT>) };
    } catch {
      // Defaults.
    }
  }
  return PAD_DEFAULT;
}

let registerError: string | undefined;
const coolingUntil = new Map<string, number>();
const traveling = new Set<string>();
const padUntil = new Map<string, number>();

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

/** Builds whatever is left, in the background, and tells explorers when the castle appears. */
function buildInBackground(dimension: Dimension): void {
  if (isBuilding()) return;
  if (['start_pad', 'chain', 'castle'].every(sectionDone)) return;
  buildPending(dimension).catch((err: unknown) => log.warn(`background build failed: ${errorText(err)}`));
}

whenCastleBuilt((dimension) => {
  for (const player of dimension.getPlayers()) say(player, 'clouds.castle_ready');
});

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
    const pets = floatatoesOf(player, 24);
    if (!sectionDone('start')) {
      say(player, 'clouds.building');
      // Hold the player safely high on Slow Falling in case ticking areas
      // fail and the island has to be built around them.
      await buildPending(dimension, 'start');
      if (!sectionDone('start')) {
        player.addEffect('slow_falling', SLOW_FALL_TICKS, { showParticles: false });
        player.teleport({ x: ARRIVAL.x, y: ISLAND.y + 30, z: ARRIVAL.z }, { dimension });
        for (let i = 0; i < 10 && !sectionDone('start'); i++) {
          await system.waitTicks(20);
          await buildPending(dimension, 'start');
        }
      }
    }
    if (!player.isValid) return;
    player.teleport(ARRIVAL, { dimension, facingLocation: { x: HOME_PORTAL.x + 0.5, y: ARRIVAL.y, z: HOME_PORTAL.z + 0.5 } });
    bringAlong(pets, dimension, ARRIVAL);
    cool(player);
    player.onScreenDisplay.setTitle({ translate: 'clouds.arrive.title' }, {
      subtitle: { translate: 'clouds.arrive.subtitle' },
      fadeInDuration: 10,
      stayDuration: 50,
      fadeOutDuration: 20,
    });
    player.playSound('mob.breeze.idle_ground', { volume: 0.8 });
    if (player.getDynamicProperty(VISITED) !== true) {
      player.setDynamicProperty(VISITED, true);
      say(player, 'clouds.arrive.first');
    }
    if (!sectionDone('castle')) say(player, 'clouds.castle_building');
    buildInBackground(dimension);
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
  const pets = floatatoesOf(player, 48);
  cool(player);
  const top = dimension.heightRange.max - 2;
  const y = fell ? Math.min(point.y + 40, top) : point.y;
  player.addEffect('slow_falling', fell ? SLOW_FALL_TICKS : 100, { showParticles: false });
  const to = { x: point.x, y, z: point.z };
  player.teleport(to, { dimension });
  bringAlong(pets, dimension, to);
  say(player, fell ? 'clouds.fell' : 'clouds.home');
}

function onPortal(player: Player, at: Vector3): void {
  if (isCooling(player) || traveling.has(player.id)) return;
  if (player.dimension.id === DIMENSION_ID) goHome(player, false);
  else void goUp(player, { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 });
}

// ---------- Gust Pads ----------

/** Launches whatever stepped on the pad: players, and any mob (anything with health). */
function launch(entity: Entity): void {
  const isPlayer = entity.typeId === 'minecraft:player';
  if (!isPlayer && !entity.hasComponent('minecraft:health')) return; // Dropped items, arrows, orbs.
  const now = system.currentTick;
  if ((padUntil.get(entity.id) ?? 0) > now) return;
  // Mobs come and go, so drop spent entries rather than let the map grow.
  if (padUntil.size > 64) for (const [id, until] of padUntil) if (until <= now) padUntil.delete(id);
  padUntil.set(entity.id, now + 10);
  // A player flies where they look; a mob flies the way it is facing.
  const view = entity.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  const power = padPower();
  entity.applyKnockback({ x: (view.x / flat) * power.forward, z: (view.z / flat) * power.forward }, power.up);
  // A soft landing on the next island.
  entity.addEffect('slow_falling', 60, { showParticles: false });
  const sound = { pitch: 1.2, volume: 0.7 };
  if (isPlayer) (entity as Player).playSound('wind_charge.burst', sound);
  else entity.dimension.playSound('wind_charge.burst', entity.location, sound);
  try {
    entity.dimension.spawnParticle('minecraft:wind_explosion_emitter', entity.location);
  } catch {
    // The launch works without it.
  }
}

// ---------- Registration ----------

system.beforeEvents.startup.subscribe((event) => {
  try {
    event.dimensionRegistry.registerCustomDimension(DIMENSION_ID);
  } catch (err) {
    // Already registered is fine (a script reload); anything else is reported by the load check.
    if (!(err instanceof Error && err.name === 'CustomDimensionAlreadyRegisteredError')) registerError = errorText(err);
  }

  const onPlayer = (entity: unknown, run: (player: Player) => void) => {
    const player = entity as Player | undefined;
    if (player?.typeId !== 'minecraft:player') return;
    system.run(() => {
      if (player.isValid) run(player);
    });
  };

  event.blockComponentRegistry.registerCustomComponent(PORTAL_BLOCK, {
    onStepOn: (e) => {
      const at = e.block.location;
      onPlayer(e.entity, (p) => onPortal(p, at));
    },
    onPlayerInteract: (e) => {
      const at = e.block.location;
      onPlayer(e.player, (p) => onPortal(p, at));
    },
  });
  event.blockComponentRegistry.registerCustomComponent(GUST_PAD, {
    onStepOn: (e) => {
      const entity = e.entity;
      if (!entity) return;
      system.run(() => {
        if (entity.isValid) launch(entity);
      });
    },
  });
  event.blockComponentRegistry.registerCustomComponent(STORM_ALTAR, {
    onPlayerInteract: (e) => onPlayer(e.player, useAltar),
  });
});

// The castle's altar and the island's own portal cannot be mined.
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.dimension.id !== DIMENSION_ID) return;
  const id = event.block.typeId;
  const at = event.block.location;
  const isHomePortal = id === PORTAL_BLOCK && at.x === HOME_PORTAL.x && at.y === HOME_PORTAL.y && at.z === HOME_PORTAL.z;
  if (!isHomePortal && id !== STORM_ALTAR) return;
  event.cancel = true;
  const player = event.player;
  system.run(() => {
    if (player.isValid) say(player, isHomePortal ? 'clouds.island_portal' : 'clouds.altar.unbreakable');
  });
});

// The safety net, the boss fight, and finishing any build a restart cut short.
system.runInterval(() => {
  const dimension = cloudDimension();
  if (!dimension) return;
  const players = dimension.getPlayers();
  for (const player of players) {
    if (player.location.y < FALL_LIMIT && !traveling.has(player.id)) goHome(player, true);
  }
}, 10);

system.runInterval(() => {
  const dimension = cloudDimension();
  if (!dimension || dimension.getPlayers().length === 0) return;
  tickBosses(dimension);
  if (sectionDone('start')) buildInBackground(dimension);
}, 20);

installBosses();
installStaff();
installFloatatoes();

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
  const blocks = [PORTAL_BLOCK, CLOUD_BLOCK, GUST_PAD, STORM_ALTAR].filter((id) => !BlockTypes.get(id));
  parts.push(blocks.length ? `blocks MISSING ${blocks.join(' ')}` : 'blocks ok');
  const entities = [FLOATATO, CHARGE, NIMBUS_KING].filter((id) => !EntityTypes.get(id));
  parts.push(entities.length ? `entities MISSING ${entities.join(' ')}` : 'entities ok');
  parts.push(progress());
  parts.push(buildNote);
  return parts.join(', ');
}

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const check = loadCheck();
  if (check.includes('MISSING')) say(event.player, 'clouds.broken', check);
});

function give(player: Player, id: string): void {
  player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(id, 1));
}

function teleportInClouds(player: Player, to: Vector3): void {
  const dimension = cloudDimension();
  if (!dimension) throw new Error('the dimension did not load');
  if (player.dimension.id !== DIMENSION_ID) saveReturnPoint(player, player.location);
  cool(player);
  player.teleport(to, { dimension });
}

async function debug(player: Player, command: string): Promise<void> {
  const [verb = '', arg = ''] = command.split(/\s+/);
  const dimension = cloudDimension();
  switch (verb) {
    case 'check':
      say(player, 'clouds.debug.check', loadCheck());
      return;
    case 'go':
      await goUp(player, player.location);
      return;
    case 'home':
      goHome(player, false);
      return;
    case 'castle':
      teleportInClouds(player, CASTLE_GATE);
      return;
    case 'arena':
      teleportInClouds(player, { x: ARENA.x + 0.5, y: ARENA.y, z: ARENA.z - 8.5 });
      return;
    case 'build':
      if (!dimension) throw new Error('the dimension did not load');
      say(player, 'clouds.building');
      await buildPending(dimension);
      say(player, 'clouds.debug.check', loadCheck());
      return;
    case 'rebuild': {
      if (!dimension) throw new Error('the dimension did not load');
      const key = arg || 'start';
      forget(key);
      await buildPending(dimension, key);
      say(player, 'clouds.debug.rebuilt', key);
      say(player, 'clouds.debug.check', loadCheck());
      return;
    }
    case 'boss':
      if (!dimension) throw new Error('the dimension did not load');
      summonKing(dimension);
      return;
    case 'floatato': {
      const f = player.dimension.spawnEntity(FLOATATO, player.location);
      if (arg === 'golden') f.triggerEvent('steveo:make_golden');
      say(player, 'clouds.debug.spawned', 'Floatato');
      return;
    }
    case 'floatatoes': {
      if (!dimension) throw new Error('the dimension did not load');
      const near = dimension.getEntities({ type: FLOATATO, location: CASE_CENTER, maxDistance: 4 }).length;
      say(player, 'clouds.debug.case', String(near));
      return;
    }
    case 'padpower': {
      const [, forward, up] = command.split(/\s+/).map(Number);
      if (forward !== undefined && up !== undefined && forward > 0 && up > 0) {
        world.setDynamicProperty(PAD_POWER, JSON.stringify({ forward, up }));
      }
      const power = padPower();
      say(player, 'clouds.debug.padpower', String(power.forward), String(power.up));
      return;
    }
    case 'portal':
      give(player, PORTAL_BLOCK);
      return;
    case 'pad':
      give(player, GUST_PAD);
      return;
    case 'crystal':
      give(player, STORM_CRYSTAL);
      return;
    case 'staff':
      give(player, CLOUD_STAFF);
      return;
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
