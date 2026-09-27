/**
 * Tim — "a dancer at heart. Their grace both in and out of battle is simply
 * unrivaled."
 *
 * Tim's card is a skin in Minecraft Dungeons, but Bedrock add-ons cannot
 * change a player's skin, so Tim comes to life as a companion instead: a
 * hero in Tim's outfit who fights at your side. The entity JSON does the
 * companion part (follow, sit, defend the owner, attack monsters except
 * creepers, heal with bread or cake). This module adds:
 *
 * - **Tim's Card.** Using it summons Tim next to you, already your
 *   companion. It is used up unless you are in Creative.
 * - **Dancing, out of battle.** When Tim has stood still for IDLE_TICKS and
 *   has not fought for CALM_TICKS, the script sets the synced
 *   `steveo:dancing` property; the client plays the dance animation and the
 *   script sprinkles music notes. Moving or fighting stops it.
 * - **Grace in battle.** Tim dodges DODGE_CHANCE of the hits aimed at them,
 *   with a twirl of notes instead of damage.
 *
 * A Tim spawned from the creative spawn egg is wild. Wild Tims stroll and
 * dance; feed one cookies to befriend it.
 */
import {
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  Player,
  system,
  world,
  type Entity,
  type Vector3,
} from '@minecraft/server';

import { onItemUse } from '@shared/use';

import { log, mainhand, particle, say, sound } from './common';

export const TIM_ID = 'steveo:tim';
export const CARD_ID = 'steveo:tim_card';
const DANCING = 'steveo:dancing';
const TAME_EVENT = 'steveo:on_tame';

const SWEEP_TICKS = 10;
/** Standing still this long starts the dance. */
const IDLE_TICKS = 40;
/** No fighting for this long before Tim will dance. */
const CALM_TICKS = 100;
/** Below this horizontal speed (blocks per tick) Tim counts as standing still. */
const STILL_SPEED = 0.03;
const DODGE_CHANCE = 0.25;
const SUMMON_DISTANCE = 2;

/** Tick each Tim last stood still since, keyed by entity id. */
const stillSince = new Map<string, number>();
/** Tick each Tim last hit or was hit. */
const lastCombat = new Map<string, number>();

const DIMENSIONS = ['overworld', 'nether', 'the_end'] as const;

export function allTims(): Entity[] {
  const tims: Entity[] = [];
  for (const id of DIMENSIONS) {
    try {
      tims.push(...world.getDimension(id).getEntities({ type: TIM_ID }));
    } catch {
      // Dimension not loaded.
    }
  }
  return tims;
}

function notes(entity: Entity, count: number): void {
  const head = entity.getHeadLocation();
  for (let i = 0; i < count; i++) {
    particle(entity.dimension, 'minecraft:note_particle', {
      x: head.x + (Math.random() - 0.5) * 0.8,
      y: head.y + 0.5 + Math.random() * 0.4,
      z: head.z + (Math.random() - 0.5) * 0.8,
    });
  }
}

// ---------- summoning ----------

/** Two blocks in front of the player at foot level, or the player's own spot if that is blocked. */
function summonSpot(player: Player): Vector3 {
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  const spot = {
    x: player.location.x + (view.x / flat) * SUMMON_DISTANCE,
    y: player.location.y,
    z: player.location.z + (view.z / flat) * SUMMON_DISTANCE,
  };
  try {
    const feet = player.dimension.getBlock(spot);
    const head = feet?.above();
    if (feet?.isAir && head?.isAir) return spot;
  } catch {
    // Unloaded or out of bounds: fall back to the player's spot.
  }
  return { ...player.location };
}

/** Spawns Tim as `player`'s companion. Returns the new Tim, or undefined if it failed. */
export function summonTim(player: Player): Entity | undefined {
  let tim: Entity;
  try {
    tim = player.dimension.spawnEntity(TIM_ID, summonSpot(player));
  } catch (err) {
    log.error(`could not summon Tim for ${player.name}`, err);
    return undefined;
  }
  try {
    tim.getComponent(EntityComponentTypes.Tameable)?.tame(player);
  } catch (err) {
    log.warn(`tame() failed: ${String(err)}`);
  }
  // Belt and braces: the tame event swaps in the companion groups, whether
  // or not tame() fired it. Running it twice is harmless.
  tim.triggerEvent(TAME_EVENT);
  notes(tim, 6);
  sound(tim.dimension, 'random.levelup', tim.location, 1.5, 0.8);
  return tim;
}

function useCard(player: Player): void {
  if (summonTim(player) === undefined) {
    say(player, 'dungeons.tim.failed');
    return;
  }
  say(player, 'dungeons.tim.summoned');
  if (player.getGameMode() === GameMode.Creative) return;
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const held = mainhand(player);
  if (equippable === undefined || held?.typeId !== CARD_ID) return;
  if (held.amount > 1) {
    held.amount -= 1;
    equippable.setEquipment(EquipmentSlot.Mainhand, held);
  } else {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
  }
}

onItemUse((typeId) => typeId === CARD_ID, (player) => useCard(player));

// ---------- dancing ----------

function isDancing(tim: Entity): boolean {
  return tim.getProperty(DANCING) === true;
}

function updateDance(tim: Entity, now: number): void {
  const v = tim.getVelocity();
  const still = Math.hypot(v.x, v.z) < STILL_SPEED;
  if (!still) {
    stillSince.delete(tim.id);
  } else if (!stillSince.has(tim.id)) {
    stillSince.set(tim.id, now);
  }
  const since = stillSince.get(tim.id);
  const fought = lastCombat.get(tim.id);
  const calm = fought === undefined || now - fought >= CALM_TICKS;
  const dance = since !== undefined && now - since >= IDLE_TICKS && calm;
  if (dance !== isDancing(tim)) tim.setProperty(DANCING, dance);
  if (dance && now % 20 < SWEEP_TICKS) notes(tim, 1);
}

system.runInterval(() => {
  const now = system.currentTick;
  const seen = new Set<string>();
  for (const tim of allTims()) {
    seen.add(tim.id);
    try {
      updateDance(tim, now);
    } catch (err) {
      log.warn(`dance update failed: ${String(err)}`);
    }
  }
  // Forget Tims that died or unloaded.
  for (const id of stillSince.keys()) if (!seen.has(id)) stillSince.delete(id);
  for (const id of lastCombat.keys()) if (!seen.has(id)) lastCombat.delete(id);
}, SWEEP_TICKS);

// ---------- grace in battle ----------

function stopDancing(tim: Entity): void {
  lastCombat.set(tim.id, system.currentTick);
  stillSince.delete(tim.id);
}

world.beforeEvents.entityHurt.subscribe((event) => {
  const tim = event.hurtEntity;
  if (tim.typeId !== TIM_ID) return;
  const { damagingEntity, damagingProjectile } = event.damageSource;
  // Only attacks can be dodged, not lava, falling, or drowning.
  if (damagingEntity === undefined && damagingProjectile === undefined) return;
  const dodged = Math.random() < DODGE_CHANCE;
  if (dodged) event.cancel = true;
  system.run(() => {
    if (!tim.isValid) return;
    stopDancing(tim);
    if (tim.getProperty(DANCING) === true) tim.setProperty(DANCING, false);
    if (!dodged) return;
    notes(tim, 4);
    sound(tim.dimension, 'random.orb', tim.location, 1.8, 0.6);
  });
});

world.afterEvents.entityHitEntity.subscribe((event) => {
  if (event.damagingEntity.typeId === TIM_ID) stopDancing(event.damagingEntity);
});
