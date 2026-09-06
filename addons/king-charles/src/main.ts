/**
 * King Charles — a Cavalier King Charles Spaniel pet.
 *
 * The entity definition (behavior_pack/entities/king_charles.json) covers the
 * parts the game can do on its own: four coats picked at spawn, taming with
 * cooked meat, begging, shadowing the owner with `follow_owner`, and trotting
 * to the nearest bed when it is not following. The dog has no attack goal at
 * all — it exists to love.
 *
 * This script adds the parts that need judgement:
 *
 * - **Home.** A tamed dog adopts the nearest bed it can find as home and
 *   remembers it in a dynamic property. It will not follow its human more
 *   than HOME_LEASH blocks from home, or down into the mines (below
 *   MINE_MAX_Y, unless the home bed itself is underground). When the owner
 *   crosses one of those lines the script swaps the dog from the
 *   `steveo:following` component group to `steveo:homebound`, and back when
 *   the owner returns. Leashing the dog clears its home, so a leash is how you
 *   move house.
 * - **Food.** Feeding a tamed dog cooked meat or fish heals the dog and, if the
 *   feeder is its human, fully restores the feeder's hearts. Feeding any dog
 *   rotten food makes it sick: the `steveo:sick` group starts a 30 second
 *   timer whose `steveo:die` event the script answers with `kill()`.
 * - **Crown.** Using a `steveo:dog_crown` item on a dog swaps in the
 *   `steveo:crowned` group, whose skin id shows the crown bone in the model
 *   and whose loot table drops the crown again on death. Sneak-interacting
 *   with an empty hand takes it back.
 * - **Debug.** `/scriptevent steveo:dog spawn|tame|status|crown` exercises all
 *   of the above from chat, which is the only console a Realm has.
 */
import {
  EquipmentSlot,
  GameMode,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  ItemStack,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('king-charles');
const TAG = `${Format.gray}[King Charles]${Format.reset} `;

const DOG_ID = 'steveo:king_charles';
const CROWN_ID = 'steveo:dog_crown';
const TAMED_FAMILY = 'steveo_king_charles_tamed';
const HOME_PROPERTY = 'steveo:home';
const HOMEBOUND_TAG = 'steveo:homebound';
const BED_ID = 'minecraft:bed';

/** Food that heals. Matches `tame_items` and `tempt` in the entity JSON. */
const GOOD_FOOD = new Set([
  'minecraft:cooked_beef',
  'minecraft:cooked_chicken',
  'minecraft:cooked_porkchop',
  'minecraft:cooked_mutton',
  'minecraft:cooked_rabbit',
  'minecraft:cooked_cod',
  'minecraft:cooked_salmon',
]);

/** Food that kills. */
const BAD_FOOD = new Set([
  'minecraft:rotten_flesh',
  'minecraft:spider_eye',
  'minecraft:poisonous_potato',
  'minecraft:pufferfish',
]);

/** Below this Y the world counts as "the mines" and the dog will not follow. */
const MINE_MAX_Y = 50;
/** ...unless home is underground too: then only MINE_DEPTH below the bed counts. */
const MINE_DEPTH = 8;
/** How far from its home bed a dog is willing to follow its human. */
const HOME_LEASH = 32;
/** A homebound dog farther than this from home teleports instead of walking. */
const HOME_WALK_RANGE = 12;

/** Bed search reach around the dog, in blocks. */
const BED_SEARCH_RADIUS = 12;
const BED_SEARCH_RADIUS_Y = 4;
/** Block lookups between yields inside the bed search job. */
const BLOCKS_PER_YIELD = 64;
/** Minimum ticks between bed searches for one dog. */
const BED_SCAN_COOLDOWN_TICKS = 200;

/** How often every tamed dog is looked at, in ticks. */
const DOG_TICK_INTERVAL = 20;
/** How often a dog at its human's side shows a heart, in ticks. */
const HEART_INTERVAL_TICKS = 200;
const HEART_RANGE = 3;

const DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];

