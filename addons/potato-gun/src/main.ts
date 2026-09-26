/**
 * Potato Gun — a crossbow and a rocket launcher that fire potatoes, plus
 * "Explosive" and "Poison" enchantments that change what the potatoes do on
 * impact.
 *
 * Both guns are custom items with unlimited ammo. Using one spawns a
 * `steveo:potato` entity at the player's eyes and flies it along the player's
 * view; nothing is consumed and nothing wears out. The crossbow potato is
 * quick and arcs like an arrow; the launcher potato is bigger, slower, flies
 * almost straight, and hits harder.
 *
 * Neither enchantment is a real enchantment — Bedrock has no custom
 * enchantments — so each is modelled the way players will experience it: an
 * enchantment item (a glinting book) that combines with a gun at a crafting
 * table into a variant of that gun. The variants glint and carry a lore line.
 * Explosive potatoes detonate on impact via `createExplosion`, credited to the
 * shooter; block damage follows the `mobGriefing` game rule, like a creeper.
 * Poison potatoes hurt and poison the mob they hit, and never harm players.
 *
 * The flight is simulated here, not by the engine. The potato entity has no
 * `minecraft:projectile` component; it is a visual that the script steers
 * every tick, and the script decides what it hit by raycasting along each
 * tick's step. That keeps the ballistics identical across game versions:
 * the engine's projectile physics changed underneath this add-on on 1.26.50
 * (`isolated_physics` stopped script-launched potatoes moving at all, and
 * the legacy path it was moved back to flew oddly). See `step()`.
 *
 * Potatoes have an 8-second fuse in entities/potato.json, and the sweep
 * removes any potato the script is not flying (after a script reload, say),
 * so none are left hanging in the air.
 */
