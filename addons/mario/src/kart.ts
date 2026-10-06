/**
 * The Mario Kart. Driving is all data-driven (entities/kart.json): the kart
 * is rideable and `input_ground_controlled`, so the driver steers with the
 * movement keys and the camera, like a horse. The kart item places one, and
 * punching the kart breaks it back into the item.
 *
 * The script only explains the controls the first time a player gets in.
 */
import { system, world } from '@minecraft/server';

import { say } from './common';

export const KART = 'steveo:kart';

const RIDE_CHECK_TICKS = 10;

const hinted = new Set<string>();

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (hinted.has(player.id)) continue;
    try {
      if (player.getComponent('minecraft:riding')?.entityRidingOn.typeId !== KART) continue;
      hinted.add(player.id);
      say(player, 'mario.hint.kart');
    } catch {
      // Player is mid-respawn, or the kart just broke.
    }
  }
}, RIDE_CHECK_TICKS);

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
});
