/**
 * Golden Beetroot — a food that fills 7.5 hunger (15 points), crafted from
 * eight gold ingots around a beetroot. The item and recipe are pure data in
 * behavior_pack/; this script only answers `/scriptevent steveo:beetroot` so a
 * Realm, which has no content log, can confirm the pack loaded.
 */
import { ItemStack, Player, system } from '@minecraft/server';

import { createLogger } from '@shared/log';

const log = createLogger('golden-beetroot');

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:beetroot') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    system.run(() => {
      player.getComponent('inventory')?.container.addItem(new ItemStack('steveo:golden_beetroot'));
      player.sendMessage({ translate: 'golden_beetroot.debug.given' });
    });
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
