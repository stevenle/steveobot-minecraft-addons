/**
 * Portal Gun — fire a blue and an orange portal; walk into one, come out the other.
 *
 * Using the gun raycasts along the player's view and places a portal on the
 * block face it hits: a 1×2 portal on walls, a 1×1 portal on floors and
 * ceilings. Each player owns one blue and one orange portal; firing a color
 * again moves that portal.
 *
 * The gun is two item variants, one per color, with matching icons so the
 * item in hand shows which portal it will fire. Attacking (swinging the gun,
 * even at air) swaps the held item for the other variant. The gun never
 * breaks blocks, so the attack button is safe to use as a toggle.
 *
 * A portal is a `steveo:portal` marker entity that the resource pack renders
 * as a glowing oval, oriented by `mark_variant` and colored by `variant`.
 *
 * Every tick the script looks for entities inside a linked pair's portals and
 * teleports them to the other end, facing out of it, with their speed
 * redirected along the exit normal ("speedy thing goes in, speedy thing comes
 * out"). An entity that has just come out of a portal is ignored by that
 * portal until it has stepped clear, so nothing ping-pongs.
 *
 * Portal entities persist in the world. Each one carries a JSON dynamic
 * property describing its owner, color, and placement; on load the script
 * adopts it back into its registry. The entity also has a 30-second fuse that
 * the script refreshes every 5 seconds while it knows about the portal, so a
 * portal the script has lost track of despawns on its own instead of
 * littering the world forever.
 */
