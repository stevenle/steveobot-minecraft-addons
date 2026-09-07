/**
 * Golden Snitch — release it in the Nether and it flies off to find the
 * nearest nether fortress, trailing fire behind it. Tap it to catch it again.
 *
 * Bedrock's Script API has no "locate structure" call and `/locate` output
 * cannot be read from a script, so the snitch finds fortresses the way a
 * player does: by seeing nether brick. Fortresses are the only natural source
 * of `minecraft:nether_brick`, so a chunk that contains one is a fortress
 * chunk. The scan walks chunk columns in rings around the owner and asks the
 * engine `containsBlock` for each — a native volume check, far cheaper than
 * a `getBlock` loop — then `getBlocks` on the hits to pick the nearest brick.
 * Only loaded chunks can be scanned, so the snitch's reach is the server's
 * loaded-chunk range around the owner. It keeps rescanning as the owner
 * explores, and darts off the moment a fortress comes into range.
 *
 * The snitch is a `steveo:snitch` marker entity moved by teleport every tick.
 * Its phases:
 *
 * - searching: orbits its owner, rescanning when they have moved or time
 *   has passed.
 * - leading: flies straight at the fortress. If the owner falls more than a
 *   leash length behind it turns around (returning) and comes back to them
 *   before setting off again.
 * - arrived: circles the fortress until someone catches it.
 * - waiting: hovers in place because its owner is offline.
 *
 * Every snitch carries a JSON dynamic property with its owner and target, so
 * one that was unloaded mid-flight is adopted back on load. It also has a
 * 60-second fuse the script refreshes while it knows about the snitch, so a
 * snitch the script has lost track of despawns rather than lingering forever.
 */
