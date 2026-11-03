/**
 * Blub the Axolotl — a pet axolotl that swims through the air beside you and
 * grows with every fish until it is big enough to ride.
 *
 * The entity definition (behavior_pack/entities/blub.json) does what the game
 * can do on its own: six coats rolled at hatching (blue is rare, rainbow is
 * rarer), hovering with no gravity, taming with a fish, following its owner,
 * and, in the Giant stage, two seats and flying like a Happy Ghast. A damage
 * sensor makes Blub immune to everything but the void.
 *
 * This script adds the parts that need judgement:
 *
 * - **Growing.** Fish eaten since the last growth are counted in a dynamic
 *   property. The stage itself lives in the entity, in a component group that
 *   sets `minecraft:mark_variant`, because the client reads that to scale the
 *   model. Collision and seats are sized by hand to match, as the Mario Kart's
 *   are.
 * - **Bubbles.** Blub blows a stream of them while ridden and the odd one
 *   otherwise. Vanilla's bubble particles vanish outside water, so the
 *   resource pack ships its own.
 * - **Landing.** A rider who gets off in midair gets Slow Falling, so hopping
 *   off a Giant Blub at cloud height is a float rather than a death.
 * - **Crown.** Same as the King Charles crown. Shears take it back, because
 *   sneak + empty hand is the stay/follow toggle here.
 * - **Debug.** `/scriptevent steveo:blub <egg|crown|coats|tame|giant|baby|status|dismiss|check>`.
 */
import {
  EntityInitializationCause,
  EntityTypes,
  EquipmentSlot,
  GameMode,
  ItemStack,
  MolangVariableMap,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

const log = createLogger('blub');
const TAG = `${Format.gray}[Blub]${Format.reset} `;

const BLUB = 'steveo:blub';
const EGG = 'steveo:blub_egg';
const CROWN = 'steveo:blub_crown';
const BUBBLE = 'steveo:blub_bubble';
const TAMED = 'minecraft:is_tamed';
const FISH_EATEN = 'steveo:fish_eaten';
const STAYING = 'steveo:staying';

/** Matches `tame_items` in the entity JSON. */
const FISH: ReadonlySet<string> = new Set([
  'minecraft:cod',
  'minecraft:salmon',
  'minecraft:tropical_fish',
  'minecraft:cooked_cod',
  'minecraft:cooked_salmon',
]);

/** Items that keep their own use on a Blub while sneaking. */
const SNEAK_USABLE: ReadonlySet<string> = new Set(['minecraft:lead', 'minecraft:name_tag']);

/** Fish needed to leave each stage. Tiny to Giant takes 14 in all. */
const FISH_TO_GROW = [2, 3, 4, 5];
const GIANT = FISH_TO_GROW.length;
/** Model scale per stage. Keep in step with `scripts.scale` in blub.entity.json. */
const STAGE_SCALE = [1, 1.75, 2.75, 3.75, 5];

const COATS = ['pink', 'cyan', 'gold', 'brown', 'blue', 'rainbow'] as const;
const BLUE = COATS.indexOf('blue');
const RAINBOW = COATS.indexOf('rainbow');

const TICK_INTERVAL = 5;
/** Out of 100, per pass: how often an unridden Blub blows a bubble. */
const IDLE_BUBBLE_CHANCE = 4;
const SLOW_FALL_TICKS = 200;
const NEARBY = 24;

const DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];

// ---------------------------------------------------------------------------
// Small helpers

function nameOf(blub: Entity): RawMessage {
  const name = blub.isValid ? blub.nameTag : '';
  return name ? { text: name } : { translate: 'blub.default_name' };
}

function text(key: string, ...args: (string | RawMessage)[]): RawMessage {
  return { translate: key, with: { rawtext: args.map((a) => (typeof a === 'string' ? { text: a } : a)) } };
}

function say(player: Player, key: string, ...args: (string | RawMessage)[]): void {
  player.sendMessage({ rawtext: [{ text: TAG }, text(key, ...args)] });
}

