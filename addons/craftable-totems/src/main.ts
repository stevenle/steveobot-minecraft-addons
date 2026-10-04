/**
 * Craftable Totems — a Totem of Undying crafts from eight gold ingots around
 * an emerald block. The recipe is behavior_pack/recipes/totem_of_undying.json;
 * this script only answers `/scriptevent steveo:totems` so a Realm, which has
 * no content log, can confirm the pack loaded.
 */
import { Player, system } from '@minecraft/server';

import { createLogger } from '@shared/log';

const log = createLogger('craftable-totems');

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:totems') return;
    if (!(event.sourceEntity instanceof Player)) return;
    event.sourceEntity.sendMessage({ translate: 'craftable_totems.debug.status' });
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