import {
  BlockVolume,
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('golden-snitch');
const PREFIX: RawMessage = { text: `${Format.gray}[Golden Snitch]${Format.reset} ` };

const SNITCH_ITEM = 'steveo:golden_snitch';
const SNITCH_ENTITY = 'steveo:snitch';
/** Dynamic property on each snitch entity holding its serialized SnitchData. */
const SNITCH_PROP = 'steveo:snitch';
const NETHER = 'minecraft:nether';
const NETHER_BRICK = 'minecraft:nether_brick';
const FLAME = 'minecraft:basic_flame_particle';

/** Scan this many chunks out from the owner in every direction (chunks beyond loaded range are skipped). */
const SCAN_RADIUS_CHUNKS = 20;
/** Fortresses generate between roughly y 30 and y 90; scan a little wider. */
const SCAN_MIN_Y = 20;
const SCAN_MAX_Y = 110;
/** Loaded chunk scans per job step; unloaded checks are near-free and get a bigger budget. */
const LOADED_PER_YIELD = 4;
const UNLOADED_PER_YIELD = 64;
/** Rescan while searching when this many ticks have passed or the owner has moved this far. */
const RESCAN_TICKS = 200;
const RESCAN_DISTANCE = 24;

/** Blocks per tick in each phase. */
const LEAD_SPEED = 0.55;
const RETURN_SPEED = 0.9;
const ORBIT_SPEED = 0.7;
/** How far the owner may fall behind before the snitch turns back for them. */
const LEASH = 24;
/** Once back within this distance of the owner, the snitch sets off again. */
const REJOIN = 5;
/** Distance from the target at which the snitch counts as arrived. */
const ARRIVE_RADIUS = 2.5;
/** How high above the nether brick it aims. */
const HOVER_ABOVE = 1.5;
const ORBIT_RADIUS = 2.2;
const ORBIT_HEIGHT = 1.6;

/** The entity fuse (60 s in behavior_pack/entities/snitch.json) is refreshed this often. */
const REFRESH_INTERVAL_TICKS = 100;
const HOLD_CHECK_TICKS = 10;
const DEMO_TICKS = 600;

type Phase = 'searching' | 'leading' | 'returning' | 'arrived' | 'waiting';

/** What is persisted on the entity. */
interface SnitchData {
  ownerId: string;
  ownerName: string;
  target?: Vector3;
}

interface Snitch extends SnitchData {
  entityId: string;
  dimensionId: string;
  phase: Phase;
  /** Orbit angle, in radians, advanced every tick while circling. */
  angle: number;
  scanning: boolean;
  lastScanTick: number;
  lastScanOrigin?: Vector3;
  /** Whether the owner has been told the result of a scan since release. */
  reported: boolean;
  /** Demo snitches (from the debug command) never scan and remove themselves. */
  demoUntil?: number;
}

interface ScanResult {
  nearest?: Vector3;
  distance: number;
  loaded: number;
  unloaded: number;
  /** Farthest loaded ring, in blocks, so the player knows how far the snitch could see. */
  reach: number;
}

/** Every snitch the script knows about, keyed by entity id. */
const snitches = new Map<string, Snitch>();
/** Players who have seen the hold hint this session. */
const hinted = new Set<string>();
/** Last tick each player released a snitch, to fold duplicate use events into one release. */
const lastUse = new Map<string, number>();

// ---------- helpers ----------

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function length(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function distance(a: Vector3, b: Vector3): number {
  return length(sub(a, b));
}

function fmt(v: Vector3): string {
  return `${Math.floor(v.x)} ${Math.floor(v.y)} ${Math.floor(v.z)}`;
}

/** A point `radius` out from `center` at `angle`, bobbing a little with the angle. */
function orbitPoint(center: Vector3, angle: number, radius: number, height: number): Vector3 {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + height + Math.sin(angle * 2) * 0.3,
    z: center.z + Math.sin(angle) * radius,
  };
}

/** The point `speed` blocks along the way from `from` to `to`, or `to` if it is closer than that. */
function stepToward(from: Vector3, to: Vector3, speed: number): Vector3 {
  const delta = sub(to, from);
  const d = length(delta);
  if (d <= speed) return to;
  return add(from, scale(delta, speed / d));
}

function playerById(id: string): Player | undefined {
  return world.getAllPlayers().find((p) => p.id === id);
}

function tell(player: Player, key: string, withArgs?: string[]): void {
  const message: RawMessage = withArgs ? { translate: key, with: withArgs } : { translate: key };
  player.sendMessage({ rawtext: [PREFIX, message] });
}

function actionBar(player: Player, key: string): void {
  try {
    player.onScreenDisplay.setActionBar({ rawtext: [PREFIX, { translate: key }] });
  } catch {
    // The player may be mid-disconnect.
  }
}

function particle(dimension: Dimension, id: string, location: Vector3): void {
  try {
    dimension.spawnParticle(id, location);
  } catch {
    // Particles are decoration; an unloaded chunk should not break the flight.
  }
}

function sound(dimension: Dimension, id: string, location: Vector3, pitch = 1, volume = 1): void {
  try {
    dimension.playSound(id, location, { pitch, volume });
  } catch {
    // Sound is decoration.
  }
}

function burst(dimension: Dimension, location: Vector3, count: number): void {
  for (let i = 0; i < count; i++) {
    particle(dimension, FLAME, {
      x: location.x + (Math.random() - 0.5) * 1.2,
      y: location.y + (Math.random() - 0.5) * 1.2,
      z: location.z + (Math.random() - 0.5) * 1.2,
    });
  }
}

function persist(entity: Entity, data: SnitchData): void {
  try {
    entity.setDynamicProperty(SNITCH_PROP, JSON.stringify(data));
  } catch (err) {
    log.warn(`could not persist snitch ${entity.id}: ${String(err)}`);
  }
}

// ---------- fortress scan ----------

/**
 * Walks chunk columns in square rings around `origin`, looking for nether
 * brick. Stops once a ring can no longer hold anything closer than the best
 * hit so far. Runs as a `system.runJob` generator and reports via `onDone`.
 */
function* fortressScan(dimension: Dimension, origin: Vector3, onDone: (result: ScanResult) => void): Generator<void> {
  const cx = Math.floor(origin.x / 16);
  const cz = Math.floor(origin.z / 16);
  const filter = { includeTypes: [NETHER_BRICK] };
  let loaded = 0;
  let unloaded = 0;
  let reach = 0;
  let best: Vector3 | undefined;
  let bestDistance = Infinity;
  let budget = 0;

  for (let ring = 0; ring <= SCAN_RADIUS_CHUNKS; ring++) {
    // A chunk in this ring starts at least (ring - 1) * 16 blocks from the origin.
    if (best && (ring - 1) * 16 > bestDistance) break;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const from = { x: (cx + dx) * 16, y: SCAN_MIN_Y, z: (cz + dz) * 16 };
        const to = { x: from.x + 15, y: SCAN_MAX_Y, z: from.z + 15 };
        let hit = false;
        try {
          if (dimension.getBlock(from) === undefined) {
            unloaded++;
            budget += 1;
          } else {
            loaded++;
            reach = Math.max(reach, ring * 16);
            budget += UNLOADED_PER_YIELD / LOADED_PER_YIELD;
            hit = dimension.containsBlock(new BlockVolume(from, to), filter, true);
          }
        } catch {
          unloaded++;
          budget += 1;
        }
        if (hit) {
          try {
            const bricks = dimension.getBlocks(new BlockVolume(from, to), filter, true);
            for (const loc of bricks.getBlockLocationIterator()) {
              const d = distance(loc, origin);
              if (d < bestDistance) {
                bestDistance = d;
                best = loc;
              }
            }
          } catch (err) {
            log.warn(`getBlocks failed at chunk ${cx + dx},${cz + dz}: ${String(err)}`);
          }
        }
        if (budget >= UNLOADED_PER_YIELD) {
          budget = 0;
          yield;
        }
      }
    }
  }

  const result: ScanResult = { distance: bestDistance, loaded, unloaded, reach };
  if (best) result.nearest = best;
  onDone(result);
}