import {
  Direction,
  EntitySwingSource,
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type BlockRaycastHit,
  type Dimension,
  type Entity,
  type RawMessage,
  type TeleportOptions,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('portal-gun');
const PREFIX: RawMessage = { text: `${Format.gray}[Portal Gun]${Format.reset} ` };

/** One item variant per color; the icon and name tell the player what is loaded. */
const GUN_IDS: Record<Color, string> = {
  blue: 'steveo:portal_gun',
  orange: 'steveo:portal_gun_orange',
};
const PORTAL_ID = 'steveo:portal';
/** Dynamic property on each portal entity holding its serialized PortalData. */
const PORTAL_PROP = 'steveo:portal';
/** Cooldown category from the item's `minecraft:cooldown` component. */
const COOLDOWN_CATEGORY = 'steveo_portal_gun';
const COOLDOWN_TICKS = 5;

/** How far the gun reaches, in blocks. */
const MAX_RANGE = 64;
/** Portal entity fuse (seconds) in entities/portal.json, and how often to reset it. */
const FUSE_SECONDS = 30;
const REFRESH_INTERVAL_TICKS = 100;
/** How often to check who is holding the gun, for the one-time hint. */
const HOLD_CHECK_TICKS = 10;
/** Ticks between color toggles, so one press cannot flip twice. */
const TOGGLE_COOLDOWN_TICKS = 4;
/** Ticks after a traversal before the same entity may traverse again. */
const TRAVERSE_COOLDOWN_TICKS = 5;
/** Cap on exit speed, in blocks per tick (terminal velocity is about 3.9). */
const MAX_EXIT_SPEED = 3;
/** How far the portal plane floats off its surface, to avoid z-fighting. */
const PLANE_OFFSET = 0.04;
/** Tracer particles: one per block along the shot, capped. */
const TRACER_STEP = 1;
const TRACER_MAX = 48;
/** Non-solid blocks a portal may be placed over, beyond air and liquids. */
const PASSABLE_BLOCKS = new Set([
  'minecraft:short_grass',
  'minecraft:tall_grass',
  'minecraft:fern',
  'minecraft:large_fern',
  'minecraft:snow_layer',
  'minecraft:torch',
  'minecraft:seagrass',
]);

type Color = 'blue' | 'orange';
type Kind = 'wall' | 'floor' | 'ceiling';

/** What is persisted on the portal entity. */
interface PortalData {
  owner: string;
  ownerName: string;
  color: Color;
  kind: Kind;
  /** The air cell the portal occupies (for walls, the lower of the two). */
  base: Vector3;
  /** Unit vector pointing out of the portal into open space. */
  normal: Vector3;
  dimension: string;
  createdAt: number;
}

interface Portal extends PortalData {
  entityId: string;
}

type Pair = Partial<Record<Color, Portal>>;

/** Every portal the script knows about, keyed by owner player id. */
const portals = new Map<string, Pair>();

/** The portal an entity most recently came out of, so it is not sucked straight back in. */
const lastExit = new Map<string, { portal: string; tick: number }>();

/** Players who have seen the hold hint this session. */
const hinted = new Set<string>();

/** Last tick each player fired, to fold duplicate use events into one shot. */
const lastShot = new Map<string, number>();

/** Last tick each player toggled colors. */
const lastToggle = new Map<string, number>();

/** The color a gun item fires, or undefined if the item is not a gun. */
function colorOfGun(typeId: string | undefined): Color | undefined {
  if (typeId === GUN_IDS.blue) return 'blue';
  if (typeId === GUN_IDS.orange) return 'orange';
  return undefined;
}

// ---------- vectors ----------

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sameCell(a: Vector3, b: Vector3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function fmt(v: Vector3): string {
  return `${v.x}, ${v.y}, ${v.z}`;
}

const UP: Vector3 = { x: 0, y: 1, z: 0 };
const DOWN: Vector3 = { x: 0, y: -1, z: 0 };

function normalOf(face: Direction): Vector3 {
  switch (face) {
    case Direction.Up:
      return UP;
    case Direction.Down:
      return DOWN;
    case Direction.North:
      return { x: 0, y: 0, z: -1 };
    case Direction.South:
      return { x: 0, y: 0, z: 1 };
    case Direction.East:
      return { x: 1, y: 0, z: 0 };
    case Direction.West:
      return { x: -1, y: 0, z: 0 };
  }
}

/** Yaw (degrees, Bedrock convention: 0 = south, 90 = west) that looks along `v`. */
function yawOf(v: Vector3): number {
  return (Math.atan2(-v.x, v.z) * 180) / Math.PI;
}

// ---------- portal geometry ----------

/** Feet-level center of the portal's base cell. */
function centerOf(p: PortalData): Vector3 {
  return { x: p.base.x + 0.5, y: p.base.y, z: p.base.z + 0.5 };
}

/** Where the marker entity sits: on the surface, nudged out by PLANE_OFFSET. */
function entityLocation(p: PortalData): Vector3 {
  const c = centerOf(p);
  switch (p.kind) {
    case 'wall':
      return sub(c, scale(p.normal, 0.5 - PLANE_OFFSET));
    case 'floor':
      return { x: c.x, y: c.y + PLANE_OFFSET, z: c.z };
    case 'ceiling':
      return { x: c.x, y: c.y + 1 - PLANE_OFFSET, z: c.z };
  }
}

/** Where an entity lands when it comes out of this portal. */
function exitLocation(p: PortalData): Vector3 {
  const c = centerOf(p);
  switch (p.kind) {
    case 'wall':
      return add(c, scale(p.normal, 0.4));
    case 'floor':
      return { x: c.x, y: c.y + 0.1, z: c.z };
    case 'ceiling':
      // Feet a little below the cell so a player's head sits inside it.
      return { x: c.x, y: c.y - 0.9, z: c.z };
  }
}

/** Which orientation event the marker entity gets (see entities/portal.json). */
function orientationEvent(p: PortalData): string {
  switch (p.kind) {
    case 'wall':
      return p.normal.x !== 0 ? 'steveo:wall_x' : 'steveo:wall_z';
    case 'floor':
      return 'steveo:floor';
    case 'ceiling':
      return 'steveo:ceiling';
  }
}

/** The block cells a portal occupies. */
function cellsOf(p: PortalData): Vector3[] {
  return p.kind === 'wall' ? [p.base, add(p.base, UP)] : [p.base];
}

/** True if an entity at `loc` (feet position) is in the portal's mouth. */
function isInside(p: PortalData, entity: Entity): boolean {
  const loc = entity.location;
  const c = centerOf(p);
  if (p.kind === 'wall') {
    const rel = sub(loc, c);
    const fromPlane = dot(rel, p.normal) + 0.5;
    const lateral = Math.abs(rel.x * p.normal.z - rel.z * p.normal.x);
    return (
      fromPlane > -0.5 && fromPlane < 0.45 && lateral < 0.55 && rel.y > -0.3 && rel.y < 1.8
    );
  }
  if (Math.floor(loc.x) !== p.base.x || Math.floor(loc.z) !== p.base.z) return false;
  const dy = loc.y - p.base.y;
  if (p.kind === 'floor') {
    // Extend the window upward by the fall speed so a fast faller cannot skip it.
    const falling = Math.max(0, -entity.getVelocity().y);
    return dy >= -0.1 && dy < 1.5 + falling;
  }
  // Ceiling: the head has to reach the surface, so feet must be within ~0.85 of the cell.
  return dy >= -0.85 && dy < 1;
}

// ---------- registry ----------

function pairFor(owner: string): Pair {
  let pair = portals.get(owner);
  if (!pair) {
    pair = {};
    portals.set(owner, pair);
  }
  return pair;
}

function removeEntityById(id: string): void {
  try {
    const entity = world.getEntity(id);
    if (entity?.isValid) entity.remove();
  } catch {
    // Already gone or unloaded; the entity's own fuse covers it.
  }
}

/** Forgets and despawns one of a player's portals. Returns true if there was one. */
function removePortal(owner: string, color: Color): boolean {
  const pair = portals.get(owner);
  const portal = pair?.[color];
  if (!pair || !portal) return false;
  delete pair[color];
  removeEntityById(portal.entityId);
  return true;
}

/** Re-registers a portal entity found in the world (on load, or at startup). */
function adopt(entity: Entity): void {
  if (entity.typeId !== PORTAL_ID) return;
  let raw: unknown;
  try {
    raw = entity.getDynamicProperty(PORTAL_PROP);
  } catch {
    return;
  }
  // No data means a hand-summoned one; its fuse will burn it down.
  if (typeof raw !== 'string') return;

  let data: PortalData;
  try {
    data = JSON.parse(raw) as PortalData;
  } catch {
    return;
  }

  const pair = pairFor(data.owner);
  const existing = pair[data.color];
  if (existing) {
    if (existing.entityId === entity.id) return;
    // Two portals of one color: the older one was replaced while its chunk
    // was unloaded, so it could not be removed at the time. Remove it now.
    if (existing.createdAt >= data.createdAt) {
      removeEntityById(entity.id);
      return;
    }
    removeEntityById(existing.entityId);
  }
  pair[data.color] = { ...data, entityId: entity.id };
}

/** True if the planned portal would share a cell with any other portal. */
function overlaps(plan: PortalData, ignoreEntityId?: string): boolean {
  const cells = cellsOf(plan);
  for (const pair of portals.values()) {
    for (const other of [pair.blue, pair.orange]) {
      if (!other || other.entityId === ignoreEntityId) continue;
      if (other.dimension !== plan.dimension) continue;
      for (const cell of cellsOf(other)) {
        if (cells.some((c) => sameCell(c, cell))) return true;
      }
    }
  }
  return false;
}

// ---------- placement ----------

function isOpen(dimension: Dimension, pos: Vector3): boolean {
  try {
    const block = dimension.getBlock(pos);
    if (!block) return false;
    return block.isAir || block.isLiquid || PASSABLE_BLOCKS.has(block.typeId);
  } catch {
    return false; // outside world bounds or in an unloaded chunk
  }
}

/** Works out where a portal goes for a raycast hit, or undefined if it will not fit. */
function planPortal(
  hit: BlockRaycastHit,
): Pick<PortalData, 'kind' | 'base' | 'normal'> | undefined {
  const dimension = hit.block.dimension;
  const normal = normalOf(hit.face);
  const front = add(hit.block.location, normal);
  if (!isOpen(dimension, front)) return undefined;

  if (hit.face === Direction.Up) return { kind: 'floor', base: front, normal };
  if (hit.face === Direction.Down) return { kind: 'ceiling', base: front, normal };

  // Walls need two cells. If the one above is blocked, slide down a block so a
  // shot at the top of a short wall still lands.
  if (isOpen(dimension, add(front, UP))) return { kind: 'wall', base: front, normal };
  const below = add(front, DOWN);
  if (isOpen(dimension, below)) return { kind: 'wall', base: below, normal };
  return undefined;
}

function spawnPortal(dimension: Dimension, data: PortalData): Entity {
  const entity = dimension.spawnEntity(PORTAL_ID, entityLocation(data), {
    spawnEvent: `steveo:${data.color}`,
  });
  entity.triggerEvent(orientationEvent(data));
  entity.setRotation({ x: 0, y: 0 });
  entity.setDynamicProperty(PORTAL_PROP, JSON.stringify(data));
  return entity;
}

function actionBar(player: Player, key: string): void {
  try {
    player.onScreenDisplay.setActionBar({ translate: key });
  } catch {
    // Player left mid-tick.
  }
}

function fizzle(player: Player, key: string): void {
  actionBar(player, key);
  try {
    player.dimension.playSound('random.fizz', player.location, { volume: 0.5 });
  } catch {
    // Sound is decoration.
  }
}

function tracer(player: Player, hit: BlockRaycastHit, color: Color): void {
  const start = player.getHeadLocation();
  const end = add(hit.block.location, hit.faceLocation);
  const delta = sub(end, start);
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  const steps = Math.min(TRACER_MAX, Math.floor(distance / TRACER_STEP));
  const particle = color === 'blue' ? 'minecraft:blue_flame_particle' : 'minecraft:basic_flame_particle';
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    try {
      player.dimension.spawnParticle(particle, add(start, scale(delta, t)));
    } catch {
      return; // particle missing on this build; the shot still works
    }
  }
}

function fire(player: Player, color: Color): void {
  const hit = player.getBlockFromViewDirection({
    maxDistance: MAX_RANGE,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });
  if (!hit) {
    fizzle(player, 'portal_gun.miss');
    return;
  }

  const plan = planPortal(hit);
  if (!plan) {
    fizzle(player, 'portal_gun.blocked');
    return;
  }

  const dimension = hit.block.dimension;
  const data: PortalData = {
    ...plan,
    owner: player.id,
    ownerName: player.name,
    color,
    dimension: dimension.id,
    createdAt: Date.now(),
  };

  const pair = pairFor(player.id);
  if (overlaps(data, pair[color]?.entityId)) {
    fizzle(player, 'portal_gun.overlap');
    return;
  }

  removePortal(player.id, color);
  let entity: Entity;
  try {
    entity = spawnPortal(dimension, data);
  } catch (err) {
    log.error(`failed to spawn ${color} portal at ${fmt(data.base)}`, err);
    fizzle(player, 'portal_gun.blocked');
    return;
  }
  pair[color] = { ...data, entityId: entity.id };

  tracer(player, hit, color);
  try {
    player.dimension.playSound('mob.shulker.shoot', player.location, { volume: 0.6, pitch: color === 'blue' ? 1.2 : 0.9 });
  } catch {
    // Sound is decoration.
  }

  const other: Color = color === 'blue' ? 'orange' : 'blue';
  actionBar(player, pair[other] ? 'portal_gun.linked' : `portal_gun.placed.${color}`);
}

function handleUse(player: Player, color: Color): void {
  const tick = system.currentTick;
  if (lastShot.get(player.id) === tick) return; // itemUse + block interaction, same click
  lastShot.set(player.id, tick);

  fire(player, color);
  try {
    player.startItemCooldown(COOLDOWN_CATEGORY, COOLDOWN_TICKS);
  } catch {
    // Cooldown is only there to swallow double clicks.
  }
}

/** Swaps the held gun for the other color's variant, keeping any custom name or lore. */
function toggleColor(player: Player, held: ItemStack, from: Color): void {
  const tick = system.currentTick;
  const last = lastToggle.get(player.id);
  if (last !== undefined && tick - last < TOGGLE_COOLDOWN_TICKS) return;
  lastToggle.set(player.id, tick);

  const to: Color = from === 'blue' ? 'orange' : 'blue';
  const next = new ItemStack(GUN_IDS[to], 1);
  if (held.nameTag !== undefined) next.nameTag = held.nameTag;
  next.setLore(held.getLore());
  next.keepOnDeath = held.keepOnDeath;
  next.lockMode = held.lockMode;

  const equippable = player.getComponent('minecraft:equippable');
  try {
    equippable?.setEquipment(EquipmentSlot.Mainhand, next);
  } catch (err) {
    log.error(`failed to switch ${player.name}'s gun to ${to}`, err);
    return;
  }

  actionBar(player, `portal_gun.selected.${to}`);
  try {
    player.dimension.playSound('random.click', player.location, { volume: 0.5, pitch: to === 'blue' ? 1.3 : 0.8 });
  } catch {
    // Sound is decoration.
  }
}

// ---------- traversal ----------

function traverse(entity: Entity, from: Portal, to: Portal, tick: number): void {
  let target: Dimension;
  let source: Dimension;
  try {
    target = world.getDimension(to.dimension);
    source = world.getDimension(from.dimension);
  } catch {
    return;
  }

  const velocity = entity.getVelocity();
  const speed = Math.min(Math.hypot(velocity.x, velocity.y, velocity.z), MAX_EXIT_SPEED);
  const rotation = entity.getRotation();
  const options: TeleportOptions = {
    dimension: target,
    keepVelocity: false,
    rotation: to.kind === 'wall' ? { x: rotation.x, y: yawOf(to.normal) } : rotation,
  };

  try {
    entity.teleport(exitLocation(to), options);
  } catch (err) {
    log.error(`teleport of ${entity.typeId} failed`, err);
    return;
  }
  lastExit.set(entity.id, { portal: to.entityId, tick });

  // Teleporting zeroes velocity; re-apply the entry speed along the exit normal
  // a tick later, once the move has settled.
  if (speed > 0.02) {
    const out = scale(to.normal, speed);
    system.run(() => {
      if (!entity.isValid) return;
      try {
        entity.applyKnockback({ x: out.x, z: out.z }, out.y);
      } catch {
        try {
          entity.applyImpulse(out);
        } catch {
          // Some entity types accept neither; they just come out standing still.
        }
      }
    });
  }

  try {
    source.playSound('mob.endermen.portal', centerOf(from), { volume: 0.7 });
    target.playSound('mob.endermen.portal', centerOf(to), { volume: 0.7 });
  } catch {
    // Sound is decoration.
  }
}

function checkPortal(from: Portal, to: Portal, tick: number): void {
  let nearby: Entity[];
  try {
    nearby = world.getDimension(from.dimension).getEntities({
      location: centerOf(from),
      maxDistance: 3,
      excludeTypes: [PORTAL_ID],
    });
  } catch {
    return;
  }

  for (const entity of nearby) {
    const inside = isInside(from, entity);
    const recent = lastExit.get(entity.id);
    if (recent?.portal === from.entityId) {
      // Just came out of this portal: ignore it until it has stepped clear.
      if (!inside) lastExit.delete(entity.id);
      continue;
    }
    if (!inside) continue;
    if (recent && tick - recent.tick < TRAVERSE_COOLDOWN_TICKS) continue;
    traverse(entity, from, to, tick);
  }
}

system.runInterval(() => {
  const tick = system.currentTick;
  for (const pair of portals.values()) {
    const { blue, orange } = pair;
    if (!blue || !orange) continue;
    // Both ends must be loaded, or the far side has nowhere to put you.
    if (!world.getEntity(blue.entityId) || !world.getEntity(orange.entityId)) continue;
    checkPortal(blue, orange, tick);
    checkPortal(orange, blue, tick);
  }
}, 1);

// Keep known portals alive; anything we lost track of burns down its fuse.
system.runInterval(() => {
  for (const pair of portals.values()) {
    for (const portal of [pair.blue, pair.orange]) {
      if (!portal) continue;
      try {
        const entity = world.getEntity(portal.entityId);
        if (entity?.isValid) entity.triggerEvent('steveo:refresh');
      } catch (err) {
        log.warn(`refresh failed for ${portal.color} portal of ${portal.ownerName}: ${String(err)}`);
      }
    }
  }
  const stale = system.currentTick - FUSE_SECONDS * 20;
  for (const [id, exit] of lastExit) if (exit.tick < stale) lastExit.delete(id);
}, REFRESH_INTERVAL_TICKS);

// One-time hint when a player first holds the gun.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (hinted.has(player.id)) continue;
    const held = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Mainhand);
    if (!colorOfGun(held?.typeId)) continue;
    hinted.add(player.id);
    player.sendMessage({ rawtext: [PREFIX, { translate: 'portal_gun.hint' }] });
  }
}, HOLD_CHECK_TICKS);

