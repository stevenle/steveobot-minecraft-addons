/**
 * Lantern — a Hand Lantern you hold in your off-hand (or main hand) that
 * lights up the area around you as you walk.
 *
 * The moving light itself lives in `@shared/light`: an invisible light block
 * kept at the holder's head, recorded in a world dynamic property so leftover
 * lights are cleaned up on the next load.
 */
import { EquipmentSlot, ItemStack, Player, system } from '@minecraft/server';

import { installFollowLight } from '@shared/light';
import { createLogger } from '@shared/log';

const log = createLogger('lantern');

const LANTERN_ID = 'steveo:lantern';
/** World dynamic property holding the JSON array of lights placed by lanterns. */
const LIGHTS_PROP = 'steveo:lantern_lights';

function isHoldingLantern(player: Player): boolean {
  const equippable = player.getComponent('minecraft:equippable');
  if (!equippable) return false;
  return (
    equippable.getEquipment(EquipmentSlot.Offhand)?.typeId === LANTERN_ID ||
    equippable.getEquipment(EquipmentSlot.Mainhand)?.typeId === LANTERN_ID
  );
}

const lights = installFollowLight({ property: LIGHTS_PROP, shouldLight: isHoldingLantern, log });

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:lantern') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    system.run(() => {
      player.getComponent('inventory')?.container.addItem(new ItemStack(LANTERN_ID));
      player.sendMessage({
        translate: 'lantern.debug.status',
        with: [String(lights.lit), String(lights.stale)],
      });
    });
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