function startScan(snitch: Snitch, origin: Vector3): void {
  let dimension: Dimension;
  try {
    dimension = world.getDimension(snitch.dimensionId);
  } catch {
    return;
  }
  snitch.scanning = true;
  snitch.lastScanTick = system.currentTick;
  snitch.lastScanOrigin = origin;
  system.runJob(
    fortressScan(dimension, origin, (result) => {
      snitch.scanning = false;
      if (!snitches.has(snitch.entityId)) return; // caught mid-scan
      const owner = playerById(snitch.ownerId);
      if (result.nearest) {
        snitch.target = add(result.nearest, { x: 0.5, y: HOVER_ABOVE, z: 0.5 });
        if (snitch.phase === 'searching') snitch.phase = 'leading';
        const entity = world.getEntity(snitch.entityId);
        if (entity?.isValid) {
          persist(entity, { ownerId: snitch.ownerId, ownerName: snitch.ownerName, target: snitch.target });
          burst(entity.dimension, entity.location, 12);
          sound(entity.dimension, 'random.levelup', entity.location, 1.4, 0.6);
        }
        snitch.reported = true;
        if (owner) tell(owner, 'golden_snitch.found', [`${Math.round(result.distance)}`]);
        log.info(`snitch ${snitch.entityId} found nether brick at ${fmt(result.nearest)} (${Math.round(result.distance)} blocks)`);
      } else if (!snitch.reported) {
        snitch.reported = true;
        if (owner) tell(owner, 'golden_snitch.searching', [`${result.reach}`]);
      }
    }),
  );
}

// ---------- lifecycle ----------

function register(entity: Entity, data: SnitchData, phase: Phase): Snitch {
  const snitch: Snitch = {
    ...data,
    entityId: entity.id,
    dimensionId: entity.dimension.id,
    phase,
    angle: Math.random() * Math.PI * 2,
    scanning: false,
    lastScanTick: 0,
    reported: false,
  };
  snitches.set(entity.id, snitch);
  return snitch;
}

function adopt(entity: Entity): void {
  if (entity.typeId !== SNITCH_ENTITY || snitches.has(entity.id)) return;
  let raw: unknown;
  try {
    raw = entity.getDynamicProperty(SNITCH_PROP);
  } catch {
    return;
  }
  if (typeof raw !== 'string') return; // a demo or /summon snitch; its fuse deals with it
  try {
    const data = JSON.parse(raw) as SnitchData;
    const snitch = register(entity, data, data.target ? 'leading' : 'searching');
    snitch.reported = true; // do not re-announce a scan to a returning player
    log.info(`adopted snitch ${entity.id} of ${data.ownerName} in ${entity.dimension.id}`);
  } catch (err) {
    log.warn(`could not adopt snitch ${entity.id}: ${String(err)}`);
  }
}