import {
  EntityDamageCause,
  EquipmentSlot,
  GameMode,
  ItemStack,
  Player,
  system,
  world,
  type Block,
  type Container,
  type Dimension,
  type Entity,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';
import { onItemUse } from '@shared/use';

const log = createLogger('potato-gun');
const PREFIX: RawMessage = { text: `${Format.gray}[Potato Gun]${Format.reset} ` };

const POTATO_ENTITY = 'steveo:potato';
const POTATO_FAMILY = 'steveo_potato';
const SPLAT_PARTICLE = 'steveo:potato_splat';
const POISON_PARTICLE = 'steveo:poison_splash';

/** Flight is abandoned after this many ticks; the entity fuse is 8 s. */
const MAX_FLIGHT_TICKS = 160;
const SWEEP_INTERVAL_TICKS = 100;
/** How often to check what players are holding, for hints and lore. */
const HOLD_CHECK_TICKS = 10;
/** How far in front of the eyes the potato entity appears, so it is not drawn inside the camera. */
const MUZZLE_OFFSET = 0.5;
/** Half the potato's width; rays reach this far past each step so grazing hits count. */
const POTATO_RADIUS = 0.125;
/** Ticks during which a potato cannot hit its shooter, as with vanilla arrows. */
const OWNER_GRACE_TICKS = 5;
/** Velocity multiplier per tick while the potato is in water or lava. */
const LIQUID_DRAG = 0.6;
/** How strongly the entity is pulled back onto the simulated path each tick (0..1). */
const TRACK_GAIN = 0.5;

type Kind = 'crossbow' | 'launcher';
type Effect = 'plain' | 'explosive' | 'poison';

interface Ballistics {
  /** Muzzle speed in blocks per tick. */
  speed: number;
  /** Aim wobble, in vanilla `uncertainty` units; 0 is laser-straight. */
  spread: number;
  /** Downward acceleration in blocks per tick². An arrow is 0.05. */
  gravity: number;
  /** Velocity multiplier per tick in air. An arrow is 0.99. */
  drag: number;
  /** Impact damage (2 per heart). */
  damage: number;
  /** Explosion radius for explosive potatoes (TNT is 4, a creeper 3). */
  blastRadius: number;
  /** Poison applied by poison potatoes. Amplifier 0 is Poison I. */
  poison: { ticks: number; amplifier: number };
  sound: string;
  pitch: number;
}

const BALLISTICS: Readonly<Record<Kind, Ballistics>> = {
  crossbow: {
    speed: 2.4, spread: 1, gravity: 0.05, drag: 0.99, damage: 6, blastRadius: 1.8,
    poison: { ticks: 140, amplifier: 0 },
    sound: 'random.bow', pitch: 0.7,
  },
  launcher: {
    speed: 1.6, spread: 0, gravity: 0.012, drag: 0.995, damage: 12, blastRadius: 3,
    poison: { ticks: 140, amplifier: 1 },
    sound: 'firework.launch', pitch: 0.6,
  },
};

interface Gun {
  kind: Kind;
  effect: Effect;
  /** Entity event that dresses the potato for this gun. */
  spawnEvent: string;
}

/** Item id -> gun, for every kind × effect: `steveo:potato_crossbow_poison` etc. */
const GUNS: ReadonlyMap<string, Gun> = new Map(
  (['crossbow', 'launcher'] as const).flatMap((kind) =>
    (['plain', 'explosive', 'poison'] as const).map((effect): [string, Gun] => {
      const suffix = effect === 'plain' ? '' : `_${effect}`;
      return [`steveo:potato_${kind}${suffix}`, { kind, effect, spawnEvent: `steveo:${kind}${suffix}` }];
    }),
  ),
);

/** Enchantment items -> the hint shown the first time one is held. */
const ENCHANTMENTS: ReadonlyMap<string, string> = new Map([
  ['steveo:explosive_enchantment', 'potato_gun.hint.enchantment'],
  ['steveo:poison_enchantment', 'potato_gun.hint.poison_enchantment'],
]);

/** Gray, like a vanilla enchantment line under the item name. */
const LORE: Readonly<Record<Effect, string | undefined>> = {
  plain: undefined,
  explosive: `${Format.gray}Explosive`,
  poison: `${Format.gray}Poison`,
};

interface Shot {
  gun: Gun;
  shooterId: string;
  potato: Entity;
  dimension: Dimension;
  /** Where the potato is, per the simulation. The entity follows this. */
  pos: Vector3;
  /** Blocks per tick. */
  vel: Vector3;
  age: number;
  /** Tick of the last step, so a shot never steps twice in one tick. */
  steppedTick: number;
  /** Set when impulses do not move the entity; it is then teleported along the path instead. */
  teleport: boolean;
  lastActual: Vector3;
}

/** Potatoes in flight, keyed by entity id. */
const shots = new Map<string, Shot>();

/** Players who have seen each hold hint this session. */
const hinted = new Map<string, Set<string>>();

/** Last tick each player fired, to fold duplicate use events into one shot. */
const lastShot = new Map<string, number>();

// ---------- helpers ----------

function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vector3): Vector3 {
  const len = length(v);
  return len === 0 ? v : scale(v, 1 / len);
}

/** Standard normal sample (Box–Muller). */
function gaussian(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent('minecraft:inventory')?.container;
}

function removeQuietly(entity: Entity): void {
  try {
    if (entity.isValid) entity.remove();
  } catch {
    // Already gone.
  }
}

// ---------- firing ----------

/** Spawns a potato at the player's eyes and starts flying it along their view. */
function launch(player: Player, gun: Gun): Entity | undefined {
  const b = BALLISTICS[gun.kind];
  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  let potato: Entity;
  try {
    potato = player.dimension.spawnEntity(POTATO_ENTITY, add(head, scale(view, MUZZLE_OFFSET)), {
      spawnEvent: gun.spawnEvent,
    });
  } catch (err) {
    log.error(`spawning a potato for ${player.name} failed`, err);
    return undefined;
  }

  // Aim wobble the way vanilla does it, then inherit the shooter's motion so
  // shooting while running feels right. Vertical motion only counts in the
  // air: on the ground it is just gravity pressing the player into the floor.
  const wobble = 0.0075 * b.spread;
  const aim = normalize({
    x: view.x + gaussian() * wobble,
    y: view.y + gaussian() * wobble,
    z: view.z + gaussian() * wobble,
  });
  const moving = player.getVelocity();
  const vel = add(scale(aim, b.speed), { x: moving.x, y: player.isOnGround ? 0 : moving.y, z: moving.z });

  // The simulation starts at the eyes, not the muzzle, so a wall or a mob
  // closer than the muzzle is still hit rather than skipped.
  const shot: Shot = {
    gun, shooterId: player.id, potato, dimension: player.dimension,
    pos: head, vel, age: 0, steppedTick: -1, teleport: false, lastActual: potato.location,
  };
  shots.set(potato.id, shot);
  player.dimension.playSound(b.sound, head, { pitch: b.pitch });
  step(shot);
  return potato;
}