function title(player: Player, key: string, subtitleKey: string): void {
  player.onScreenDisplay.setTitle(
    { translate: key },
    { subtitle: { translate: subtitleKey }, fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20 },
  );
}

function ownerOf(blub: Entity): Player | undefined {
  return blub.getComponent('minecraft:tameable')?.tamedToPlayer;
}

function stageOf(blub: Entity): number {
  return blub.getComponent('minecraft:mark_variant')?.value ?? 0;
}

function coatOf(blub: Entity): number {
  return blub.getComponent('minecraft:variant')?.value ?? 0;
}

function isCrowned(blub: Entity): boolean {
  return blub.getComponent('minecraft:skin_id')?.value === 1;
}

function fishEaten(blub: Entity): number {
  const value = blub.getDynamicProperty(FISH_EATEN);
  return typeof value === 'number' ? value : 0;
}

function playSound(dimension: Dimension, id: string, at: Vector3, pitch = 1): void {
  try {
    dimension.playSound(id, at, { pitch });
  } catch {
    // Cosmetic, and the chunk may be unloading.
  }
}

function hearts(dimension: Dimension, at: Vector3, count: number): void {
  for (let i = 0; i < count; i++) {
    try {
      dimension.spawnParticle('minecraft:heart_particle', {
        x: at.x + (Math.random() - 0.5) * 1.5,
        y: at.y + 0.6 + Math.random(),
        z: at.z + (Math.random() - 0.5) * 1.5,
      });
    } catch {
      return;
    }
  }
}

function giveItem(player: Player, item: ItemStack): void {
  const leftover = player.getComponent('minecraft:inventory')?.container?.addItem(item);
  if (leftover) player.dimension.spawnItem(leftover, player.location);
}

function takeOneFromHand(player: Player): void {
  if (player.getGameMode() === GameMode.Creative) return;
  const slot = player.getComponent('minecraft:equippable')?.getEquipmentSlot(EquipmentSlot.Mainhand);
  const item = slot?.getItem();
  if (!slot || !item) return;
  if (item.amount > 1) {
    item.amount -= 1;
    slot.setItem(item);
  } else {
    slot.setItem(undefined);
  }
}

// ---------------------------------------------------------------------------
// Bubbles

/** Just in front of the face, which moves out with the model as Blub grows. */
function mouthOf(blub: Entity, scale: number): Vector3 {
  const { x, y, z } = blub.location;
  const view = blub.getViewDirection();
  const reach = scale * 0.65;
  return { x: x + view.x * reach, y: y + scale * 0.2 + view.y * reach, z: z + view.z * reach };
}

function blowBubble(blub: Entity): void {
  const scale = STAGE_SCALE[stageOf(blub)] ?? 1;
  const vars = new MolangVariableMap();
  vars.setFloat('variable.bubble_size', 0.12 + scale * 0.05);
  try {
    blub.dimension.spawnParticle(BUBBLE, mouthOf(blub, scale), vars);
  } catch {
    // Cosmetic, and the chunk may be unloading.
  }
}

// ---------------------------------------------------------------------------
// Hatching

function announceHatch(blub: Entity): void {
  if (!blub.isValid) return;
  if (!blub.nameTag) blub.nameTag = 'Blub';
  blowBubble(blub);
  playSound(blub.dimension, 'mob.axolotl.splash', blub.location);

  const [player] = blub.dimension.getPlayers({ location: blub.location, closest: 1, maxDistance: NEARBY });
  if (!player) return;
  const coat = coatOf(blub);
  if (coat === RAINBOW) {
    title(player, 'blub.rainbow.title', 'blub.rainbow.subtitle');
    playSound(blub.dimension, 'random.totem', blub.location);
  } else if (coat === BLUE) {
    say(player, 'blub.hatched_blue');
    playSound(blub.dimension, 'random.levelup', blub.location);
  } else {
    say(player, 'blub.hatched', { translate: `blub.coat.${coat}` });
  }
}