function spawnSnitch(player: Player, data: SnitchData | undefined): Entity | undefined {
  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  const location = add(head, add(scale(view, 1.2), { x: 0, y: 0.4, z: 0 }));
  try {
    const entity = player.dimension.spawnEntity(SNITCH_ENTITY, location);
    if (data) persist(entity, data);
    burst(player.dimension, location, 8);
    sound(player.dimension, 'mob.bat.takeoff', location, 1.6, 0.8);
    return entity;
  } catch (err) {
    log.error('could not spawn snitch', err);
    return undefined;
  }
}

/** Takes one snitch from the player's main hand. Returns false if they were not holding one. */
function consumeHeld(player: Player): boolean {
  const equippable = player.getComponent('minecraft:equippable');
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (!equippable || held?.typeId !== SNITCH_ITEM) return false;
  if (held.amount > 1) {
    const rest = held.clone();
    rest.amount = held.amount - 1;
    equippable.setEquipment(EquipmentSlot.Mainhand, rest);
  } else {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
  }
  return true;
}

function release(player: Player): void {
  const tick = system.currentTick;
  if (lastUse.get(player.id) === tick) return; // itemUse + block interaction, same click
  lastUse.set(player.id, tick);

  if (player.dimension.id !== NETHER) {
    actionBar(player, 'golden_snitch.not_nether');
    return;
  }
  if (!consumeHeld(player)) return;

  const data: SnitchData = { ownerId: player.id, ownerName: player.name };
  const entity = spawnSnitch(player, data);
  if (!entity) {
    // Give it back rather than eat it.
    player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(SNITCH_ITEM, 1));
    return;
  }
  const snitch = register(entity, data, 'searching');
  tell(player, 'golden_snitch.released');
  startScan(snitch, player.location);
}

/** Removes a snitch from the world. Returns whether an entity was actually removed. */
function removeSnitch(snitch: Snitch): boolean {
  snitches.delete(snitch.entityId);
  try {
    const entity = world.getEntity(snitch.entityId);
    if (!entity?.isValid) return false;
    burst(entity.dimension, entity.location, 6);
    entity.remove();
    return true;
  } catch {
    return false;
  }
}

function giveSnitch(player: Player): boolean {
  const container = player.getComponent('minecraft:inventory')?.container;
  const leftover = container?.addItem(new ItemStack(SNITCH_ITEM, 1));
  if (!container || leftover) {
    try {
      player.dimension.spawnItem(new ItemStack(SNITCH_ITEM, 1), player.location);
    } catch (err) {
      log.error('could not drop snitch item', err);
    }
    return false;
  }
  return true;
}

function catchSnitch(player: Player, entity: Entity): void {
  const snitch = snitches.get(entity.id);
  if (snitch) {
    if (snitch.demoUntil !== undefined) {
      removeSnitch(snitch);
      return;
    }
    removeSnitch(snitch);
  } else {
    // A snitch the script never registered (a /summon, or lost bookkeeping): still catchable.
    try {
      if (entity.isValid) entity.remove();
    } catch {
      return;
    }
  }
  sound(player.dimension, 'random.orb', player.location, 1.2, 0.8);
  tell(player, giveSnitch(player) ? 'golden_snitch.caught' : 'golden_snitch.caught.full');
}

// ---------- flight ----------

function move(entity: Entity, from: Vector3, to: Vector3): void {
  const delta = sub(to, from);
  const options = length(delta) > 0.01 ? { facingLocation: add(to, delta) } : {};
  try {
    entity.teleport(to, options);
  } catch (err) {
    log.warn(`teleport failed for snitch ${entity.id}: ${String(err)}`);
  }
}

