/**
 * Rabbit Boy Power-Ups — items that give you a super power while you hold
 * one in your main hand or off-hand.
 *
 * Passive powers are plain status effects, re-applied every few ticks to
 * whoever is holding the item, so they fade about a second after the item is
 * put away. Use powers (right-click/tap with the item in the main hand) are
 * scripted below. The Super Power Up counts as holding every other item.
 *
 * Bolts (Fire Pepper, Fire Triangle, Water Diamond) are not entities: the
 * script walks a point along the aim line a couple of blocks per tick, draws
 * particles, and raycasts each step. That avoids the script-launched projectile problems in
 * CLAUDE.md and leaves nothing behind in the world if the script stops.
 */
import {
  EntityDamageCause,
  EquipmentSlot,
  ItemStack,
  MolangVariableMap,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  type Vector3,
} from '@minecraft/server';

import { installFollowLight } from '@shared/light';
import { createLogger } from '@shared/log';
import { onItemUse } from '@shared/use';

const log = createLogger('power-ups');

const CARROT = 'steveo:super_carrot';
const BOOTS = 'steveo:bounce_boots_charm';
const PEPPER = 'steveo:fire_pepper';
const SHELL = 'steveo:bubble_shell';
const FIST = 'steveo:rock_fist';
const FEATHER = 'steveo:feather_cape_token';
const RADISH = 'steveo:ghost_radish';
const SUPER = 'steveo:super_power_up';
const WATER = 'steveo:water_diamond';
const LIGHT = 'steveo:light_square';
const FIRE = 'steveo:fire_triangle';
const ALL_ITEMS = [CARROT, BOOTS, PEPPER, SHELL, FIST, FEATHER, RADISH, SUPER, WATER, LIGHT, FIRE] as const;
const ITEM_SET: ReadonlySet<string> = new Set(ALL_ITEMS);

/** Status effects each item grants while held: [effect id, amplifier]. */
const PASSIVE: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  [CARROT]: [['speed', 2], ['jump_boost', 2]],
  [PEPPER]: [['fire_resistance', 0]],
  [SHELL]: [['water_breathing', 0]],
  [FIST]: [['strength', 0], ['resistance', 0]],
  [FEATHER]: [['slow_falling', 0]],
  [RADISH]: [['invisibility', 0]],
  [WATER]: [['water_breathing', 0]],
  [FIRE]: [['fire_resistance', 0]],
};
/**
 * What the Super Power Up stands in for. Slow falling and invisibility are
 * left out: floating down spoils the big jumps, and an invisible hero cannot
 * be seen glowing.
 */
const SUPER_GRANTS: readonly string[] = [CARROT, BOOTS, PEPPER, SHELL, FIST];

const TICK_INTERVAL = 5;
/** Long enough to bridge two ticks of the loop, short enough to fade quickly. */
const EFFECT_TICKS = 25;
const SWIM_INTERVAL = 4;
const SWIM_SPEED = 0.45;

/** Cooldown per use power, in ticks. Matches `minecraft:cooldown` in each item file. */
const COOLDOWN: Readonly<Record<string, number>> = {
  [BOOTS]: 40,
  [PEPPER]: 15,
  [FIST]: 80,
  [FEATHER]: 40,
  [SUPER]: 400,
  [WATER]: 12,
  [FIRE]: 10,
};

const BOUNCE_UP = 1.5;
const DASH_FORWARD = 2.2;
const DASH_UP = 0.35;
const BOLT_STEP = 2;
const BOLT_STEPS = 12;
const FIRE_DAMAGE = 6;
const BURN_SECONDS = 5;
const WATER_DAMAGE = 3;
const WATER_PUSH = 1.4;
/** How close a monster must come to a Light Square holder to catch fire, in blocks. */
const LIGHT_BURN_RADIUS = 4;
const LIGHT_BURN_INTERVAL = 10;
/** World dynamic property holding the JSON array of lights placed by Light Squares. */
const LIGHTS_PROP = 'steveo:power_ups_lights';
const FIRE_BLOCKS: ReadonlySet<string> = new Set(['minecraft:fire', 'minecraft:soul_fire']);

/** The powers each player has right now (item ids, with the Super Power Up expanded). */
const powers = new Map<string, Set<string>>();
/** `${playerId}:${itemId}` -> tick of the last use, to enforce cooldowns. */
const lastUse = new Map<string, number>();
let boltsInFlight = 0;

