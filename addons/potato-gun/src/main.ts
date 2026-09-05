/**
 * Potato Gun — a crossbow and a rocket launcher that fire potatoes, plus an
 * "Explosive" enchantment that makes the potatoes blow up on impact.
 *
 * Both guns are custom items with unlimited ammo. Using one spawns a
 * `steveo:potato` projectile entity at the player's eyes and shoots it along
 * the player's view; nothing is consumed and nothing wears out. The
 * crossbow potato is quick and arcs like an arrow; the launcher potato is
 * bigger, slower, flies almost straight, and hits harder. Impact damage lives
 * in the entity's `minecraft:projectile` component, so a potato hurts even if
 * the script is not around to see it land.
 *
 * "Explosive" is not a real enchantment — Bedrock has no custom enchantments —
 * so it is modelled the way players will experience it: an Explosive
 * Enchantment item (a glinting book) that combines with a gun at a crafting
 * table into an explosive variant of that gun. The explosive guns glint and
 * carry an "Explosive" lore line, and the potatoes they fire detonate on
 * impact via `createExplosion`, credited to the shooter. Block damage follows
 * the `mobGriefing` game rule, like a creeper.
 *
 * Every shot is remembered by projectile id so the hit handler knows which
 * gun fired it and who pulled the trigger. As a fallback (the script was
 * reloaded mid-flight, say) the potato entity's variant and mark_variant carry
 * the same information. Potatoes also have an 8-second fuse in
 * entities/potato.json so a lost one despawns on its own.
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
  type ProjectileHitBlockAfterEvent,
  type ProjectileHitEntityAfterEvent,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('potato-gun');
const PREFIX: RawMessage = { text: `${Format.gray}[Potato Gun]${Format.reset} ` };

const POTATO_ENTITY = 'steveo:potato';
const ENCHANTMENT_ID = 'steveo:explosive_enchantment';
const SPLAT_PARTICLE = 'steveo:potato_splat';
/** Gray, like a vanilla enchantment line under the item name. */
const EXPLOSIVE_LORE = `${Format.gray}Explosive`;

/** Shots are forgotten after this many ticks; the entity fuse is 8 s. */
const SHOT_TTL_TICKS = 200;
const SWEEP_INTERVAL_TICKS = 100;
/** How often to check what players are holding, for hints and lore. */
const HOLD_CHECK_TICKS = 10;
/** How far in front of the eyes a potato appears, so it clears the player's own hitbox. */
const MUZZLE_OFFSET = 0.5;

type Kind = 'crossbow' | 'launcher';

interface Gun {
  kind: Kind;
  explosive: boolean;
  /** Muzzle velocity in blocks per tick. */
  speed: number;
  /** Aim wobble passed to `shoot()`; 0 is laser-straight. */
  spread: number;
  /** Explosion radius when explosive (TNT is 4, a creeper 3). */
  blastRadius: number;
  /** Entity event that configures the potato for this gun. */
  spawnEvent: string;
  sound: string;
  pitch: number;
}

const GUNS: ReadonlyMap<string, Gun> = new Map<string, Gun>([
  [
    'steveo:potato_crossbow',
    {
      kind: 'crossbow', explosive: false, speed: 2.4, spread: 0.5, blastRadius: 0,
      spawnEvent: 'steveo:crossbow', sound: 'random.bow', pitch: 0.7,
    },
  ],
  [
    'steveo:potato_crossbow_explosive',
    {
      kind: 'crossbow', explosive: true, speed: 2.4, spread: 0.5, blastRadius: 1.8,
      spawnEvent: 'steveo:crossbow_explosive', sound: 'random.bow', pitch: 0.7,
    },
  ],
  [
    'steveo:potato_launcher',
    {
      kind: 'launcher', explosive: false, speed: 1.6, spread: 0, blastRadius: 0,
      spawnEvent: 'steveo:launcher', sound: 'firework.launch', pitch: 0.6,
    },
  ],
  [
    'steveo:potato_launcher_explosive',
    {
      kind: 'launcher', explosive: true, speed: 1.6, spread: 0, blastRadius: 3,
      spawnEvent: 'steveo:launcher_explosive', sound: 'firework.launch', pitch: 0.6,
    },
  ],
]);

interface Shot {
  gun: Gun;
  shooterId: string;
  tick: number;
}

/** Potatoes in flight, keyed by projectile entity id. */
const shots = new Map<string, Shot>();

/** Players who have seen the hold hint for each item this session. */
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

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent('minecraft:inventory')?.container;
}

// ---------- firing ----------

