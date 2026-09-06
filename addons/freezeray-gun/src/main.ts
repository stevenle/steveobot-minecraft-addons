/**
 * Freeze Ray Gun — a ray gun that freezes the first mob it hits for a random
 * 8 to 20 seconds, so the player can walk away or finish it off in peace.
 *
 * The gun is hitscan: using it raycasts along the player's view and freezes
 * the first living thing in the way, out to 32 blocks. Players are never
 * frozen; the ray stops at them and the shooter is told so. A frost beam is
 * drawn along the ray with particles either way, so a miss still looks like a
 * shot.
 *
 * "Frozen" is built from three layers, because no single one is enough:
 *
 * 1. Slowness and Weakness at maximum amplifier, for the freeze duration.
 *    Slowness 255 zeroes movement speed and Weakness 255 zeroes melee damage.
 *    Being real status effects, they expire on their own even if the script
 *    is reloaded mid-freeze, so nothing is left permanently stuck.
 * 2. Every tick, the mob is teleported back to where it was frozen, facing
 *    the way it was facing. This is what stops it turning to track the
 *    player, sliding from knockback, or drifting off its spot. It also holds
 *    a mob frozen mid-jump in the air, which is a feature.
 * 3. Frost particles around the mob, so everyone can see it is frozen.
 *
 * Frozen mobs still take damage, and a frozen mob is thawed the moment it
 * dies or is removed. Re-freezing a mob rolls a fresh duration and keeps
 * whichever is longer. Ranged mobs (skeletons, blazes) can still shoot and a
 * creeper standing next to you can still swell, so the freeze buys distance
 * rather than immunity; the README says so.
 *
 * The cooldown is 1.5 s, declared on the item (so the hotbar shows the sweep)
 * and enforced again here, since a block interaction can fire the use event
 * on its own path.
 */
