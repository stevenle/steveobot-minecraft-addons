import { world } from '@minecraft/server';

import { createLogger } from '@shared/log';
import { tell } from '@shared/chat';

const log = createLogger('{{SLUG}}');
const TAG = '{{NAME}}';

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  tell(event.player, TAG, 'This add-on is loaded.');
});

log.info('loaded');
