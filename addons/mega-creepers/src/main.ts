/**
 * Mega Creepers — a Mega Creeper boss guarding creeper dungeons, and
 * creeperite: blast-proof stone, ore, tools, and armor. Each part lives in
 * its own module; this file wires them up and adds the debug command, since
 * chat is the only console on a Realm.
 *
 *   /scriptevent steveo:megacreepers give       creeperite gear, ingots, raw ore, and every block
 *   /scriptevent steveo:megacreepers status     nearest dungeon, boss state, your armor pieces
 *   /scriptevent steveo:megacreepers build      build a dungeon around you (you stand in the entry hall)
 *   /scriptevent steveo:megacreepers boss       spawn a Mega Creeper in front of you
 *   /scriptevent steveo:megacreepers fireworks  make the nearest Mega Creeper launch a barrage now
 *   /scriptevent steveo:megacreepers explode    set off your creeperite armor
 *   /scriptevent steveo:megacreepers unseal     open the nearest dungeon's vault
 *   /scriptevent steveo:megacreepers rearm      put the nearest dungeon's boss back to sleep
 */
import { EntityComponentTypes, Player, system, type Vector3 } from '@minecraft/server';

import { ARMOR_PIECES, armorBlast, creeperitePieces } from './armor';
import { allBosses, bossState, forceBarrage, HOME_PROPERTY } from './boss';
import { distance, give, log, MEGA_CREEPER, say } from './common';
import { unseal } from './dungeon/encounters';
import { buildNow, isBusy } from './dungeon/generator';
import { allDungeons, dungeonCount, saveDungeon, type DungeonRecord } from './dungeon/records';
import './tools';

const GEAR = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'].map((tool) => `steveo:creeperite_${tool}`);
const BLOCK_IDS = [
  'creeperite',
  'polished_creeperite',
  'creeperite_bricks',
  'cracked_creeperite_bricks',
  'carved_creeperite_bricks',
  'creeperite_block',
  'creeperite_ore',
].map((block) => `steveo:${block}`);

function nearestDungeon(player: Player): DungeonRecord | undefined {
  let best: DungeonRecord | undefined;
  let bestDistance = Infinity;
  for (const record of allDungeons()) {
    if (record.dimension !== player.dimension.id) continue;
    const d = distance(player.location, record.boss);
    if (d < bestDistance) {
      best = record;
      bestDistance = d;
    }
  }
  return best;
}

function ahead(player: Player, blocks: number): Vector3 {
  const view = player.getViewDirection();
  const length = Math.hypot(view.x, view.z) || 1;
  return {
    x: player.location.x + (view.x / length) * blocks,
    y: player.location.y,
    z: player.location.z + (view.z / length) * blocks,
  };
}

function status(player: Player): void {
  const record = nearestDungeon(player);
  if (record === undefined) {
    say(player, 'megacreepers.debug.no_dungeon', String(dungeonCount()));
  } else {
    const { x, y, z } = record.boss;
    say(
      player,
      'megacreepers.debug.dungeon',
      String(dungeonCount()),
      `${x} ${y} ${z}`,
      String(Math.round(distance(player.location, record.boss))),
      record.bossState,
      record.sealed ? 'sealed' : 'open',
    );
  }
  const boss = allBosses()
    .filter((b) => b.dimension.id === player.dimension.id)
    .sort((a, b) => distance(a.location, player.location) - distance(b.location, player.location))[0];
  if (boss !== undefined) {
    const health = boss.getComponent(EntityComponentTypes.Health);
    say(
      player,
      'megacreepers.debug.boss',
      String(Math.round(distance(boss.location, player.location))),
      String(bossState(boss) ?? '-'),
      `${Math.round(health?.currentValue ?? 0)}/${Math.round(health?.effectiveMax ?? 0)}`,
    );
  }
  say(player, 'megacreepers.debug.armor', String(creeperitePieces(player)), String(ARMOR_PIECES.length), isBusy() ? 'yes' : 'no');
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:megacreepers') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    const command = event.message.trim().split(/\s+/)[0];
    switch (command) {
      case 'give':
        for (const id of GEAR) give(player, id);
        for (const [, id] of ARMOR_PIECES) give(player, id);
        give(player, 'steveo:creeperite_ingot', 32);
        give(player, 'steveo:raw_creeperite', 16);
        for (const id of BLOCK_IDS) give(player, id, 16);
        say(player, 'megacreepers.debug.given');
        break;
      case 'status':
        status(player);
        break;
      case 'build': {
        // Put the player in the middle of the entry hall, facing the arena to the north.
        const at = player.location;
        const origin = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) - 21 };
        say(player, buildNow(player.dimension, origin) ? 'megacreepers.debug.building' : 'megacreepers.debug.busy');
        break;
      }
      case 'boss': {
        const at = ahead(player, 6);
        try {
          const boss = player.dimension.spawnEntity(MEGA_CREEPER, at);
          boss.setDynamicProperty(HOME_PROPERTY, JSON.stringify(at));
          say(player, 'megacreepers.debug.boss_spawned');
        } catch (err) {
          log.warn(`debug boss: ${String(err)}`);
        }
        break;
      }
      case 'fireworks': {
        const boss = allBosses()
          .filter((b) => b.dimension.id === player.dimension.id)
          .sort((a, b) => distance(a.location, player.location) - distance(b.location, player.location))[0];
        if (boss === undefined) {
          say(player, 'megacreepers.debug.no_boss');
          break;
        }
        forceBarrage(boss);
        break;
      }
      case 'explode':
        armorBlast(player);
        break;
      case 'unseal': {
        const record = nearestDungeon(player);
        if (record === undefined) {
          say(player, 'megacreepers.debug.no_dungeon', String(dungeonCount()));
          break;
        }
        unseal(record);
        say(player, 'megacreepers.debug.unsealed');
        break;
      }
      case 'rearm': {
        const record = nearestDungeon(player);
        if (record === undefined) {
          say(player, 'megacreepers.debug.no_dungeon', String(dungeonCount()));
          break;
        }
        record.bossState = 'asleep';
        saveDungeon(record);
        say(player, 'megacreepers.debug.rearmed');
        break;
      }
      default:
        say(player, 'megacreepers.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