const COATS = ['blenheim', 'tricolor', 'black_tan', 'ruby'] as const;

/** Dogs with a bed search in flight, and when each dog last searched. */
const scanning = new Set<string>();
const lastScan = new Map<string, number>();

// ---------------------------------------------------------------------------
// Small helpers

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dogName(dog: Entity): RawMessage {
  const name = dog.isValid ? dog.nameTag : '';
  return name ? { text: name } : { translate: 'king_charles.default_name' };
}

function say(player: Player, key: string, dog: Entity, extra: string[] = []): void {
  player.sendMessage({
    rawtext: [
      { text: TAG },
      { translate: key, with: { rawtext: [dogName(dog), ...extra.map((text) => ({ text }))] } },
    ],
  });
}

function ownerOf(dog: Entity): Player | undefined {
  return dog.getComponent('minecraft:tameable')?.tamedToPlayer;
}

function isSick(dog: Entity): boolean {
  return dog.getComponent('minecraft:mark_variant')?.value === 1;
}

function isCrowned(dog: Entity): boolean {
  return dog.getComponent('minecraft:skin_id')?.value === 1;
}

function playSound(dimension: Dimension, soundId: string, at: Vector3): void {
  try {
    dimension.playSound(soundId, at);
  } catch {
    // sound is cosmetic
  }
}

function giveItem(player: Player, item: ItemStack): void {
  const leftover = player.getComponent('minecraft:inventory')?.container?.addItem(item);
  if (leftover) player.dimension.spawnItem(leftover, player.location);
}

function isVector3(value: unknown): value is Vector3 {
  return typeof value === 'object' && value !== null && 'x' in value && 'y' in value && 'z' in value;
}

function readHome(dog: Entity): Vector3 | undefined {
  const value = dog.getDynamicProperty(HOME_PROPERTY);
  return isVector3(value) ? value : undefined;
}

function writeHome(dog: Entity, home: Vector3 | undefined): void {
  dog.setDynamicProperty(HOME_PROPERTY, home);
}

/** True/false when the block is loaded, undefined when we cannot tell. */
function isBedAt(dimension: Dimension, pos: Vector3): boolean | undefined {
  try {
    return dimension.getBlock(pos)?.typeId === BED_ID;
  } catch {
    return undefined;
  }
}

function hearts(dimension: Dimension, at: Vector3, count = 3): void {
  for (let i = 0; i < count; i++) {
    try {
      dimension.spawnParticle('minecraft:heart_particle', {
        x: at.x + (Math.random() - 0.5),
        y: at.y + 0.6 + Math.random() * 0.4,
        z: at.z + (Math.random() - 0.5),
      });
    } catch (err) {
      log.warn(`heart particle failed: ${String(err)}`);
    }
  }
}

function teleportHome(dog: Entity, home: Vector3): void {
  try {
    dog.teleport({ x: home.x + 0.5, y: home.y + 1, z: home.z + 0.5 });
  } catch (err) {
    log.error('teleport home failed', err);
  }
}

// ---------------------------------------------------------------------------
// Home: finding and keeping a bed

/** Scans the blocks around the dog for the nearest bed and remembers it. */
function* findBedJob(dog: Entity): Generator<void, void, void> {
  try {
    if (!dog.isValid) return;
    const dimension = dog.dimension;
    const cx = Math.floor(dog.location.x);
    const cy = Math.floor(dog.location.y);
    const cz = Math.floor(dog.location.z);

    let best: Vector3 | undefined;
    let bestDistSq = Infinity;
    let checked = 0;

    for (let dy = -BED_SEARCH_RADIUS_Y; dy <= BED_SEARCH_RADIUS_Y; dy++) {
      for (let dx = -BED_SEARCH_RADIUS; dx <= BED_SEARCH_RADIUS; dx++) {
        for (let dz = -BED_SEARCH_RADIUS; dz <= BED_SEARCH_RADIUS; dz++) {
          if (++checked % BLOCKS_PER_YIELD === 0) yield;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq >= bestDistSq) continue;
          const pos = { x: cx + dx, y: cy + dy, z: cz + dz };
          if (isBedAt(dimension, pos) === true) {
            best = pos;
            bestDistSq = distSq;
          }
        }
      }
    }

    if (best && dog.isValid) writeHome(dog, best);
  } catch (err) {
    log.error('bed search failed', err);
  } finally {
    scanning.delete(dog.id);
  }
}