function handleUse(player: Player, gun: Gun): void {
  if (lastShot.get(player.id) === system.currentTick) return;
  lastShot.set(player.id, system.currentTick);
  launch(player, gun);
}

// ---------- flight ----------

function canHit(entity: Entity, shot: Shot): boolean {
  try {
    if (!entity.isValid) return false;
    if (entity.id === shot.shooterId && shot.age < OWNER_GRACE_TICKS) return false;
    if (entity instanceof Player) return entity.getGameMode() !== GameMode.Spectator;
    // Mobs have health; items, XP orbs, arrows, and other add-ons' markers do not.
    return entity.getComponent('minecraft:health') !== undefined;
  } catch {
    return false;
  }
}

type Impact = { at: Vector3; entity?: Entity; block?: Block };

/** The first thing the potato touches travelling `distance` along `dir` from `from`. */
function sweep(shot: Shot, from: Vector3, dir: Vector3, distance: number): Impact | undefined {
  const reach = distance + POTATO_RADIUS;
  let best: Impact | undefined;
  let bestDist = Infinity;

  const block = shot.dimension.getBlockFromRay(from, dir, {
    maxDistance: reach,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });
  if (block) {
    const at = add(block.block.location, block.faceLocation);
    bestDist = length(sub(at, from));
    best = { at, block: block.block };
  }

  const entities = shot.dimension.getEntitiesFromRay(from, dir, {
    maxDistance: reach,
    excludeFamilies: [POTATO_FAMILY],
  });
  for (const hit of entities) {
    if (hit.distance >= bestDist || !canHit(hit.entity, shot)) continue;
    bestDist = hit.distance;
    best = { at: add(from, scale(dir, hit.distance)), entity: hit.entity };
  }
  return best;
}

/**
 * Advances one potato by one tick: look ahead along this tick's step for
 * something to hit, otherwise move, then apply drag and gravity (in that
 * order, as vanilla arrows do).
 *
 * The entity is steered with impulses toward the simulated position rather
 * than teleported, because the client interpolates velocity-driven movement
 * but snaps on teleports. If impulses turn out not to move it at all, the
 * shot falls back to teleporting so the potato is at least visible.
 */
function step(shot: Shot): void {
  const tick = system.currentTick;
  if (shot.steppedTick === tick) return;
  shot.steppedTick = tick;

  const { potato } = shot;
  if (!potato.isValid || shot.age >= MAX_FLIGHT_TICKS) {
    finish(shot);
    return;
  }

  const b = BALLISTICS[shot.gun.kind];
  const distance = length(shot.vel);
  let inLiquid = false;
  try {
    inLiquid = shot.dimension.getBlock(shot.pos)?.isLiquid ?? false;
    if (distance > 0) {
      const impact = sweep(shot, shot.pos, scale(shot.vel, 1 / distance), distance);
      if (impact) {
        land(shot, impact);
        return;
      }
    }
  } catch {
    // The potato flew into an unloaded chunk or out of the world.
    finish(shot);
    return;
  }

  const next = add(shot.pos, shot.vel);
  try {
    const actual = potato.location;
    if (shot.age === 2 && length(sub(actual, shot.lastActual)) < 0.05) {
      // Two ticks of impulses and it has not budged: this engine build will not
      // move it that way, so fall back to placing it each tick.
      log.warn('potato entity ignores impulses; falling back to teleporting');
      shot.teleport = true;
    }
    if (shot.teleport) {
      potato.teleport(next);
    } else {
      potato.clearVelocity();
      potato.applyImpulse(add(shot.vel, scale(sub(shot.pos, actual), TRACK_GAIN)));
    }
  } catch (err) {
    log.warn(`moving a potato failed: ${String(err)}`);
    finish(shot);
    return;
  }

  shot.pos = next;
  const drag = inLiquid ? LIQUID_DRAG : b.drag;
  shot.vel = { x: shot.vel.x * drag, y: shot.vel.y * drag - b.gravity, z: shot.vel.z * drag };
  shot.age++;
}

