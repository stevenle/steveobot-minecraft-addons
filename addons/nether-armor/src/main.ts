/**
 * Nether Armor — a four-piece set crafted from blaze rods, blaze powder, and
 * netherrack.
 *
 * - **A few pieces: fire protection.** Each piece worn stops 25% of the hits
 *   from fire, lava, magma, and campfires.
 * - **All four: fire resistance.** The real status effect, applied with a long
 *   duration and topped up by a sweep, so it survives milk and death. A player
 *   tag marks an effect we applied, so taking a piece off never strips one
 *   from a potion. Four pieces also stop 100% of fire hits, which covers the
 *   moments before the sweep puts the effect back.
 *
 * Each protected hit is cancelled outright instead of scaled down: burning
 * deals 1 damage at a time, and a chance gives the right average whatever the
 * engine does with a fractional hit.
 *
 *   /scriptevent steveo:nether_armor give     the full set
 *   /scriptevent steveo:nether_armor status   pieces worn and current protection
 */
import {
  EntityComponentTypes,
  EntityDamageCause,
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type RawMessage,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

const log = createLogger('nether-armor');
const PREFIX: RawMessage = { text: `${Format.gray}[Nether Armor]${Format.reset} ` };

const PIECES: ReadonlyArray<[EquipmentSlot, string]> = [
  [EquipmentSlot.Head, 'steveo:nether_helmet'],
  [EquipmentSlot.Chest, 'steveo:nether_chestplate'],
  [EquipmentSlot.Legs, 'steveo:nether_leggings'],
  [EquipmentSlot.Feet, 'steveo:nether_boots'],
];

const FIRE_CAUSES = new Set<string>([
  EntityDamageCause.fire,
  EntityDamageCause.fireTick,
  EntityDamageCause.lava,
  EntityDamageCause.magma,
  EntityDamageCause.campfire,
  EntityDamageCause.soulCampfire,
]);

const EFFECT = 'fire_resistance';
const EFFECT_TAG = 'steveo:nether_fire_resistance';
/** Applied for ten minutes and refreshed when under one, so the refresh is rare. */
const EFFECT_TICKS = 20 * 60 * 10;
const EFFECT_REFRESH_BELOW = 20 * 60;
const SWEEP_TICKS = 20;

function netherPieces(player: Player): number {
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  if (equippable === undefined) return 0;
  let count = 0;
  for (const [slot, id] of PIECES) {
    if (equippable.getEquipment(slot)?.typeId === id) count++;
  }
  return count;
}

/** Share of fire hits stopped, 0..1. */
function fireProtection(pieces: number): number {
  return pieces / PIECES.length;
}

function updateEffect(player: Player): void {
  const effect = player.getEffect(EFFECT);
  if (netherPieces(player) === PIECES.length) {
    if (effect === undefined || effect.duration < EFFECT_REFRESH_BELOW) {
      player.addEffect(EFFECT, EFFECT_TICKS, { showParticles: false });
      player.addTag(EFFECT_TAG);
    }
    return;
  }
  if (!player.hasTag(EFFECT_TAG)) return;
  player.removeTag(EFFECT_TAG);
  player.removeEffect(EFFECT);
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      updateEffect(player);
    } catch (err) {
      log.warn(`fire resistance for ${player.name}: ${String(err)}`);
    }
  }
}, SWEEP_TICKS);

world.beforeEvents.entityHurt.subscribe((event) => {
  const player = event.hurtEntity;
  if (!(player instanceof Player) || !FIRE_CAUSES.has(event.damageSource.cause)) return;
  // Equipment reads are allowed in a before-event.
  if (Math.random() < fireProtection(netherPieces(player))) event.cancel = true;
});

// ---------- debug ----------

function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage({ rawtext: [PREFIX, { translate: key, with: args }] });
}

function give(player: Player): void {
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (inventory === undefined) return;
  for (const [, id] of PIECES) {
    const leftover = inventory.addItem(new ItemStack(id));
    if (leftover !== undefined) player.dimension.spawnItem(leftover, player.location);
  }
  say(player, 'nether_armor.debug.give');
}

function status(player: Player): void {
  const pieces = netherPieces(player);
  const effect = player.getEffect(EFFECT);
  say(
    player,
    'nether_armor.debug.status',
    String(pieces),
    String(PIECES.length),
    String(Math.round(fireProtection(pieces) * 100)),
    effect === undefined ? '-' : `${Math.round(effect.duration / 20)} s`,
  );
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const player = event.sourceEntity;
    if (!(player instanceof Player) || event.id !== 'steveo:nether_armor') return;
    const action = event.message.trim();
    if (action === 'give') give(player);
    else if (action === 'status') status(player);
    else say(player, 'nether_armor.debug.help');
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