function heldPowers(player: Player): Set<string> {
  const held = new Set<string>();
  const equippable = player.getComponent('minecraft:equippable');
  if (!equippable) return held;
  for (const slot of [EquipmentSlot.Mainhand, EquipmentSlot.Offhand]) {
    const id = equippable.getEquipment(slot)?.typeId;
    if (id === undefined || !ITEM_SET.has(id)) continue;
    held.add(id);
    if (id === SUPER) for (const granted of SUPER_GRANTS) held.add(granted);
  }
  return held;
}

function has(player: Player, item: string): boolean {
  return powers.get(player.id)?.has(item) ?? false;
}

function tick(): void {
  for (const player of world.getPlayers()) {
    try {
      const held = heldPowers(player);
      if (held.size === 0) {
        powers.delete(player.id);
        continue;
      }
      powers.set(player.id, held);
      for (const item of held) {
        for (const [effect, amplifier] of PASSIVE[item] ?? []) {
          player.addEffect(effect, EFFECT_TICKS, { amplifier, showParticles: false });
        }
      }
      if (held.has(SUPER) || held.has(LIGHT)) sparkle(player);
      if (held.has(WATER)) player.extinguishFire(true);
    } catch (error) {
      log.error(`update failed for ${player.name}`, error);
    }
  }
}

/** The glow of the Super Power Up and the Light Square: a drifting sparkle somewhere around the holder. */
function sparkle(player: Player): void {
  const at = player.location;
  particle(player.dimension, 'minecraft:endrod', {
    x: at.x + (Math.random() - 0.5) * 1.2,
    y: at.y + 0.3 + Math.random() * 1.6,
    z: at.z + (Math.random() - 0.5) * 1.2,
  });
}

/** The Bubble Shell's fast swimming: a steady push along the view while sprint-swimming. */
function swimTick(): void {
  for (const player of world.getPlayers()) {
    if (!has(player, SHELL)) continue;
    try {
      if (!player.isSwimming) continue;
      const view = player.getViewDirection();
      player.applyKnockback({ x: view.x * SWIM_SPEED, z: view.z * SWIM_SPEED }, view.y * SWIM_SPEED);
    } catch {
      // Left mid-tick.
    }
  }
}

function particle(dimension: Dimension, id: string, at: Vector3): void {
  try {
    dimension.spawnParticle(id, at);
  } catch {
    // Unloaded chunk or outside the world.
  }
}

/** Mobs that can be pushed and hurt: has health, is not a player. */
function isMob(entity: Entity): boolean {
  try {
    return entity.typeId !== 'minecraft:player' && entity.getComponent('minecraft:health') !== undefined;
  } catch {
    return false;
  }
}

function isMonster(entity: Entity): boolean {
  try {
    return entity.matches({ families: ['monster'] });
  } catch {
    return false;
  }
}

function pushAway(from: Vector3, target: Entity, strength: number, up: number): void {
  const dx = target.location.x - from.x;
  const dz = target.location.z - from.z;
  const flat = Math.hypot(dx, dz) || 1;
  try {
    target.applyKnockback({ x: (dx / flat) * strength, z: (dz / flat) * strength }, up);
  } catch {
    // Not something that can be knocked back.
  }
}

/** Throws every nearby mob outward. Only monsters take damage, so pets and villagers are safe. */
function shockwave(player: Player, radius: number, damage: number, strength: number): void {
  const center = player.location;
  for (const target of player.dimension.getEntities({ location: center, maxDistance: radius })) {
    if (!isMob(target)) continue;
    pushAway(center, target, strength, 0.6);
    if (!isMonster(target)) continue;
    try {
      target.applyDamage(damage, { cause: EntityDamageCause.entityAttack, damagingEntity: player });
    } catch {
      // Died or despawned from the push.
    }
  }
}

function bounce(player: Player): void {
  player.applyKnockback({ x: 0, z: 0 }, BOUNCE_UP);
  player.playSound('mob.slime.small', { pitch: 0.8 });
}

function dash(player: Player): void {
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  player.applyKnockback({ x: (view.x / flat) * DASH_FORWARD, z: (view.z / flat) * DASH_FORWARD }, DASH_UP);
  player.playSound('wind_charge.burst', { pitch: 1.5, volume: 0.6 });
}