// ---------- events ----------

world.afterEvents.itemUse.subscribe((event) => {
  const color = colorOfGun(event.itemStack.typeId);
  if (color) handleUse(event.source, color);
});

// Using the gun on a block fires this instead of (or as well as) itemUse.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent) return;
  const color = colorOfGun(event.itemStack?.typeId);
  if (color) handleUse(event.player, color);
});

// Attacking with the gun (a swing, even at nothing) switches colors.
world.afterEvents.playerSwingStart.subscribe(
  (event) => {
    const held = event.heldItemStack;
    const color = colorOfGun(held?.typeId);
    if (held && color) toggleColor(event.player, held, color);
  },
  { swingSource: EntitySwingSource.Attack },
);

// The gun is not a pickaxe: attacking a block with it must not break the block.
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (colorOfGun(event.itemStack?.typeId)) event.cancel = true;
});

world.afterEvents.entityLoad.subscribe((event) => adopt(event.entity));

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
  lastShot.delete(event.playerId);
  lastToggle.delete(event.playerId);
});

// Adopt portals that are already loaded when the script starts.
system.run(() => {
  for (const id of ['overworld', 'nether', 'the_end']) {
    try {
      for (const entity of world.getDimension(id).getEntities({ type: PORTAL_ID })) adopt(entity);
    } catch (err) {
      log.warn(`startup sweep of ${id} failed: ${String(err)}`);
    }
  }
});