function maybeSearchForBed(dog: Entity): void {
  if (scanning.has(dog.id)) return;
  const now = system.currentTick;
  const last = lastScan.get(dog.id);
  if (last !== undefined && now - last < BED_SCAN_COOLDOWN_TICKS) return;
  lastScan.set(dog.id, now);
  scanning.add(dog.id);
  system.runJob(findBedJob(dog));
}

/** Y below which the dog considers the world "the mines". */
function mineFloor(home: Vector3 | undefined): number {
  return home ? Math.min(MINE_MAX_Y, home.y - MINE_DEPTH) : MINE_MAX_Y;
}

type StayReason = 'mine' | 'far';

/** Why a dog would rather not follow its human right now, if anything. */
function reasonToStay(dog: Entity, owner: Player, home: Vector3 | undefined): StayReason | undefined {
  const floor = mineFloor(home);
  if (owner.location.y < floor || dog.location.y < floor) return 'mine';
  if (home && distance(owner.location, home) > HOME_LEASH) return 'far';
  return undefined;
}

/** One pass over a tamed dog: keep its home current and decide follow vs. stay. */
function tendDog(dog: Entity): void {
  if (isSick(dog)) return;

  // A leashed dog is being taken somewhere on purpose: forget the old home
  // and adopt a new bed wherever it ends up.
  if (dog.getComponent('minecraft:leashable')?.isLeashed) {
    if (readHome(dog)) writeHome(dog, undefined);
    if (dog.hasTag(HOMEBOUND_TAG)) {
      dog.removeTag(HOMEBOUND_TAG);
      dog.triggerEvent('steveo:resume_follow');
    }
    return;
  }

  const dimension = dog.dimension;
  let home = readHome(dog);
  if (home && isBedAt(dimension, home) === false) {
    home = undefined; // the bed was picked up
    writeHome(dog, undefined);
  }
  if (!home || distance(dog.location, home) > HOME_LEASH) maybeSearchForBed(dog);

  const owner = ownerOf(dog);
  const homebound = dog.hasTag(HOMEBOUND_TAG);
  if (!owner || owner.dimension.id !== dimension.id) {
    // Nobody to follow; a homebound dog that drifted still goes back.
    if (homebound && home && distance(dog.location, home) > HOME_WALK_RANGE) teleportHome(dog, home);
    return;
  }

  const reason = reasonToStay(dog, owner, home);
  if (reason && !homebound) {
    dog.addTag(HOMEBOUND_TAG);
    dog.triggerEvent('steveo:go_home');
    if (home && distance(dog.location, home) > HOME_WALK_RANGE) teleportHome(dog, home);
    // Staying home (too far, or underground) is routine and needs no announcement.
    // A dog with no bed at all is the one case worth a word, since it waits wherever it is.
    if (!home) say(owner, 'king_charles.stays.lost', dog);
  } else if (!reason && homebound) {
    dog.removeTag(HOMEBOUND_TAG);
    dog.triggerEvent('steveo:resume_follow');
    say(owner, 'king_charles.returns', dog);
  } else if (reason && home && distance(dog.location, home) > HOME_WALK_RANGE) {
    teleportHome(dog, home);
  }

  if (
    !reason &&
    system.currentTick % HEART_INTERVAL_TICKS < DOG_TICK_INTERVAL &&
    distance(dog.location, owner.location) <= HEART_RANGE
  ) {
    hearts(dimension, dog.location, 1);
  }
}