import {
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Container,
  type Dimension,
  type Entity,
  type RawMessage,
  type Vector2,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('freezeray-gun');
const PREFIX: RawMessage = { text: `${Format.gray}[Freeze Ray]${Format.reset} ` };

const GUN_ID = 'steveo:freezeray_gun';
/** Cooldown category from the item's `minecraft:cooldown` component; 1.5 s there too. */
const COOLDOWN_CATEGORY = 'steveo_freezeray_gun';
const COOLDOWN_TICKS = 30;

/** How far the ray reaches, in blocks. */
const MAX_RANGE = 32;
/** Freeze duration is rolled uniformly in this range (8 to 20 seconds). */
const MIN_FREEZE_TICKS = 160;
const MAX_FREEZE_TICKS = 400;
/** Status effects outlive the lock a little so the script's thaw is what ends the freeze, not the effect. */
const EFFECT_GRACE_TICKS = 20;
const MAX_AMPLIFIER = 255;
/** How far in front of the eyes the beam starts, so it does not spawn inside the player's face. */
const MUZZLE_OFFSET = 0.6;
/** Beam particles: one every this many blocks along the ray. */
const BEAM_STEP = 0.75;
/** How often the frost aura is refreshed on a frozen mob, and the countdown redrawn. */
const AURA_INTERVAL_TICKS = 5;
/** How often to check who is holding the gun, for the one-time hint. */
const HOLD_CHECK_TICKS = 10;
/** Reach of the `demo` debug command, which freezes the nearest mob without a gun. */
const DEMO_RANGE = 8;

const BEAM_PARTICLE = 'steveo:freeze_beam';
const BURST_PARTICLE = 'steveo:frost_burst';
const AURA_PARTICLE = 'steveo:frost_aura';

interface Frozen {
  entityId: string;
  typeId: string;
  /** Where and which way the mob was facing when frozen; it is held here every tick. */
  location: Vector3;
  rotation: Vector2;
  /** Tick at which the freeze ends. */
  until: number;
  /** Whoever fired; they get the countdown in their action bar. */
  shooterId: string;
}

/** Everything currently frozen, keyed by entity id. */
const frozen = new Map<string, Frozen>();

/** Players who have seen the hold hint this session. */
const hinted = new Set<string>();

/** Last tick each player fired, for the cooldown and to fold duplicate use events into one shot. */
const lastShot = new Map<string, number>();

// ---------- helpers ----------

function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function distanceBetween(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent('minecraft:inventory')?.container;
}

function actionBar(player: Player, message: RawMessage): void {
  try {
    player.onScreenDisplay.setActionBar(message);
  } catch {
    // The player may be mid-disconnect.
  }
}

/** Translation key for a mob's name: `entity.zombie.name` for vanilla, `entity.steveo:x.name` for custom. */
function mobName(typeId: string): RawMessage {
  const short = typeId.startsWith('minecraft:') ? typeId.slice('minecraft:'.length) : typeId;
  return { translate: `entity.${short}.name` };
}

function seconds(ticks: number): string {
  return (Math.max(0, ticks) / 20).toFixed(1);
}

/** A living, non-player thing the ray can freeze. Items, arrows, and orbs have no health. */
function isFreezable(entity: Entity): boolean {
  try {
    return !(entity instanceof Player) && entity.getComponent('minecraft:health') !== undefined;
  } catch {
    return false;
  }
}

function particle(dimension: Dimension, id: string, location: Vector3): void {
  try {
    dimension.spawnParticle(id, location);
  } catch {
    // Particles are decoration; an unloaded chunk should not break the shot.
  }
}

function sound(dimension: Dimension, id: string, location: Vector3, pitch: number, volume = 1): void {
  try {
    dimension.playSound(id, location, { pitch, volume });
  } catch {
    // Sound is decoration.
  }
}

/** Center of a mob's body, for particles; the entity location is at its feet. */
function centerOf(entity: Entity): Vector3 {
  const feet = entity.location;
  const head = entity.getHeadLocation();
  return { x: feet.x, y: (feet.y + head.y) / 2, z: feet.z };
}

// ---------- freezing ----------

function rollFreezeTicks(): number {
  return MIN_FREEZE_TICKS + Math.floor(Math.random() * (MAX_FREEZE_TICKS - MIN_FREEZE_TICKS + 1));
}

function applyEffects(entity: Entity, ticks: number): void {
  const duration = ticks + EFFECT_GRACE_TICKS;
  entity.addEffect('slowness', duration, { amplifier: MAX_AMPLIFIER, showParticles: false });
  entity.addEffect('weakness', duration, { amplifier: MAX_AMPLIFIER, showParticles: false });
}

/**
 * Freezes `target` for a random duration. Returns the ticks it will stay
 * frozen from now, and whether it was already frozen (in which case the
 * longer of the two durations wins).
 */
function freeze(target: Entity, shooter: Entity): { ticks: number; refrozen: boolean } {
  const now = system.currentTick;
  const rolled = rollFreezeTicks();
  const existing = frozen.get(target.id);
  const remaining = existing ? existing.until - now : 0;
  const ticks = Math.max(rolled, remaining);

  applyEffects(target, ticks);
  target.clearVelocity();

  if (existing) {
    existing.until = now + ticks;
    existing.shooterId = shooter.id;
  } else {
    frozen.set(target.id, {
      entityId: target.id,
      typeId: target.typeId,
      location: target.location,
      rotation: target.getRotation(),
      until: now + ticks,
      shooterId: shooter.id,
    });
  }

  const center = centerOf(target);
  particle(target.dimension, BURST_PARTICLE, center);
  sound(target.dimension, 'mob.player.hurt_freeze', center, 1.0);
  sound(target.dimension, 'random.glass', center, 1.4, 0.5);
  return { ticks, refrozen: existing !== undefined };
}

/** Releases a mob. The entity may already be gone; everything here tolerates that. */
function thaw(record: Frozen, entity: Entity | undefined): void {
  frozen.delete(record.entityId);
  if (!entity) return;
  try {
    if (!entity.isValid) return;
    entity.removeEffect('slowness');
    entity.removeEffect('weakness');
    const center = centerOf(entity);
    particle(entity.dimension, BURST_PARTICLE, center);
    sound(entity.dimension, 'random.glass', center, 0.8, 0.7);
  } catch (err) {
    log.warn(`thawing ${record.typeId} failed: ${String(err)}`);
  }
}

function thawAll(): number {
  const count = frozen.size;
  for (const record of [...frozen.values()]) thaw(record, world.getEntity(record.entityId));
  return count;
}

// Hold every frozen mob on its spot, thaw the ones whose time is up, and
// keep the frost and the shooters' countdowns going.
system.runInterval(() => {
  const now = system.currentTick;
  const drawAura = now % AURA_INTERVAL_TICKS === 0;
  /** Per shooter, the freeze ending last, for the countdown. */
  const latest = new Map<string, Frozen>();

  for (const record of [...frozen.values()]) {
    const entity = world.getEntity(record.entityId);
    if (!entity || !entity.isValid) {
      frozen.delete(record.entityId);
      continue;
    }
    if (now >= record.until) {
      thaw(record, entity);
      continue;
    }
    try {
      entity.teleport(record.location, { rotation: record.rotation });
    } catch {
      // Chunk unloaded under it; the effects still hold it until it is back.
    }
    if (drawAura) {
      particle(entity.dimension, AURA_PARTICLE, centerOf(entity));
      const current = latest.get(record.shooterId);
      if (!current || record.until > current.until) latest.set(record.shooterId, record);
    }
  }

  if (!drawAura) return;
  for (const [shooterId, record] of latest) {
    const shooter = world.getEntity(shooterId);
    if (!(shooter instanceof Player)) continue;
    actionBar(shooter, {
      rawtext: [
        { text: Format.aqua },
        {
          translate: 'freezeray_gun.countdown',
          with: { rawtext: [mobName(record.typeId), { text: seconds(record.until - now) }] },
        },
      ],
    });
  }
}, 1);

// ---------- firing ----------

/** Draws the frost beam from the muzzle to `end`. */
function drawBeam(dimension: Dimension, origin: Vector3, view: Vector3, length: number): void {
  const steps = Math.min(Math.floor(length / BEAM_STEP), Math.floor(MAX_RANGE / BEAM_STEP));
  for (let i = 0; i <= steps; i++) particle(dimension, BEAM_PARTICLE, add(origin, scale(view, i * BEAM_STEP)));
}

function fire(player: Player): void {
  const view = player.getViewDirection();
  const origin = add(player.getHeadLocation(), scale(view, MUZZLE_OFFSET));
  sound(player.dimension, 'random.fizz', origin, 1.6, 0.6);
  sound(player.dimension, 'mob.evocation_illager.cast_spell', origin, 1.8, 0.4);

  // The first thing with a hitbox on the ray decides the outcome: a player
  // ends the ray with no effect, a mob gets frozen, and anything without
  // health (an arrow, a dropped item) is looked past.
  let target: Entity | undefined;
  let blockedByPlayer = false;
  let hitDistance = MAX_RANGE;
  for (const hit of player.getEntitiesFromViewDirection({ maxDistance: MAX_RANGE })) {
    if (hit.entity.id === player.id) continue;
    if (hit.entity instanceof Player) {
      blockedByPlayer = true;
      hitDistance = hit.distance;
      break;
    }
    if (!isFreezable(hit.entity)) continue;
    target = hit.entity;
    hitDistance = hit.distance;
    break;
  }

  if (!target && !blockedByPlayer) {
    const block = player.getBlockFromViewDirection({ maxDistance: MAX_RANGE });
    if (block) {
      const point = add(block.block.location, block.faceLocation);
      hitDistance = Math.min(MAX_RANGE, distanceBetween(origin, point));
    }
  }
  drawBeam(player.dimension, origin, view, Math.max(0, hitDistance - MUZZLE_OFFSET));

  if (blockedByPlayer) {
    actionBar(player, { rawtext: [{ text: Format.red }, { translate: 'freezeray_gun.player' }] });
    return;
  }
  if (!target) {
    actionBar(player, { rawtext: [{ text: Format.gray }, { translate: 'freezeray_gun.miss' }] });
    return;
  }

  let result: { ticks: number; refrozen: boolean };
  try {
    result = freeze(target, player);
  } catch (err) {
    log.error(`freezing ${target.typeId} for ${player.name} failed`, err);
    return;
  }
  actionBar(player, {
    rawtext: [
      { text: Format.aqua },
      {
        translate: result.refrozen ? 'freezeray_gun.refrozen' : 'freezeray_gun.frozen',
        with: { rawtext: [mobName(target.typeId), { text: seconds(result.ticks) }] },
      },
    ],
  });
}

function handleUse(player: Player): void {
  const now = system.currentTick;
  const last = lastShot.get(player.id);
  if (last !== undefined && now - last < COOLDOWN_TICKS) return;
  lastShot.set(player.id, now);
  try {
    player.startItemCooldown(COOLDOWN_CATEGORY, COOLDOWN_TICKS);
  } catch {
    // The item component shows the sweep on its own; the script's check above is what enforces it.
  }
  fire(player);
}

// ---------- events ----------

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId === GUN_ID) handleUse(event.source);
});

