/**
 * The power-up suits. Both are chestplates, so a player wears one at a time.
 *
 * Squirrel Suit: flight. Bedrock has no way to grant flight to a survival
 * player, so the script drives it with knockback every tick while the wearer
 * is airborne: hold jump to climb, hold forward to fly where you look, let go
 * to glide down slowly, sneak to drop. Fall damage is cancelled while worn.
 *
 * Frog Suit: water breathing at all times, and Dolphin's Grace (fast
 * swimming) plus Night Vision while in water. The effects are short and
 * refreshed, and removed when the suit comes off.
 */
import {
  ButtonState,
  EntityDamageCause,
  EquipmentSlot,
  InputButton,
  system,
  world,
  type Player,
} from '@minecraft/server';

import { log, normalize, say } from './common';

export const SQUIRREL_SUIT = 'steveo:squirrel_suit';
export const FROG_SUIT = 'steveo:frog_suit';
type Suit = 'squirrel' | 'frog';

const SUITS: ReadonlyMap<string, Suit> = new Map([
  [SQUIRREL_SUIT, 'squirrel'],
  [FROG_SUIT, 'frog'],
]);

const EQUIP_CHECK_TICKS = 5;
const FROG_REFRESH_TICKS = 20;
/** Long enough that Night Vision never reaches its end-of-effect flicker between refreshes. */
const FROG_EFFECT_TICKS = 300;
const DOLPHIN_TICKS = 40;

/** Squirrel flight, in blocks per tick. */
const FLY_UP = 0.32;
const FLY_SPEED = 0.55;
const GLIDE_SINK = 0.1;

/** What each player is wearing, refreshed every few ticks. */
const wearing = new Map<string, Suit>();
/** Players whose Night Vision came from the Frog Suit, so only that is removed. */
const frogNightVision = new Set<string>();
/** Players who have seen each suit's hint this session. */
const hinted = new Map<string, Set<Suit>>();

export function suitOf(player: Player): Suit | undefined {
  return wearing.get(player.id);
}

function readSuit(player: Player): Suit | undefined {
  const chest = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Chest);
  return chest ? SUITS.get(chest.typeId) : undefined;
}

function removeOurEffect(player: Player, id: string, maxTicks: number): void {
  try {
    const effect = player.getEffect(id);
    // Leave a longer effect alone: it came from a potion or a beacon, not us.
    if (effect && effect.duration <= maxTicks) player.removeEffect(id);
  } catch {
    // Effect already gone.
  }
}

function takeOffFrogSuit(player: Player): void {
  removeOurEffect(player, 'water_breathing', FROG_EFFECT_TICKS);
  removeOurEffect(player, 'dolphins_grace', DOLPHIN_TICKS);
  if (frogNightVision.delete(player.id)) removeOurEffect(player, 'night_vision', FROG_EFFECT_TICKS);
}

function hint(player: Player, suit: Suit): void {
  let seen = hinted.get(player.id);
  if (!seen) hinted.set(player.id, (seen = new Set()));
  if (seen.has(suit)) return;
  seen.add(suit);
  say(player, `mario.hint.${suit}_suit`);
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const before = wearing.get(player.id);
      const now = readSuit(player);
      if (now) wearing.set(player.id, now);
      else wearing.delete(player.id);
      if (before === 'frog' && now !== 'frog') takeOffFrogSuit(player);
      if (now && now !== before) hint(player, now);
    } catch {
      // Player is mid-respawn.
    }
  }
}, EQUIP_CHECK_TICKS);

// ---------- Frog Suit ----------

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (wearing.get(player.id) !== 'frog') continue;
    try {
      player.addEffect('water_breathing', FROG_EFFECT_TICKS, { showParticles: false });
      if (player.isInWater) {
        player.addEffect('dolphins_grace', DOLPHIN_TICKS, { showParticles: false });
        player.addEffect('night_vision', FROG_EFFECT_TICKS, { showParticles: false });
        frogNightVision.add(player.id);
      } else if (frogNightVision.delete(player.id)) {
        removeOurEffect(player, 'night_vision', FROG_EFFECT_TICKS);
      }
    } catch (err) {
      log.warn(`frog suit effects failed: ${String(err)}`);
    }
  }
}, FROG_REFRESH_TICKS);

// ---------- Squirrel Suit ----------

function fly(player: Player): void {
  if (player.isOnGround || player.isFlying || player.isGliding || player.isInWater || player.isSneaking) return;
  const jump = player.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed;
  const forward = player.inputInfo.getMovementVector().y;
  const v = player.getVelocity();
  // Gliding with no input and already sinking gently: leave the client alone.
  if (!jump && forward <= 0.1 && v.y >= -GLIDE_SINK) return;

  let horizontal = { x: v.x, z: v.z };
  if (forward > 0.1) {
    const view = player.getViewDirection();
    const dir = normalize({ x: view.x, y: 0, z: view.z });
    horizontal = { x: dir.x * FLY_SPEED * forward, z: dir.z * FLY_SPEED * forward };
  }
  const vertical = jump ? FLY_UP : Math.max(v.y, -GLIDE_SINK);
  player.applyKnockback(horizontal, vertical);
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (wearing.get(player.id) !== 'squirrel') continue;
    try {
      fly(player);
    } catch {
      // Player left mid-tick.
    }
  }
}, 1);

world.beforeEvents.entityHurt.subscribe(
  (event) => {
    if (wearing.get(event.hurtEntity.id) === 'squirrel') event.cancel = true;
  },
  { allowedDamageCauses: [EntityDamageCause.fall], entityFilter: { type: 'minecraft:player' } },
);

world.afterEvents.playerLeave.subscribe((event) => {
  wearing.delete(event.playerId);
  frogNightVision.delete(event.playerId);
  hinted.delete(event.playerId);
});