system.runInterval(() => {
  for (const id of DIMENSIONS) {
    let dogs: Entity[];
    try {
      dogs = world.getDimension(id).getEntities({ type: DOG_ID, families: [TAMED_FAMILY] });
    } catch {
      continue;
    }
    for (const dog of dogs) {
      try {
        tendDog(dog);
      } catch (err) {
        log.error(`tending ${dog.id} failed`, err);
      }
    }
  }
}, DOG_TICK_INTERVAL);

world.afterEvents.entityRemove.subscribe(
  (event) => {
    scanning.delete(event.removedEntityId);
    lastScan.delete(event.removedEntityId);
  },
  { entityTypes: [DOG_ID] },
);

// ---------------------------------------------------------------------------
// Food

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

function feedGood(player: Player, dog: Entity): void {
  if (!dog.isValid || !player.isValid) return;
  if (isSick(dog)) {
    say(player, 'king_charles.sick', dog); // too sick to eat
    return;
  }
  takeOneFromHand(player);
  dog.getComponent('minecraft:health')?.resetToMaxValue();
  hearts(dog.dimension, dog.location, 5);
  playSound(dog.dimension, 'random.eat', dog.location);

  if (ownerOf(dog)?.id === player.id) {
    player.getComponent('minecraft:health')?.resetToMaxValue();
    hearts(player.dimension, player.location, 3);
    say(player, 'king_charles.fed', dog);
  } else {
    say(player, 'king_charles.fed_other', dog);
  }
}

function feedBad(player: Player, dog: Entity): void {
  if (!dog.isValid || !player.isValid) return;
  takeOneFromHand(player);
  if (isSick(dog)) return; // already dying
  dog.triggerEvent('steveo:get_sick');
  dog.addEffect('poison', 30 * 20, { amplifier: 0, showParticles: true });
  playSound(dog.dimension, 'mob.wolf.whine', dog.location);
  const owner = ownerOf(dog);
  say(player, 'king_charles.sick', dog);
  if (owner && owner.id !== player.id) say(owner, 'king_charles.sick', dog);
}

// ---------------------------------------------------------------------------
// The crown

function putCrown(player: Player, dog: Entity): void {
  if (!dog.isValid || !player.isValid) return;
  if (isCrowned(dog)) {
    say(player, 'king_charles.already_crowned', dog);
    return;
  }
  takeOneFromHand(player);
  dog.triggerEvent('steveo:crown_on');
  playSound(dog.dimension, 'armor.equip_gold', dog.location);
  hearts(dog.dimension, dog.location, 3);
  say(player, 'king_charles.crowned', dog);
}

function takeCrown(player: Player, dog: Entity): void {
  if (!dog.isValid || !player.isValid || !isCrowned(dog)) return;
  dog.triggerEvent('steveo:crown_off');
  giveItem(player, new ItemStack(CROWN_ID, 1));
  playSound(dog.dimension, 'armor.equip_gold', dog.location);
  say(player, 'king_charles.uncrowned', dog);
}

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { target, player, itemStack } = event;
  if (target.typeId !== DOG_ID) return;

  if (itemStack?.typeId === CROWN_ID) {
    event.cancel = true;
    system.run(() => putCrown(player, target));
    return;
  }
  // Sneak + empty hand on a crowned dog takes the crown back instead of
  // toggling sit.
  if (!itemStack) {
    if (player.isSneaking && isCrowned(target)) {
      event.cancel = true;
      system.run(() => takeCrown(player, target));
    }
    return;
  }

  const good = GOOD_FOOD.has(itemStack.typeId);
  const bad = BAD_FOOD.has(itemStack.typeId);
  if (!good && !bad) return;

  // Good food on a wild dog is a taming attempt: leave it to the entity's
  // `minecraft:tameable` component.
  if (good && !target.hasComponent('minecraft:is_tamed')) return;

  event.cancel = true;
  system.run(() => (good ? feedGood(player, target) : feedBad(player, target)));
});