function groundPound(player: Player): void {
  shockwave(player, 5, 6, 1.8);
  particle(player.dimension, 'minecraft:knockback_roar_particle', player.location);
  player.playSound('random.anvil_land', { pitch: 0.6, volume: 0.7 });
}

function superBlast(player: Player): void {
  shockwave(player, 8, 12, 3);
  const at = player.location;
  particle(player.dimension, 'minecraft:large_explosion', { x: at.x, y: at.y + 1, z: at.z });
  particle(player.dimension, 'minecraft:knockback_roar_particle', at);
  player.playSound('random.levelup', { pitch: 0.7 });
}

interface BoltSpec {
  sound: string;
  /** Draws one point of the trail. */
  trail: (dimension: Dimension, at: Vector3) => void;
  /** Called at the end of every step, with the bolt's new position. */
  onStep?: (dimension: Dimension, at: Vector3) => void;
  onHit: (shooter: Player, target: Entity, from: Vector3) => void;
  impactParticle: string;
}

function shootBolt(player: Player, spec: BoltSpec): void {
  const dimension = player.dimension;
  const dir = player.getViewDirection();
  const head = player.getHeadLocation();
  let pos: Vector3 = { x: head.x + dir.x * 0.8, y: head.y + dir.y * 0.8 - 0.1, z: head.z + dir.z * 0.8 };
  let steps = 0;
  player.playSound(spec.sound, { volume: 0.6 });
  boltsInFlight++;

  const handle = system.runInterval(() => {
    let done = ++steps >= BOLT_STEPS;
    try {
      // How far this step can go before a wall stops it.
      let reach = BOLT_STEP;
      const wall = dimension.getBlockFromRay(pos, dir, { maxDistance: BOLT_STEP });
      if (wall) {
        const at = wall.block.location;
        const face = wall.faceLocation;
        reach = Math.min(BOLT_STEP, Math.hypot(at.x + face.x - pos.x, at.y + face.y - pos.y, at.z + face.z - pos.z));
        done = true;
      }
      const victim = dimension
        .getEntitiesFromRay(pos, dir, { maxDistance: reach })
        .find((hit) => hit.entity.id !== player.id && isMob(hit.entity));
      if (victim) {
        reach = Math.min(reach, victim.distance);
        done = true;
        if (player.isValid) spec.onHit(player, victim.entity, pos);
      }
      for (let d = 0; d <= reach; d += 0.5) {
        spec.trail(dimension, { x: pos.x + dir.x * d, y: pos.y + dir.y * d, z: pos.z + dir.z * d });
      }
      pos = { x: pos.x + dir.x * reach, y: pos.y + dir.y * reach, z: pos.z + dir.z * reach };
      spec.onStep?.(dimension, pos);
      if (wall || victim) particle(dimension, spec.impactParticle, pos);
    } catch {
      // Flew into an unloaded chunk, or the target vanished.
      done = true;
    }
    if (done) {
      system.clearRun(handle);
      boltsInFlight--;
    }
  }, 1);
}

const FIRE_BOLT: BoltSpec = {
  sound: 'mob.blaze.shoot',
  trail: (dimension, at) => particle(dimension, 'minecraft:basic_flame_particle', at),
  onHit: (shooter, target) => {
    target.applyDamage(FIRE_DAMAGE, { cause: EntityDamageCause.fire, damagingEntity: shooter });
    target.setOnFire(BURN_SECONDS, true);
  },
  impactParticle: 'minecraft:lava_particle',
};

const WATER_BLUE = new MolangVariableMap();
WATER_BLUE.setColorRGB('variable.color', { red: 0.25, green: 0.6, blue: 1 });

/** Puts out fire blocks in the 3×3×3 around `at`. */
function douse(dimension: Dimension, at: Vector3): void {
  const base = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    try {
      const block = dimension.getBlock({ x: base.x + dx, y: base.y + dy, z: base.z + dz });
      if (block && FIRE_BLOCKS.has(block.typeId)) block.setType('minecraft:air');
    } catch {
      // Unloaded chunk or outside the world.
    }
  }
}