/** Ends a flight without an impact. */
function finish(shot: Shot): void {
  shots.delete(shot.potato.id);
  removeQuietly(shot.potato);
}

// ---------- hits ----------

function splat(dimension: Dimension, location: Vector3, gun: Gun): void {
  try {
    dimension.spawnParticle(SPLAT_PARTICLE, location);
    if (gun.effect === 'poison') dimension.spawnParticle(POISON_PARTICLE, location);
    dimension.playSound('mob.slime.small', location, { pitch: gun.kind === 'launcher' ? 0.6 : 1.1 });
  } catch (err) {
    log.warn(`splat effect failed: ${String(err)}`);
  }
}

function explode(dimension: Dimension, location: Vector3, radius: number, shooter: Entity | undefined): void {
  try {
    dimension.createExplosion(location, radius, {
      breaksBlocks: world.gameRules.mobGriefing,
      causesFire: false,
      ...(shooter ? { source: shooter } : {}),
    });
  } catch (err) {
    log.warn(`explosion failed: ${String(err)}`);
  }
}

/** What a hit did, for `/scriptevent steveo:potato hits`. Values are lang keys. */
interface HitResult {
  damage: 'applied' | 'refused' | 'spared';
  poison: 'applied' | 'immune' | 'spared' | 'none';
}

function hurt(target: Entity, shot: Shot, shooter: Entity | undefined): HitResult {
  const b = BALLISTICS[shot.gun.kind];
  // Poison potatoes never harm players: no impact damage, no poison.
  if (shot.gun.effect === 'poison' && target instanceof Player) return { damage: 'spared', poison: 'spared' };

  let damaged = false;
  try {
    damaged = target.applyDamage(b.damage, {
      damagingProjectile: shot.potato,
      ...(shooter ? { damagingEntity: shooter } : {}),
    });
  } catch {
    // Fall back to a plain projectile hit if the potato entity is not accepted as the source.
    try {
      damaged = target.applyDamage(b.damage, {
        cause: EntityDamageCause.projectile,
        ...(shooter ? { damagingEntity: shooter } : {}),
      });
    } catch (err) {
      log.warn(`damaging ${target.typeId} failed: ${String(err)}`);
    }
  }

  let poison: HitResult['poison'] = 'none';
  if (shot.gun.effect === 'poison' && target.isValid) {
    try {
      target.addEffect('poison', b.poison.ticks, { amplifier: b.poison.amplifier, showParticles: true });
      // Undead mobs (zombies, skeletons, ...) are immune, as in vanilla: the call succeeds but nothing sticks.
      poison = target.getEffect('poison') ? 'applied' : 'immune';
    } catch (err) {
      log.warn(`poisoning ${target.typeId} failed: ${String(err)}`);
      poison = 'immune';
    }
  }
  return { damage: damaged ? 'applied' : 'refused', poison };
}

/** Players who asked for a chat report of every potato hit. */
const hitReports = new Set<string>();

function reportHit(shooter: Entity | undefined, shot: Shot, impact: Impact, result: HitResult | undefined): void {
  if (!(shooter instanceof Player) || !hitReports.has(shooter.id)) return;
  try {
    const gun: RawMessage = { translate: `potato_gun.debug.gun.${shot.gun.effect}` };
    const message: RawMessage = impact.entity && result
      ? {
        translate: 'potato_gun.debug.hit.entity',
        with: {
          rawtext: [
            gun,
            { translate: impact.entity.localizationKey },
            { translate: `potato_gun.debug.result.${result.damage}` },
            { translate: `potato_gun.debug.result.poison.${result.poison}` },
          ],
        },
      }
      : {
        translate: 'potato_gun.debug.hit.block',
        with: { rawtext: [gun, impact.block ? { translate: impact.block.localizationKey } : { text: '?' }] },
      };
    shooter.sendMessage({ rawtext: [PREFIX, message] });
  } catch {
    // The report is a debugging aid; never let it break a hit.
  }
}