world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
  if (entity.typeId !== BLUB || cause === EntityInitializationCause.Loaded) return;
  // Wait a tick so the coat rolled by `minecraft:entity_spawned` can be read.
  system.run(() => {
    try {
      announceHatch(entity);
    } catch (err) {
      log.error('hatching failed', err);
    }
  });
});

// ---------------------------------------------------------------------------
// Growing

function setStage(blub: Entity, stage: number): void {
  blub.triggerEvent(`steveo:stage_${stage}`);
  blub.setDynamicProperty(FISH_EATEN, 0);
}

function grow(player: Player, blub: Entity, stage: number): void {
  setStage(blub, stage);
  hearts(blub.dimension, blub.location, 8);
  playSound(blub.dimension, 'random.levelup', blub.location, 0.6 + stage * 0.2);
  if (stage === GIANT) {
    title(player, 'blub.giant.title', 'blub.giant.subtitle');
    playSound(blub.dimension, 'random.totem', blub.location);
  } else {
    say(player, 'blub.grew', nameOf(blub), { translate: `blub.stage.${stage}` });
  }
}

function feed(player: Player, blub: Entity): void {
  if (!blub.isValid || !player.isValid) return;
  const stage = stageOf(blub);
  const needed = FISH_TO_GROW[stage];
  if (needed === undefined) {
    // Fully grown: keep the fish.
    blowBubble(blub);
    say(player, 'blub.full', nameOf(blub));
    return;
  }

  takeOneFromHand(player);
  hearts(blub.dimension, blub.location, 3);
  blowBubble(blub);
  playSound(blub.dimension, 'random.eat', blub.location);

  const eaten = fishEaten(blub) + 1;
  if (eaten >= needed) {
    grow(player, blub, stage + 1);
    return;
  }
  blub.setDynamicProperty(FISH_EATEN, eaten);
  player.onScreenDisplay.setActionBar(text('blub.fed', nameOf(blub), String(eaten), String(needed)));
}

// ---------------------------------------------------------------------------
// The crown

function putCrown(player: Player, blub: Entity): void {
  if (!blub.isValid || !player.isValid) return;
  if (isCrowned(blub)) {
    say(player, 'blub.already_crowned', nameOf(blub));
    return;
  }
  takeOneFromHand(player);
  blub.triggerEvent('steveo:crown_on');
  playSound(blub.dimension, 'armor.equip_gold', blub.location);
  hearts(blub.dimension, blub.location, 3);
  say(player, 'blub.crowned', nameOf(blub));
}

function takeCrown(player: Player, blub: Entity): void {
  if (!blub.isValid || !player.isValid) return;
  blub.triggerEvent('steveo:crown_off');
  giveItem(player, new ItemStack(CROWN, 1));
  playSound(blub.dimension, 'armor.equip_gold', blub.location);
  say(player, 'blub.uncrowned', nameOf(blub));
}

// ---------------------------------------------------------------------------
// Interaction

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { target, player, itemStack } = event;
  if (target.typeId !== BLUB || !itemStack) return;

  if (itemStack.typeId === CROWN) {
    event.cancel = true;
    system.run(() => putCrown(player, target));
  } else if (itemStack.typeId === 'minecraft:shears' && isCrowned(target)) {
    event.cancel = true;
    system.run(() => takeCrown(player, target));
  } else if (FISH.has(itemStack.typeId)) {
    // A fish on a wild Blub is a taming attempt: leave that to `minecraft:tameable`.
    if (!target.hasComponent(TAMED)) return;
    event.cancel = true;
    system.run(() => feed(player, target));
  } else if (player.isSneaking && !SNEAK_USABLE.has(itemStack.typeId)) {
    // The stay/follow toggle is sneak + empty hand, but its data-driven filter
    // cannot see an empty hand, so a held item is turned away here.
    event.cancel = true;
  }
});