function tickSnitch(snitch: Snitch, tick: number): void {
  let entity: Entity | undefined;
  try {
    entity = world.getEntity(snitch.entityId);
  } catch {
    return;
  }
  if (!entity?.isValid) return; // unloaded; keep the record for when it comes back

  if (snitch.demoUntil !== undefined && tick >= snitch.demoUntil) {
    removeSnitch(snitch);
    return;
  }

  const pos = entity.location;
  const owner = playerById(snitch.ownerId);
  const ownerHere = owner !== undefined && owner.dimension.id === snitch.dimensionId;
  snitch.angle += snitch.phase === 'arrived' ? 0.08 : 0.12;

  // Phase transitions.
  if (!ownerHere && snitch.phase !== 'arrived' && snitch.demoUntil === undefined) {
    snitch.phase = 'waiting';
  } else if (snitch.phase === 'waiting' && ownerHere) {
    snitch.phase = snitch.target ? 'leading' : 'searching';
  }

  let next: Vector3 = pos;
  switch (snitch.phase) {
    case 'searching': {
      if (!owner) break;
      next = stepToward(pos, orbitPoint(owner.location, snitch.angle, ORBIT_RADIUS, ORBIT_HEIGHT), ORBIT_SPEED);
      if (snitch.demoUntil === undefined && !snitch.scanning) {
        const moved = snitch.lastScanOrigin ? distance(owner.location, snitch.lastScanOrigin) : Infinity;
        if (tick - snitch.lastScanTick >= RESCAN_TICKS || moved >= RESCAN_DISTANCE) startScan(snitch, owner.location);
      }
      break;
    }
    case 'leading': {
      if (!owner || !snitch.target) break;
      if (distance(pos, owner.location) > LEASH) {
        snitch.phase = 'returning';
        actionBar(owner, 'golden_snitch.waiting');
        break;
      }
      next = stepToward(pos, snitch.target, LEAD_SPEED);
      if (distance(next, snitch.target) <= ARRIVE_RADIUS) {
        snitch.phase = 'arrived';
        burst(entity.dimension, next, 16);
        sound(entity.dimension, 'random.levelup', next, 1.0, 0.8);
        tell(owner, 'golden_snitch.arrived');
      }
      break;
    }
    case 'returning': {
      if (!owner) break;
      const home = add(owner.getHeadLocation(), { x: 0, y: 0.8, z: 0 });
      next = stepToward(pos, home, RETURN_SPEED);
      if (distance(next, owner.location) <= REJOIN) snitch.phase = 'leading';
      break;
    }
    case 'arrived': {
      if (!snitch.target) break;
      next = stepToward(pos, orbitPoint(snitch.target, snitch.angle, ORBIT_RADIUS + 0.3, 0.6), ORBIT_SPEED);
      break;
    }
    case 'waiting': {
      next = { x: pos.x, y: pos.y + Math.sin(snitch.angle) * 0.02, z: pos.z };
      break;
    }
  }

  move(entity, pos, next);

  // The fire trail: dense while flying somewhere, a flicker while hovering.
  const flying = snitch.phase === 'leading' || snitch.phase === 'returning';
  if (flying || tick % 3 === 0) {
    particle(entity.dimension, FLAME, {
      x: pos.x + (Math.random() - 0.5) * 0.3,
      y: pos.y + 0.2 + (Math.random() - 0.5) * 0.3,
      z: pos.z + (Math.random() - 0.5) * 0.3,
    });
  }
}

system.runInterval(() => {
  const tick = system.currentTick;
  for (const snitch of snitches.values()) {
    try {
      tickSnitch(snitch, tick);
    } catch (err) {
      log.error(`tick failed for snitch ${snitch.entityId}`, err);
    }
  }
}, 1);

// Keep known snitches alive; anything we lost track of burns down its fuse.
system.runInterval(() => {
  for (const snitch of snitches.values()) {
    try {
      const entity = world.getEntity(snitch.entityId);
      if (entity?.isValid) entity.triggerEvent('steveo:refresh');
    } catch (err) {
      log.warn(`refresh failed for snitch of ${snitch.ownerName}: ${String(err)}`);
    }
  }
}, REFRESH_INTERVAL_TICKS);

// One-time hint when a player first holds the snitch.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (hinted.has(player.id)) continue;
    const held = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== SNITCH_ITEM) continue;
    hinted.add(player.id);
    tell(player, 'golden_snitch.hint');
  }
}, HOLD_CHECK_TICKS);

