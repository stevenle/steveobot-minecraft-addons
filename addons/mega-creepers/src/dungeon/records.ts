/**
 * What the world remembers about each creeper dungeon, in world dynamic
 * properties so it survives restarts:
 *
 *   steveo:mc:dungeon:<id>     the dungeon record (JSON)
 *   steveo:mc:region:<rx>,<rz> 'built' or 'none', so a region is surveyed once
 *   steveo:mc:salt             a random number that makes this world's
 *                              dungeon sites differ from every other world's
 *
 * Records are loaded into memory once the world has loaded.
 */
import { world, type Vector3 } from '@minecraft/server';

import { log } from '../common';
import type { Box, RoomInfo, TrapInfo } from './layout';

export type BossState = 'asleep' | 'awake' | 'defeated';

export interface DungeonRecord {
  id: string;
  dimension: string;
  rooms: RoomInfo[];
  traps: TrapInfo[];
  vault: Box;
  door: Box;
  boss: Vector3;
  bossState: BossState;
  sealed: boolean;
}

const DUNGEON_PREFIX = 'steveo:mc:dungeon:';
const REGION_PREFIX = 'steveo:mc:region:';
const SALT_KEY = 'steveo:mc:salt';

const dungeons = new Map<string, DungeonRecord>();
let loaded = false;

export function isLoaded(): boolean {
  return loaded;
}

export function allDungeons(): Iterable<DungeonRecord> {
  return dungeons.values();
}

export function dungeonCount(): number {
  return dungeons.size;
}

export function getDungeon(id: string): DungeonRecord | undefined {
  return dungeons.get(id);
}

export function saveDungeon(record: DungeonRecord): void {
  dungeons.set(record.id, record);
  try {
    world.setDynamicProperty(DUNGEON_PREFIX + record.id, JSON.stringify(record));
  } catch (err) {
    log.error(`saving dungeon ${record.id}`, err);
  }
}

export function regionStatus(rx: number, rz: number): string | undefined {
  const value = world.getDynamicProperty(`${REGION_PREFIX}${rx},${rz}`);
  return typeof value === 'string' ? value : undefined;
}

export function setRegionStatus(rx: number, rz: number, status: 'built' | 'none'): void {
  world.setDynamicProperty(`${REGION_PREFIX}${rx},${rz}`, status);
}

export function worldSalt(): number {
  const value = world.getDynamicProperty(SALT_KEY);
  if (typeof value === 'number') return value;
  const salt = Math.floor(Math.random() * 0x7fffffff);
  world.setDynamicProperty(SALT_KEY, salt);
  return salt;
}

world.afterEvents.worldLoad.subscribe(() => {
  for (const id of world.getDynamicPropertyIds()) {
    if (!id.startsWith(DUNGEON_PREFIX)) continue;
    const raw = world.getDynamicProperty(id);
    if (typeof raw !== 'string') continue;
    try {
      const record = JSON.parse(raw) as DungeonRecord;
      dungeons.set(record.id, record);
    } catch (err) {
      log.warn(`bad dungeon record ${id}: ${String(err)}`);
    }
  }
  loaded = true;
  log.info(`loaded ${dungeons.size} creeper dungeon(s)`);
});
