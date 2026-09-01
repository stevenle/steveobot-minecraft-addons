/**
 * Hello World — the reference add-on for this repo.
 *
 * It is deliberately small, but exercises the whole pipeline: TypeScript that
 * is bundled into the behavior pack, a shared module imported through the
 * `@shared` alias, and chat strings translated from the resource pack.
 *
 * Try it in-game:
 *   - join a world with the pack enabled  -> you get a welcome message
 *   - run `/scriptevent steveo:hello`     -> the add-on answers
 */
import { Player, system, world, type RawMessage } from '@minecraft/server';

import { createLogger } from '@shared/log';

const log = createLogger('hello-world');

/** Script events are addressed as `/scriptevent steveo:<id>`. */
const NAMESPACE = 'steveo';

/** Greets a player using a key defined in the resource pack's en_US.lang. */
function greet(player: Player): void {
  player.sendMessage({ translate: 'hello_world.welcome', with: [player.name] });
}

/** Replies to whoever triggered a script event, or to the world if it was a command block. */
function reply(source: Player | undefined, message: RawMessage): void {
  if (source) {
    source.sendMessage(message);
  } else {
    world.sendMessage(message);
  }
}

world.afterEvents.playerSpawn.subscribe((event) => {
  // playerSpawn also fires on every respawn; only greet on the first join.
  if (!event.initialSpawn) return;
  greet(event.player);
  log.info(`greeted ${event.player.name}`);
});

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    const source = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;

    switch (command) {
      case 'hello':
        reply(source, { translate: 'hello_world.ping' });
        break;
      default:
        log.warn(`unhandled script event: ${event.id}`);
    }
  },
  // Without a namespace filter every script event in the world wakes this
  // handler up, including ones belonging to other add-ons.
  { namespaces: [NAMESPACE] },
);

log.info('loaded');