// The entity filters below are checked by hand: an `entityTypes` filter naming
// a type the game failed to load throws, which would stop this whole script.
world.afterEvents.dataDrivenEntityTrigger.subscribe(
  ({ entity: blub }) => {
    if (blub.typeId !== BLUB) return;
    const staying = !blub.hasTag(STAYING);
    if (staying) blub.addTag(STAYING);
    else blub.removeTag(STAYING);
    blub.triggerEvent(staying ? 'steveo:stay' : 'steveo:follow');
    const owner = ownerOf(blub);
    if (owner) say(owner, staying ? 'blub.stay' : 'blub.follow', nameOf(blub));
  },
  { eventTypes: ['steveo:toggle_stay'] },
);

world.afterEvents.dataDrivenEntityTrigger.subscribe(
  ({ entity: blub }) => {
    if (blub.typeId !== BLUB) return;
    // The owner is set after the tame event, so look for it a tick later.
    system.run(() => {
      if (!blub.isValid) return;
      const owner = ownerOf(blub);
      if (!owner) return;
      hearts(blub.dimension, blub.location, 6);
      playSound(blub.dimension, 'random.levelup', blub.location, 1.4);
      say(owner, 'blub.tamed', nameOf(blub));
    });
  },
  { eventTypes: ['steveo:on_tame'] },
);

// ---------------------------------------------------------------------------
// Load check
//
// When the game rejects an entity definition, the type is simply never
// registered: no error reaches chat, and a Realm has no content log. Blub 1.0.0
// and 1.0.1 went that way, so the script says so on join and on demand.

function loadReport(): string {
  return `blub ${EntityTypes.get(BLUB) ? 'loaded' : 'MISSING'}`;
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || EntityTypes.get(BLUB)) return;
  say(player, 'blub.broken', loadReport());
});

// ---------------------------------------------------------------------------
// Riders and idle bubbles

/** Riders seen on the last pass, to notice anyone who just got off. */
let riding = new Set<string>();
const hinted = new Set<string>();

function tend(blub: Entity, ridersNow: Set<string>): void {
  const riders = blub.getComponent('minecraft:rideable')?.getRiders() ?? [];
  if (riders.length === 0) {
    if (Math.random() * 100 < IDLE_BUBBLE_CHANCE) blowBubble(blub);
    return;
  }
  blowBubble(blub);
  for (const rider of riders) {
    ridersNow.add(rider.id);
    if (rider instanceof Player && !hinted.has(rider.id)) {
      hinted.add(rider.id);
      say(rider, 'blub.hint.ride');
    }
  }
}

function landSafely(id: string): void {
  const rider = world.getEntity(id);
  if (rider instanceof Player && !rider.isOnGround) {
    rider.addEffect('slow_falling', SLOW_FALL_TICKS, { showParticles: false });
  }
}

system.runInterval(() => {
  const ridersNow = new Set<string>();
  for (const id of DIMENSIONS) {
    let blubs: Entity[];
    try {
      blubs = world.getDimension(id).getEntities({ type: BLUB });
    } catch {
      continue;
    }
    for (const blub of blubs) {
      try {
        tend(blub, ridersNow);
      } catch (err) {
        log.error(`tending ${blub.id} failed`, err);
      }
    }
  }
  for (const id of riding) {
    if (ridersNow.has(id)) continue;
    try {
      landSafely(id);
    } catch (err) {
      log.error('landing failed', err);
    }
  }
  riding = ridersNow;
}, TICK_INTERVAL);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  hinted.delete(playerId);
});

// ---------------------------------------------------------------------------
// Debug: /scriptevent steveo:blub <egg|crown|coats|tame|giant|baby|status|dismiss|check>

function nearbyBlubs(player: Player): Entity[] {
  return player.dimension.getEntities({
    type: BLUB,
    location: player.location,
    maxDistance: NEARBY,
    closest: 16,
  });
}

