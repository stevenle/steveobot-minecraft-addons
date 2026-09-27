/**
 * Minecraft Dungeons — four cards from the Minecraft Dungeons Arcade brought
 * into Bedrock: the Firebrand axe, the Ender Armor set, the Corrupted Beacon,
 * and Tim. Each lives in its own module; this file wires them up and adds
 * the debug command, since chat is the only console on a Realm.
 *
 *   /scriptevent steveo:dungeons give     all four items (and the full armor set)
 *   /scriptevent steveo:dungeons status   armor pieces, boost, beam cooldown, Tims
 *   /scriptevent steveo:dungeons blink    force an Ender Armor blink
 *   /scriptevent steveo:dungeons beam     fire the held Corrupted Beacon, ignoring cooldown
 *   /scriptevent steveo:dungeons tim      summon a Tim as your companion, no card needed
 */
import { EntityComponentTypes, ItemStack, Player, system } from '@minecraft/server';

import { log, say } from './common';
import { beamCount, BEACON_ID, cooldownLeft, forceFire } from './corrupted_beacon';
import { blink, ENDER_PIECES, enderPieces } from './ender_armor';
import { FIREBRAND_ID } from './firebrand';
import { allTims, CARD_ID, summonTim } from './tim';

function give(player: Player, id: string, amount = 1): void {
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (inventory === undefined) return;
  const leftover = inventory.addItem(new ItemStack(id, amount));
  if (leftover !== undefined) player.dimension.spawnItem(leftover, player.location);
}

function status(player: Player): void {
  const boost = player.getEffect('health_boost');
  const health = player.getComponent(EntityComponentTypes.Health);
  const tims = allTims();
  const tamed = tims.filter((tim) => tim.getComponent(EntityComponentTypes.IsTamed) !== undefined).length;
  say(
    player,
    'dungeons.debug.status',
    String(enderPieces(player)),
    String(ENDER_PIECES.length),
    boost === undefined ? '-' : `${boost.amplifier + 1} (${Math.round(boost.duration / 20)} s)`,
    String(Math.round(health?.effectiveMax ?? 0)),
    (cooldownLeft(player) / 20).toFixed(1),
    String(beamCount()),
    String(tims.length),
    String(tamed),
  );
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:dungeons') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    const command = event.message.trim().split(/\s+/)[0];
    switch (command) {
      case 'give':
        give(player, FIREBRAND_ID);
        for (const [, id] of ENDER_PIECES) give(player, id);
        give(player, BEACON_ID);
        give(player, CARD_ID, 3);
        say(player, 'dungeons.debug.given');
        break;
      case 'status':
        status(player);
        break;
      case 'blink':
        say(player, blink(player, undefined) ? 'dungeons.debug.blink' : 'dungeons.debug.blink.none');
        break;
      case 'beam':
        forceFire(player);
        break;
      case 'tim':
        say(player, summonTim(player) === undefined ? 'dungeons.tim.failed' : 'dungeons.tim.summoned');
        break;
      default:
        say(player, 'dungeons.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