// ---------- events ----------

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId !== SNITCH_ITEM) return;
  release(event.source);
});

// Using the snitch on a block fires this instead of (or as well as) itemUse.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.itemStack?.typeId !== SNITCH_ITEM || !event.isFirstEvent) return;
  release(event.player);
});

world.afterEvents.playerInteractWithEntity.subscribe((event) => {
  if (event.target.typeId !== SNITCH_ENTITY) return;
  catchSnitch(event.player, event.target);
});

world.afterEvents.entityHitEntity.subscribe((event) => {
  if (event.hitEntity.typeId !== SNITCH_ENTITY || !(event.damagingEntity instanceof Player)) return;
  catchSnitch(event.damagingEntity, event.hitEntity);
});

world.afterEvents.entityLoad.subscribe((event) => adopt(event.entity));

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
  lastUse.delete(event.playerId);
  for (const snitch of snitches.values()) {
    if (snitch.ownerId !== event.playerId || snitch.phase === 'arrived') continue;
    snitch.phase = 'waiting';
  }
});

// Adopt snitches that are already loaded when the script starts.
system.run(() => {
  for (const id of ['overworld', 'nether', 'the_end']) {
    try {
      for (const entity of world.getDimension(id).getEntities({ type: SNITCH_ENTITY })) adopt(entity);
    } catch (err) {
      log.warn(`startup sweep of ${id} failed: ${String(err)}`);
    }
  }
});

// ---------- debug: /scriptevent steveo:snitch <give|status|scan|recall|demo> ----------

function statusMessage(player: Player): RawMessage {
  const mine = [...snitches.values()].filter((s) => s.ownerId === player.id);
  const rawtext: RawMessage[] = [PREFIX, { translate: 'golden_snitch.debug.status' }];
  if (mine.length === 0) rawtext.push({ translate: 'golden_snitch.debug.status.none' });
  for (const snitch of mine) {
    let where = '?';
    let extra = '';
    try {
      const entity = world.getEntity(snitch.entityId);
      if (entity?.isValid) {
        where = fmt(entity.location);
        if (snitch.target) extra = `, target ${fmt(snitch.target)} ${Math.round(distance(entity.location, snitch.target))} away`;
      } else {
        extra = ', unloaded';
      }
    } catch {
      extra = ', unloaded';
    }
    rawtext.push({ translate: 'golden_snitch.debug.status.one', with: [snitch.phase, where, extra] });
  }
  return { rawtext };
}

function debugScan(player: Player): void {
  const origin = player.location;
  system.runJob(
    fortressScan(player.dimension, origin, (result) => {
      tell(player, 'golden_snitch.debug.scan', [fmt(origin), `${result.loaded}`, `${result.unloaded}`, `${result.reach}`]);
      if (result.nearest) tell(player, 'golden_snitch.debug.scan.hit', [fmt(result.nearest), `${Math.round(result.distance)}`]);
      else tell(player, 'golden_snitch.debug.scan.miss');
    }),
  );
}

function recall(player: Player): number {
  let count = 0;
  for (const snitch of [...snitches.values()]) {
    if (snitch.ownerId !== player.id) continue;
    if (!removeSnitch(snitch)) continue;
    count++;
    if (snitch.demoUntil === undefined) giveSnitch(player);
  }
  return count;
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'snitch') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    switch (event.message.trim()) {
      case 'give': {
        player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(SNITCH_ITEM, 1));
        tell(player, 'golden_snitch.debug.given');
        break;
      }
      case 'status': {
        player.sendMessage(statusMessage(player));
        break;
      }
      case 'scan': {
        debugScan(player);
        break;
      }
      case 'recall': {
        tell(player, 'golden_snitch.debug.recalled', [`${recall(player)}`]);
        break;
      }
      case 'demo': {
        const entity = spawnSnitch(player, undefined);
        if (!entity) break;
        const snitch = register(entity, { ownerId: player.id, ownerName: player.name }, 'searching');
        snitch.demoUntil = system.currentTick + DEMO_TICKS;
        tell(player, 'golden_snitch.debug.demo');
        break;
      }
      default:
        tell(player, 'golden_snitch.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
