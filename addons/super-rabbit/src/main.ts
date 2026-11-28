/**
 * Super Rabbit Addon — Singing Dog, Billip, King Viking and his robot army,
 * King Viking's crew bosses, and the 5-floor Boom Boom Factory tower.
 */
import { Player, system, world, type Vector3 } from '@minecraft/server';

import { boltCount } from './bolts';
import {
  add,
  BILLIP,
  CREW_BOSSES,
  KING_VIKING,
  log,
  MEGA_ROBO,
  ROBO_CRAB,
  ROBO_LIZARD,
  ROBO_RABBIT_BOY,
  ROCKET_ROBO,
  say,
  scale,
  SINGING_DOG,
  SUPER_RABBIT_BOSS,
  VIKING_BOT,
} from './common';
import './factory';
import './mobs';

const FACTORY = 'steveo:boom_boom_factory';
/** Structure footprint from assets/generate.mjs: 19 wide, gate at z = 0, floor 1 at y = 4. */
const FACTORY_HALF_WIDTH = 9;
const FACTORY_FLOOR = 4;

const SPAWN_COMMANDS: Record<string, string> = {
  singing_dog: SINGING_DOG,
  viking_bot: VIKING_BOT,
  robo_crab: ROBO_CRAB,
  robo_lizard: ROBO_LIZARD,
  rocket_robo: ROCKET_ROBO,
  king_viking: KING_VIKING,
  billip: BILLIP,
  robo_rabbit_boy: ROBO_RABBIT_BOY,
  super_rabbit_boss: SUPER_RABBIT_BOSS,
  mega_robo: MEGA_ROBO,
};

function inFront(player: Player, distance: number): Vector3 {
  const view = player.getViewDirection();
  const flat = { x: view.x, y: 0, z: view.z };
  const len = Math.hypot(flat.x, flat.z) || 1;
  return add(player.location, scale(flat, distance / len));
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:super_rabbit') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;
    const cmd = event.message.trim();

    if (cmd === 'factory') {
      const feet = {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z),
      };
      try {
        world.structureManager.place(FACTORY, player.dimension, {
          x: feet.x - FACTORY_HALF_WIDTH,
          y: feet.y - 1 - FACTORY_FLOOR,
          z: feet.z + 3,
        });
        say(player, 'super_rabbit.debug.placed.factory');
      } catch (err) {
        log.error('could not place Boom Boom Factory', err);
        say(player, 'super_rabbit.debug.failed', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (cmd === 'status') {
      const count = (type: string) =>
        player.dimension.getEntities({ type, location: player.location, maxDistance: 64 }).length;
      const robots = count(VIKING_BOT) + count(ROBO_CRAB) + count(ROBO_LIZARD) + count(ROCKET_ROBO);
      const bosses = CREW_BOSSES.reduce((n, id) => n + count(id), 0);
      say(
        player,
        'super_rabbit.debug.status',
        `${count(SINGING_DOG)}`,
        `${robots}`,
        `${count(KING_VIKING)}`,
        `${bosses}`,
        `${boltCount()}`,
      );
      return;
    }

    const entityId = SPAWN_COMMANDS[cmd];
    if (entityId) {
      try {
        player.dimension.spawnEntity(entityId, inFront(player, 4));
      } catch (err) {
        say(player, 'super_rabbit.debug.failed', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    say(player, 'super_rabbit.debug.help');
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