/** Spawns a potato at the player's eyes and shoots it along their view. */
function launch(player: Player, gun: Gun): Entity | undefined {
  const view = player.getViewDirection();
  const origin = add(player.getHeadLocation(), scale(view, MUZZLE_OFFSET));
  let potato: Entity;
  try {
    potato = player.dimension.spawnEntity(POTATO_ENTITY, origin, { spawnEvent: gun.spawnEvent });
  } catch (err) {
    log.error(`spawning a potato for ${player.name} failed`, err);
    return undefined;
  }
  const projectile = potato.getComponent('minecraft:projectile');
  if (!projectile) {
    log.error('steveo:potato has no projectile component; check entities/potato.json');
    potato.remove();
    return undefined;
  }
  projectile.owner = player;
  projectile.shoot(scale(view, gun.speed), { uncertainty: gun.spread });
  shots.set(potato.id, { gun, shooterId: player.id, tick: system.currentTick });
  player.dimension.playSound(gun.sound, origin, { pitch: gun.pitch });
  return potato;
}

function handleUse(player: Player, gun: Gun): void {
  if (lastShot.get(player.id) === system.currentTick) return;
  lastShot.set(player.id, system.currentTick);
  launch(player, gun);
}

// ---------- hits ----------

/** Reads a potato's gun settings off the entity, for shots the script did not see fired. */
function describeFromEntity(projectile: Entity): Pick<Gun, 'kind' | 'explosive' | 'blastRadius'> | undefined {
  try {
    if (projectile.typeId !== POTATO_ENTITY) return undefined;
    const kind: Kind = projectile.getComponent('minecraft:mark_variant')?.value === 1 ? 'launcher' : 'crossbow';
    const explosive = projectile.getComponent('minecraft:variant')?.value === 1;
    for (const gun of GUNS.values()) {
      if (gun.kind === kind && gun.explosive === explosive) return gun;
    }
  } catch {
    // The entity was already removed by remove_on_hit; nothing to read.
  }
  return undefined;
}

function splat(dimension: Dimension, location: Vector3, kind: Kind): void {
  try {
    dimension.spawnParticle(SPLAT_PARTICLE, location);
    dimension.playSound('mob.slime.small', location, { pitch: kind === 'launcher' ? 0.6 : 1.1 });
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

function onHit(event: ProjectileHitBlockAfterEvent | ProjectileHitEntityAfterEvent): void {
  // `id` is readable even after the entity is gone; everything else may throw.
  const id = event.projectile.id;
  const shot = shots.get(id);
  const gun = shot?.gun ?? describeFromEntity(event.projectile);
  if (!gun) return;
  shots.delete(id);

  splat(event.dimension, event.location, gun.kind);
  if (gun.explosive) {
    const shooter = shot ? world.getEntity(shot.shooterId) : event.source;
    explode(event.dimension, event.location, gun.blastRadius, shooter);
  }
}

// ---------- events ----------

world.afterEvents.itemUse.subscribe((event) => {
  const gun = GUNS.get(event.itemStack.typeId);
  if (gun) handleUse(event.source, gun);
});

// Using the gun on a block fires this instead of (or as well as) itemUse.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.itemStack || !event.isFirstEvent) return;
  const gun = GUNS.get(event.itemStack.typeId);
  if (gun) handleUse(event.player, gun);
});

world.afterEvents.projectileHitBlock.subscribe(onHit);
world.afterEvents.projectileHitEntity.subscribe(onHit);

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
  lastShot.delete(event.playerId);
});

// Forget shots whose potato has long since landed or despawned.
system.runInterval(() => {
  const stale = system.currentTick - SHOT_TTL_TICKS;
  for (const [id, shot] of shots) if (shot.tick < stale) shots.delete(id);
}, SWEEP_INTERVAL_TICKS);

// Hints the first time a player holds each item, and the "Explosive" lore line
// on explosive guns (a crafting recipe cannot set lore, so it is added on first hold).
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const equippable = player.getComponent('minecraft:equippable');
    const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (!held || !equippable) continue;
    const gun = GUNS.get(held.typeId);
    const isEnchantment = held.typeId === ENCHANTMENT_ID;
    if (!gun && !isEnchantment) continue;

    if (gun?.explosive && held.getLore().length === 0) {
      held.setLore([EXPLOSIVE_LORE]);
      equippable.setEquipment(EquipmentSlot.Mainhand, held);
    }

    let seen = hinted.get(player.id);
    if (!seen) hinted.set(player.id, (seen = new Set()));
    const hintKey = gun ? `potato_gun.hint.${gun.kind}` : 'potato_gun.hint.enchantment';
    if (seen.has(hintKey)) continue;
    seen.add(hintKey);
    player.sendMessage({ rawtext: [PREFIX, { translate: hintKey }] });
  }
}, HOLD_CHECK_TICKS);

// ---------- debug: /scriptevent steveo:potato <give|status|demo> ----------

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
        give(player, [...GUNS.keys(), ENCHANTMENT_ID]);
        say({ rawtext: [PREFIX, { translate: 'potato_gun.debug.given' }] });
        break;
      }
      case 'status': {
        say({
          rawtext: [
            PREFIX,
            {
              translate: 'potato_gun.debug.status',
              with: {
                rawtext: [
                  { text: `${shots.size}` },
                  { translate: world.gameRules.mobGriefing ? 'potato_gun.debug.status.on' : 'potato_gun.debug.status.off' },
                ],
              },
            },
          ],
        });
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