// ---------- debug: /scriptevent steveo:portal <give|clear|status|demo> ----------

function statusMessage(player: Player): RawMessage {
  const pair = portals.get(player.id);
  const list = [pair?.blue, pair?.orange].filter((p): p is Portal => p !== undefined);
  const rawtext: RawMessage[] = [PREFIX, { translate: 'portal_gun.debug.status' }];
  if (list.length === 0) {
    rawtext.push({ translate: 'portal_gun.debug.status.none' });
  }
  for (const portal of list) {
    const loaded = world.getEntity(portal.entityId) !== undefined;
    rawtext.push({
      translate: 'portal_gun.debug.status.one',
      with: [portal.color, portal.kind, fmt(portal.base), portal.dimension, loaded ? '' : ', unloaded'],
    });
  }
  return { rawtext };
}

function spawnDemo(player: Player): void {
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  const fx = view.x / flat;
  const fz = view.z / flat;
  // A wall portal facing the player: its plane is perpendicular to the view.
  const orientation = Math.abs(fx) > Math.abs(fz) ? 'steveo:wall_x' : 'steveo:wall_z';
  const colors: Color[] = ['blue', 'orange'];
  for (const [i, color] of colors.entries()) {
    const spread = (i - 0.5) * 2.5;
    try {
      const entity = player.dimension.spawnEntity(
        PORTAL_ID,
        {
          x: player.location.x + fx * 4 - fz * spread,
          y: player.location.y,
          z: player.location.z + fz * 4 + fx * spread,
        },
        { spawnEvent: `steveo:${color}` },
      );
      entity.triggerEvent(orientation);
      entity.setRotation({ x: 0, y: 0 });
    } catch (err) {
      log.error(`demo ${color} portal failed`, err);
    }
  }
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'portal') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    const say = (message: RawMessage) => player.sendMessage(message);
    switch (event.message.trim()) {
      case 'give': {
        player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(GUN_IDS.blue, 1));
        say({ rawtext: [PREFIX, { translate: 'portal_gun.debug.given' }] });
        break;
      }
      case 'clear': {
        const removed = [removePortal(player.id, 'blue'), removePortal(player.id, 'orange')].filter(Boolean).length;
        say({ rawtext: [PREFIX, { translate: 'portal_gun.debug.cleared', with: [`${removed}`] }] });
        break;
      }
      case 'status': {
        say(statusMessage(player));
        break;
      }
      case 'demo': {
        spawnDemo(player);
        say({ rawtext: [PREFIX, { translate: 'portal_gun.debug.demo' }] });
        break;
      }
      default:
        say({ rawtext: [PREFIX, { translate: 'portal_gun.debug.help' }] });
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