const WATER_BOLT: BoltSpec = {
  sound: 'random.splash',
  trail: (dimension, at) => {
    particle(dimension, 'minecraft:water_splash_particle_manual', at);
    // A tinted trail as well, so the jet is easy to see in the air.
    try {
      dimension.spawnParticle('minecraft:colored_flame_particle', at, WATER_BLUE);
    } catch {
      // Unloaded chunk or outside the world.
    }
  },
  onStep: douse,
  onHit: (shooter, target, from) => {
    target.extinguishFire(true);
    pushAway(from, target, WATER_PUSH, 0.3);
    target.applyDamage(WATER_DAMAGE, { cause: EntityDamageCause.entityAttack, damagingEntity: shooter });
  },
  impactParticle: 'minecraft:water_splash_particle_manual',
};

/** Light Square: monsters that come close to a holder catch fire. */
function lightBurnTick(): void {
  for (const player of world.getPlayers()) {
    if (!has(player, LIGHT)) continue;
    try {
      const nearby = player.dimension.getEntities({
        location: player.location,
        maxDistance: LIGHT_BURN_RADIUS,
        families: ['monster'],
      });
      for (const mob of nearby) mob.setOnFire(BURN_SECONDS, true);
    } catch {
      // Left mid-tick.
    }
  }
}

const USE_POWERS: Readonly<Record<string, (player: Player) => void>> = {
  [BOOTS]: bounce,
  [PEPPER]: (player) => shootBolt(player, FIRE_BOLT),
  [FIST]: groundPound,
  [FEATHER]: dash,
  [SUPER]: superBlast,
  [WATER]: (player) => shootBolt(player, WATER_BOLT),
  [FIRE]: (player) => shootBolt(player, FIRE_BOLT),
};

function reportError(player: Player, error: unknown): void {
  log.error(`power failed for ${player.name}`, error);
  player.sendMessage({ translate: 'power_ups.debug.error', with: [String(error)] });
}

onItemUse(
  (typeId) => typeId in USE_POWERS,
  (player, item) => {
    const power = USE_POWERS[item.typeId];
    const cooldown = COOLDOWN[item.typeId];
    if (!power || cooldown === undefined) return;
    const key = `${player.id}:${item.typeId}`;
    const now = system.currentTick;
    const last = lastUse.get(key);
    if (last !== undefined && now - last < cooldown) return;
    lastUse.set(key, now);
    try {
      player.startItemCooldown(item.typeId.replace('steveo:', 'steveo_'), cooldown);
    } catch {
      // The item component shows the sweep on its own; the check above is what enforces it.
    }
    try {
      power(player);
    } catch (error) {
      reportError(player, error);
    }
  },
);

// Light Square: a light follows the holder around.
const lights = installFollowLight({ property: LIGHTS_PROP, shouldLight: (player) => has(player, LIGHT), log });

// Bounce Boots Charm: no fall damage while held.
world.beforeEvents.entityHurt.subscribe((event) => {
  if (event.damageSource.cause !== EntityDamageCause.fall) return;
  const hurt = event.hurtEntity;
  if (hurt.typeId !== 'minecraft:player') return;
  if (powers.get(hurt.id)?.has(BOOTS)) event.cancel = true;
});

// Rock Fist: hits send the target flying.
world.afterEvents.entityHitEntity.subscribe((event) => {
  const attacker = event.damagingEntity;
  if (!(attacker instanceof Player) || !has(attacker, FIST)) return;
  if (!isMob(event.hitEntity)) return;
  pushAway(attacker.location, event.hitEntity, 1.6, 0.45);
});

world.afterEvents.playerLeave.subscribe((event) => {
  powers.delete(event.playerId);
  for (const key of lastUse.keys()) if (key.startsWith(`${event.playerId}:`)) lastUse.delete(key);
});

world.afterEvents.worldLoad.subscribe(() => {
  system.runInterval(tick, TICK_INTERVAL);
  system.runInterval(swimTick, SWIM_INTERVAL);
  system.runInterval(lightBurnTick, LIGHT_BURN_INTERVAL);
});

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:power_ups') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    system.run(() => {
      try {
        const container = player.getComponent('inventory')?.container;
        for (const id of ALL_ITEMS) container?.addItem(new ItemStack(id));
        player.sendMessage({
          translate: 'power_ups.debug.status',
          with: [String(powers.size), String(boltsInFlight), String(lights.lit), String(lights.stale)],
        });
      } catch (error) {
        reportError(player, error);
      }
    });
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