// Using the gun on a block fires this instead of (or as well as) itemUse.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.itemStack || !event.isFirstEvent) return;
  if (event.itemStack.typeId === GUN_ID) handleUse(event.player);
});

world.afterEvents.entityDie.subscribe((event) => {
  const record = frozen.get(event.deadEntity.id);
  if (record) thaw(record, undefined);
});

world.afterEvents.entityRemove.subscribe((event) => {
  frozen.delete(event.removedEntityId);
});

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
  lastShot.delete(event.playerId);
});

// A one-time hint the first time a player holds the gun.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (hinted.has(player.id)) continue;
    const held = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== GUN_ID) continue;
    hinted.add(player.id);
    player.sendMessage({ rawtext: [PREFIX, { translate: 'freezeray_gun.hint' }] });
  }
}, HOLD_CHECK_TICKS);

// ---------- debug: /scriptevent steveo:freeze <give|status|thaw|demo> ----------

function nearestFreezable(player: Player): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const entity of player.dimension.getEntities({ location: player.location, maxDistance: DEMO_RANGE })) {
    if (!isFreezable(entity)) continue;
    const d = distanceBetween(entity.location, player.location);
    if (d < bestDistance) {
      best = entity;
      bestDistance = d;
    }
  }
  return best;
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'freeze') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    const say = (message: RawMessage) => player.sendMessage({ rawtext: [PREFIX, message] });
    switch (event.message.trim()) {
      case 'give': {
        inventoryOf(player)?.addItem(new ItemStack(GUN_ID, 1));
        say({ translate: 'freezeray_gun.debug.given' });
        break;
      }
      case 'status': {
        const last = lastShot.get(player.id);
        const cooldownLeft = last === undefined ? 0 : Math.max(0, COOLDOWN_TICKS - (system.currentTick - last));
        say({
          translate: 'freezeray_gun.debug.status',
          with: [`${frozen.size}`, `${cooldownLeft}`],
        });
        break;
      }
      case 'thaw': {
        say({ translate: 'freezeray_gun.debug.thawed', with: [`${thawAll()}`] });
        break;
      }
      case 'demo': {
        const target = nearestFreezable(player);
        if (!target) {
          say({ translate: 'freezeray_gun.debug.demo.none' });
          break;
        }
        const result = freeze(target, player);
        say({
          translate: 'freezeray_gun.frozen',
          with: { rawtext: [mobName(target.typeId), { text: seconds(result.ticks) }] },
        });
        say({ translate: 'freezeray_gun.debug.demo' });
        break;
      }
      default:
        say({ translate: 'freezeray_gun.debug.help' });
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