// The sick timer fires `steveo:die`; the entity JSON only despawns, so the
// script kills first for a proper death (animation, sound, message).
world.afterEvents.dataDrivenEntityTrigger.subscribe(
  (event) => {
    const dog = event.entity;
    const owner = ownerOf(dog);
    const name = dogName(dog);
    try {
      if (dog.isValid) dog.kill();
    } catch (err) {
      log.error('kill failed', err);
    }
    if (owner) {
      owner.sendMessage({
        rawtext: [{ text: TAG }, { translate: 'king_charles.died', with: { rawtext: [name] } }],
      });
    }
  },
  { entityTypes: [DOG_ID], eventTypes: ['steveo:die'] },
);

// ---------------------------------------------------------------------------
// Debug: /scriptevent steveo:dog <spawn|tame|status|crown>

function describeDog(dog: Entity, player: Player): string {
  const name = dog.nameTag || 'spaniel';
  const home = readHome(dog);
  const state = isSick(dog) ? 'sick' : dog.hasTag(HOMEBOUND_TAG) ? 'homebound' : 'following';
  const crown = isCrowned(dog) ? ', crowned' : '';
  const homeText = home ? `bed@${home.x},${home.y},${home.z} (${distance(dog.location, home).toFixed(0)}m)` : 'no bed';
  const dist = distance(dog.location, player.location).toFixed(0);
  return `${name}: ${state}${crown}, ${homeText}, ${dist}m from you`;
}

function debugSpawn(player: Player): void {
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  const fx = view.x / flat;
  const fz = view.z / flat;
  for (const [i, coat] of COATS.entries()) {
    const spread = (i - (COATS.length - 1) / 2) * 1.5;
    try {
      player.dimension.spawnEntity(
        DOG_ID,
        {
          x: player.location.x + fx * 3 - fz * spread,
          y: player.location.y,
          z: player.location.z + fz * 3 + fx * spread,
        },
        { spawnEvent: `steveo:${coat}` },
      );
    } catch (err) {
      log.error(`debug spawn failed for ${coat}`, err);
    }
  }
  player.sendMessage({ rawtext: [{ text: TAG }, { translate: 'king_charles.debug.spawned' }] });
}

function debugTame(player: Player): void {
  let tamed = 0;
  const dogs = player.dimension.getEntities({
    type: DOG_ID,
    location: player.location,
    maxDistance: 8,
    excludeFamilies: [TAMED_FAMILY],
  });
  for (const dog of dogs) {
    const tameable = dog.getComponent('minecraft:tameable');
    if (!tameable) continue;
    try {
      tameable.tame(player);
      dog.triggerEvent('steveo:on_tame'); // idempotent: makes sure the groups swapped
      tamed++;
    } catch (err) {
      log.error('debug tame failed', err);
    }
  }
  player.sendMessage({
    rawtext: [{ text: TAG }, { translate: 'king_charles.debug.tamed', with: [`${tamed}`] }],
  });
}

function debugStatus(player: Player): void {
  const mine = player.dimension
    .getEntities({ type: DOG_ID, families: [TAMED_FAMILY] })
    .filter((dog) => ownerOf(dog)?.id === player.id);
  if (mine.length === 0) {
    player.sendMessage({ rawtext: [{ text: TAG }, { translate: 'king_charles.debug.none' }] });
    return;
  }
  const lines = mine.map((dog) => describeDog(dog, player)).join('; ');
  player.sendMessage({
    rawtext: [{ text: TAG }, { translate: 'king_charles.debug.status', with: [lines] }],
  });
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'dog') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    switch (event.message.trim()) {
      case 'spawn':
        debugSpawn(player);
        break;
      case 'tame':
        debugTame(player);
        break;
      case 'status':
        debugStatus(player);
        break;
      case 'crown':
        giveItem(player, new ItemStack(CROWN_ID, 1));
        player.sendMessage({ rawtext: [{ text: TAG }, { translate: 'king_charles.debug.crown' }] });
        break;
      default:
        player.sendMessage({ rawtext: [{ text: TAG }, { translate: 'king_charles.debug.help' }] });
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
