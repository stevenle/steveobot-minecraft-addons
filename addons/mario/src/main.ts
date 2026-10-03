/**
 * Mario — Goombas, Koopa Troopas, Bob-ombs, Bowser in his castle, question
 * blocks, and three power-ups: the Squirrel Suit (fly), the Frog Suit (swim
 * and breathe underwater), and the Fire Flower (throw fireballs that do not
 * set anything alight).
 *
 * Each module subscribes its own events on import:
 *   mobs.ts     sunset Goombas, Koopa shells, stomping
 *   bowser.ts   the castle seal that raises Bowser, and his fire breath
 *   fireball.ts the simulated fireballs both Fire Flower and Bowser use
 *   suits.ts    Squirrel Suit flight, Frog Suit effects
 *   items.ts    Fire Flower throwing, the question block's coin sound
 *
 * Bob-ombs need no script: entities/bomb_guy.json is a creeper.
 */
import { ItemStack, Player, system, world, type Vector3 } from '@minecraft/server';

import { add, log, say, scale } from './common';
import { fireballCount } from './fireball';
import { BOMB_GUY, GOOMBA, hideInShell, isSunset, KOOPA, spawnConfusedGoomba } from './mobs';
import { BOWSER, bowserCount, breatheFire, raiseBowser } from './bowser';
import { FROG_SUIT, SQUIRREL_SUIT, suitOf } from './suits';
import { FIRE_FLOWER, QUESTION_BLOCK } from './items';

const CASTLE = 'steveo:bowser_castle';
const QUESTION_ROW = 'steveo:question_row';
/** Castle footprint, from assets/generate.mjs: 23 wide, gate at z = 0, floor at y = 4. */
const CASTLE_HALF_WIDTH = 11;
const CASTLE_FLOOR = 4;

// ---------- debug: /scriptevent steveo:mario <give|castle|row|goomba|koopa|shell|bomb|bowser|breath|sunset|status> ----------

function inFront(player: Player, distance: number): Vector3 {
  const view = player.getViewDirection();
  const flat = { x: view.x, y: 0, z: view.z };
  const len = Math.hypot(flat.x, flat.z) || 1;
  return add(player.location, scale(flat, distance / len));
}

function spawnInFront(player: Player, id: string): void {
  try {
    player.dimension.spawnEntity(id, inFront(player, 4));
  } catch (err) {
    say(player, 'mario.debug.failed', err instanceof Error ? err.message : String(err));
  }
}

function place(player: Player, structure: string, origin: Vector3): void {
  try {
    world.structureManager.place(structure, player.dimension, origin);
    say(player, `mario.debug.placed.${structure === CASTLE ? 'castle' : 'row'}`);
  } catch (err) {
    log.error(`could not place ${structure}`, err);
    say(player, 'mario.debug.failed', err instanceof Error ? err.message : String(err));
  }
}

function floored(v: Vector3): Vector3 {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:mario') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;
    const feet = floored(player.location);

    switch (event.message.trim()) {
      case 'give': {
        const container = player.getComponent('minecraft:inventory')?.container;
        for (const id of [FIRE_FLOWER, SQUIRREL_SUIT, FROG_SUIT]) container?.addItem(new ItemStack(id, 1));
        container?.addItem(new ItemStack(QUESTION_BLOCK, 8));
        say(player, 'mario.debug.given');
        break;
      }
      case 'castle':
        // Gate two blocks in front (+z), centered on the player, floor at their feet.
        place(player, CASTLE, { x: feet.x - CASTLE_HALF_WIDTH, y: feet.y - 1 - CASTLE_FLOOR, z: feet.z + 2 });
        break;
      case 'row':
        place(player, QUESTION_ROW, { x: feet.x - 2, y: feet.y + 3, z: feet.z + 2 });
        break;
      case 'goomba':
        spawnInFront(player, GOOMBA);
        break;
      case 'koopa':
        spawnInFront(player, KOOPA);
        break;
      case 'shell': {
        const koopa = player.dimension.getEntities({ type: KOOPA, location: player.location, maxDistance: 16, closest: 1 })[0];
        say(player, koopa && hideInShell(koopa) ? 'mario.debug.shell' : 'mario.debug.shell.none');
        break;
      }
      case 'bomb':
        spawnInFront(player, BOMB_GUY);
        break;
      case 'bowser':
        raiseBowser(player.dimension.id, inFront(player, 6));
        break;
      case 'breath': {
        const bowser = player.dimension.getEntities({ type: BOWSER, location: player.location, maxDistance: 32, closest: 1 })[0];
        if (bowser) breatheFire(bowser, player, false);
        else say(player, 'mario.debug.breath.none');
        break;
      }
      case 'sunset': {
        world.setTimeOfDay(11800);
        const goomba = spawnConfusedGoomba(player);
        say(player, goomba ? 'mario.debug.sunset' : 'mario.debug.sunset.none');
        break;
      }
      case 'status': {
        const near = (type: string) =>
          `${player.dimension.getEntities({ type, location: player.location, maxDistance: 64 }).length}`;
        say(player, 'mario.debug.status',
          near(GOOMBA), near(KOOPA), near(BOMB_GUY), `${bowserCount()}`, `${fireballCount()}`,
          `${world.getTimeOfDay()}`, isSunset() ? 'yes' : 'no', suitOf(player) ?? '-');
        break;
      }
      default:
        say(player, 'mario.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