function tameTo(player: Player, blub: Entity): boolean {
  if (blub.hasComponent(TAMED)) return false;
  blub.getComponent('minecraft:tameable')?.tame(player);
  blub.triggerEvent('steveo:on_tame'); // Idempotent: makes sure the groups swapped.
  return true;
}

function inFront(player: Player, distance: number, sideways: number): Vector3 {
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  const fx = view.x / flat;
  const fz = view.z / flat;
  const { x, y, z } = player.location;
  return { x: x + fx * distance - fz * sideways, y: y + 1, z: z + fz * distance + fx * sideways };
}

function debugCoats(player: Player): void {
  for (const [i, coat] of COATS.entries()) {
    const spread = (i - (COATS.length - 1) / 2) * 1.5;
    player.dimension.spawnEntity(BLUB, inFront(player, 4, spread), { spawnEvent: `steveo:hatch_${coat}` });
  }
  say(player, 'blub.debug.coats');
}

function debugTame(player: Player): void {
  const tamed = nearbyBlubs(player).filter((blub) => tameTo(player, blub)).length;
  say(player, 'blub.debug.tamed', String(tamed));
}

/** The nearest Blub, or a new one when there is none to act on. */
function nearestOrNew(player: Player): Entity {
  return nearbyBlubs(player)[0] ?? player.dimension.spawnEntity(BLUB, inFront(player, 4, 0));
}

function debugGiant(player: Player): void {
  const blub = nearestOrNew(player);
  tameTo(player, blub);
  setStage(blub, GIANT);
  say(player, 'blub.debug.giant', nameOf(blub));
}

function debugBaby(player: Player): void {
  const [blub] = nearbyBlubs(player);
  if (!blub) {
    say(player, 'blub.debug.none');
    return;
  }
  setStage(blub, 0);
  say(player, 'blub.debug.baby', nameOf(blub));
}

function debugStatus(player: Player): void {
  const blubs = nearbyBlubs(player);
  if (blubs.length === 0) {
    say(player, 'blub.debug.none');
    return;
  }
  const lines = blubs.map((blub) => {
    const stage = stageOf(blub);
    const owner = ownerOf(blub)?.name ?? (blub.hasComponent(TAMED) ? 'owner away' : 'wild');
    const state = blub.hasTag(STAYING) ? 'staying' : 'following';
    const crown = isCrowned(blub) ? ', crowned' : '';
    const coat = COATS[coatOf(blub)] ?? 'unknown';
    return `${blub.nameTag || 'Blub'}: ${coat}, stage ${stage}, ${fishEaten(blub)} fish, ${owner}, ${state}${crown}`;
  });
  say(player, 'blub.debug.status', lines.join('; '));
}

function debugDismiss(player: Player): void {
  const [blub] = nearbyBlubs(player);
  if (!blub) {
    say(player, 'blub.debug.none');
    return;
  }
  const name = nameOf(blub);
  blub.remove();
  say(player, 'blub.debug.dismissed', name);
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'blub') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    try {
      switch (event.message.trim()) {
        case 'egg':
          giveItem(player, new ItemStack(EGG, 1));
          say(player, 'blub.debug.egg');
          break;
        case 'crown':
          giveItem(player, new ItemStack(CROWN, 1));
          say(player, 'blub.debug.crown');
          break;
        case 'coats':
          debugCoats(player);
          break;
        case 'tame':
          debugTame(player);
          break;
        case 'giant':
          debugGiant(player);
          break;
        case 'baby':
          debugBaby(player);
          break;
        case 'status':
          debugStatus(player);
          break;
        case 'dismiss':
          debugDismiss(player);
          break;
        case 'check':
          say(player, 'blub.debug.check', loadReport());
          break;
        default:
          say(player, 'blub.debug.help');
      }
    } catch (err) {
      // No content log on a Realm, so failures go to chat.
      log.error(`debug ${event.message} failed`, err);
      say(player, 'blub.debug.error', String(err));
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
