/**
 * Boom Boom Factory floor boss pads (steveo:boss_pad_1 .. steveo:boss_pad_5).
 *
 * Each floor of the 5-story tower has a glowing Boss Pad in the center.
 * Right-click/tap the pad (works in Survival or Creative) OR walk within
 * 5 blocks in Survival/Adventure to trigger that floor's boss fight!
 * Once triggered, the pad turns into polished blackstone so each floor
 * summons its boss once.
 */
import { system, type Block, type Vector3 } from '@minecraft/server';

import {
  add,
  announceNear,
  BILLIP,
  isVulnerable,
  KING_VIKING,
  log,
  MEGA_ROBO,
  ROBO_RABBIT_BOY,
  SUPER_RABBIT_BOSS,
  VIKING_BOT,
} from './common';

const PAD_COMPONENT = 'steveo:boss_pad';
const SPENT_BLOCK = 'minecraft:polished_blackstone';
const WAKE_RANGE = 5.5;

interface FloorBossSpec {
  bossId: string;
  announceKey: string;
  guards?: number;
}

const FLOOR_PADS: Record<string, FloorBossSpec> = {
  'steveo:boss_pad_1': { bossId: ROBO_RABBIT_BOY, announceKey: 'super_rabbit.boss.floor1' },
  'steveo:boss_pad_2': { bossId: BILLIP, announceKey: 'super_rabbit.boss.floor2' },
  'steveo:boss_pad_3': { bossId: SUPER_RABBIT_BOSS, announceKey: 'super_rabbit.boss.floor3' },
  'steveo:boss_pad_4': { bossId: MEGA_ROBO, announceKey: 'super_rabbit.boss.floor4' },
  'steveo:boss_pad_5': { bossId: KING_VIKING, announceKey: 'super_rabbit.boss.floor5', guards: 2 },
};

function center(block: Block): Vector3 {
  return { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 };
}

function triggerPad(block: Block, requireVulnerablePlayer: boolean): void {
  const spec = FLOOR_PADS[block.typeId];
  if (!spec) return;
  const dim = block.dimension;
  const at = center(block);
  if (requireVulnerablePlayer) {
    const near = dim.getPlayers({ location: at, maxDistance: WAKE_RANGE }).filter(isVulnerable);
    if (near.length === 0) return;
  }
  const padId = block.typeId;
  const loc = block.location;
  system.run(() => {
    try {
      const current = dim.getBlock(loc);
      if (current?.typeId !== padId) return;
      current.setType(SPENT_BLOCK);
      const spawnPos = add(at, { x: 0, y: 1.1, z: 0 });
      dim.spawnEntity(spec.bossId, spawnPos);
      if (spec.guards) {
        for (const ox of [-2, 2]) {
          try {
            dim.spawnEntity(VIKING_BOT, add(spawnPos, { x: ox, y: 0, z: 0 }));
          } catch {
            // Guard spot blocked.
          }
        }
      }
      dim.spawnParticle('minecraft:large_explosion', spawnPos);
      dim.playSound('mob.enderdragon.growl', spawnPos, { volume: 2.0, pitch: 1.0 });
      announceNear(dim, spawnPos, 24, spec.announceKey);
    } catch (err) {
      log.warn(`triggering ${padId} failed: ${String(err)}`);
    }
  });
}

system.beforeEvents.startup.subscribe((event) => {
  event.blockComponentRegistry.registerCustomComponent(PAD_COMPONENT, {
    onTick: (e) => triggerPad(e.block, true),
    onRandomTick: (e) => triggerPad(e.block, true),
    onPlayerInteract: (e) => triggerPad(e.block, false),
  });
});