function land(shot: Shot, impact: Impact): void {
  const shooter = world.getEntity(shot.shooterId);
  const result = impact.entity ? hurt(impact.entity, shot, shooter) : undefined;
  reportHit(shooter, shot, impact, result);
  // Remove after damage: the potato is the damage source, so it must still exist.
  finish(shot);
  splat(shot.dimension, impact.at, shot.gun);
  if (shot.gun.effect === 'explosive') {
    explode(shot.dimension, impact.at, BALLISTICS[shot.gun.kind].blastRadius, shooter);
  }
}

// ---------- events ----------

// Fires in the air or at a block, but not when the click opens a chest, a bed, a door...
onItemUse(
  (typeId) => GUNS.has(typeId),
  (player, item) => {
    const gun = GUNS.get(item.typeId);
    if (gun) handleUse(player, gun);
  },
);

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
  hitReports.delete(event.playerId);
  lastShot.delete(event.playerId);
});

system.runInterval(() => {
  for (const shot of shots.values()) step(shot);
}, 1);

// Remove potatoes nobody is flying: left over from a script reload, or /summon'd.
system.runInterval(() => {
  for (const id of ['overworld', 'nether', 'the_end']) {
    try {
      for (const potato of world.getDimension(id).getEntities({ type: POTATO_ENTITY })) {
        if (!shots.has(potato.id)) removeQuietly(potato);
      }
    } catch {
      // Dimension not loaded.
    }
  }
}, SWEEP_INTERVAL_TICKS);

// Hints the first time a player holds each item, and the lore line on
// enchanted guns (a crafting recipe cannot set lore, so it is added on first hold).
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const equippable = player.getComponent('minecraft:equippable');
    const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!held || !equippable) continue;
    const gun = GUNS.get(held.typeId);
    const enchantmentHint = ENCHANTMENTS.get(held.typeId);
    if (!gun && !enchantmentHint) continue;

    const lore = gun ? LORE[gun.effect] : undefined;
    if (lore && held.getLore().length === 0) {
      held.setLore([lore]);
      equippable.setEquipment(EquipmentSlot.Mainhand, held);
    }

    let seen = hinted.get(player.id);
    if (!seen) hinted.set(player.id, (seen = new Set()));
    const hintKey = gun
      ? gun.effect === 'poison' ? 'potato_gun.hint.poison' : `potato_gun.hint.${gun.kind}`
      : enchantmentHint;
    if (!hintKey || seen.has(hintKey)) continue;
    seen.add(hintKey);
    player.sendMessage({ rawtext: [PREFIX, { translate: hintKey }] });
  }
}, HOLD_CHECK_TICKS);

// ---------- debug: /scriptevent steveo:potato <give|status|hits|demo> ----------

function give(player: Player, ids: string[]): void {
  const container = inventoryOf(player);
  if (!container) return;
  for (const id of ids) container.addItem(new ItemStack(id, 1));
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'potato') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    const say = (message: RawMessage) => player.sendMessage(message);
    switch (event.message.trim()) {
      case 'give': {
        give(player, [...GUNS.keys(), ...ENCHANTMENTS.keys()]);
        say({ rawtext: [PREFIX, { translate: 'potato_gun.debug.given' }] });
        break;
      }
      case 'status': {
        const teleporting = [...shots.values()].filter((s) => s.teleport).length;
        say({
          rawtext: [
            PREFIX,
            {
              translate: 'potato_gun.debug.status',
              with: {
                rawtext: [
                  { text: `${shots.size}` },
                  { text: `${teleporting}` },
                  { translate: world.gameRules.mobGriefing ? 'potato_gun.debug.status.on' : 'potato_gun.debug.status.off' },
                ],
              },
            },
          ],
        });
        break;
      }
      case 'hits': {
        const on = !hitReports.has(player.id);
        if (on) hitReports.add(player.id);
        else hitReports.delete(player.id);
        say({ rawtext: [PREFIX, { translate: on ? 'potato_gun.debug.hits.on' : 'potato_gun.debug.hits.off' }] });
        break;
      }
      case 'demo': {
        const gun = GUNS.get('steveo:potato_crossbow');
        if (gun) launch(player, gun);
        say({ rawtext: [PREFIX, { translate: 'potato_gun.debug.demo' }] });
        break;
      }
      default:
        say({ rawtext: [PREFIX, { translate: 'potato_gun.debug.help' }] });
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
