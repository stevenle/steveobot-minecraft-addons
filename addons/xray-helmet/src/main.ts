/**
 * X-Ray Helmet — a craftable helmet that makes nearby gems glow while you mine.
 *
 * While a player wears the helmet below MINE_MAX_Y, the script periodically
 * scans the blocks around them and drops a `steveo:ore_marker` entity on each
 * ore it finds. The resource pack renders that entity as an emissive colored
 * outline with depth testing disabled, so the glow shows through solid stone.
 *
 * Marker lifecycle: the script keeps a map of live markers and re-triggers
 * each one's `steveo:refresh` event while its ore is still detected, which
 * resets a 6-second despawn timer in the entity definition. Anything the
 * script loses track of (chunk unload, world reload, script error) burns its
 * timer down and despawns on its own — markers can never permanently litter
 * the world.
 *
 * The scan runs inside `system.runJob` so a few thousand block lookups are
 * spread across ticks instead of stalling the server.
 */
import {
  EquipmentSlot,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('xray-helmet');

const HELMET_ID = 'steveo:xray_helmet';
const MARKER_ID = 'steveo:ore_marker';

/** At or above this Y the helmet stays quiet — it only works "in the mines". */
const MINE_MAX_Y = 60;

/** Horizontal / vertical scan reach, in blocks, around the player's head. */
const SCAN_RADIUS = 8;
const SCAN_RADIUS_Y = 6;

/** How often to start a scan, in ticks (20 ticks = 1 second). */
const SCAN_INTERVAL_TICKS = 40;

/** How often to check who is wearing the helmet. Kept much shorter than the
 * scan interval so the glow dies almost immediately when the helmet comes off. */
const EQUIP_CHECK_TICKS = 5;

/** Block lookups between yields inside the scan job. */
const BLOCKS_PER_YIELD = 64;

/** Most markers alive per scan area, so an ore-rich cave stays playable. */
const MAX_MARKERS = 16;

/** Ticks a marker survives without being re-detected by any scan. */
const MARKER_EXPIRE_TICKS = SCAN_INTERVAL_TICKS * 2 + 20;

/** Ores the helmet can sense, most valuable first — when there are more hits
 * than MAX_MARKERS, the valuable ones keep their glow. `label` matches the
 * marker entity's spawn events and its variant order in the render controller. */
const ORES: ReadonlyArray<{ label: string; blocks: readonly string[] }> = [
  {
    label: 'diamond',
    blocks: ['minecraft:diamond_ore', 'minecraft:deepslate_diamond_ore'],
  },
  {
    label: 'ancient_debris',
    blocks: ['minecraft:ancient_debris'],
  },
  {
    label: 'emerald',
    blocks: ['minecraft:emerald_ore', 'minecraft:deepslate_emerald_ore'],
  },
  {
    label: 'gold',
    blocks: ['minecraft:gold_ore', 'minecraft:deepslate_gold_ore', 'minecraft:nether_gold_ore'],
  },
  {
    label: 'lapis',
    blocks: ['minecraft:lapis_ore', 'minecraft:deepslate_lapis_ore'],
  },
  {
    label: 'redstone',
    blocks: [
      'minecraft:redstone_ore',
      'minecraft:deepslate_redstone_ore',
      'minecraft:lit_redstone_ore',
      'minecraft:lit_deepslate_redstone_ore',
    ],
  },
];

/** blockTypeId -> index into ORES, for O(1) lookups in the scan loop. */
const ORE_INDEX = new Map<string, number>();
ORES.forEach((ore, i) => ore.blocks.forEach((block) => ORE_INDEX.set(block, i)));

interface Marker {
  entity: Entity;
  lastSeen: number;
}

/** Live glow markers, keyed by dimension + block position. */
const markers = new Map<string, Marker>();

/** Players with a scan job in flight, so intervals never stack jobs. */
const scanning = new Set<string>();

/** Players who were wearing the helmet last check, to detect fresh equips. */
const wearing = new Set<string>();

function markerKey(dimensionId: string, pos: Vector3): string {
  return `${dimensionId}|${pos.x},${pos.y},${pos.z}`;
}

function isWearingHelmet(player: Player): boolean {
  const equippable = player.getComponent('minecraft:equippable');
  return equippable?.getEquipment(EquipmentSlot.Head)?.typeId === HELMET_ID;
}

function removeMarker(key: string, marker: Marker): void {
  markers.delete(key);
  try {
    if (marker.entity.isValid) marker.entity.remove();
  } catch {
    // Already gone or in an unloaded chunk; the entity's own timer covers it.
  }
}

/** Spawns or refreshes the glow marker for one detected ore block. */
function upsertMarker(dimension: Dimension, pos: Vector3, oreLabel: string): void {
  const key = markerKey(dimension.id, pos);
  const existing = markers.get(key);

  if (existing?.entity.isValid) {
    existing.entity.triggerEvent('steveo:refresh'); // reset the despawn timer
    existing.lastSeen = system.currentTick;
    return;
  }
  if (existing) markers.delete(key);

  try {
    const entity = dimension.spawnEntity(
      MARKER_ID,
      { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 },
      { spawnEvent: `steveo:${oreLabel}` },
    );
    markers.set(key, { entity, lastSeen: system.currentTick });
  } catch (err) {
    log.error(`failed to spawn marker at ${key}`, err);
  }
}

/** Scans the cube around the player and lights up the ores it finds.
 * With `report` set it also tells the player what it found, so
 * `/scriptevent steveo:xray` can be used to debug in-game. */
function* scanJob(player: Player, report = false): Generator<void, void, void> {
  try {
    const dimension: Dimension = player.dimension;
    const cx = Math.floor(player.location.x);
    const cy = Math.floor(player.location.y) + 1;
    const cz = Math.floor(player.location.z);

    const hits: Array<{ pos: Vector3; oreIndex: number; distSq: number }> = [];
    let checked = 0;

    for (let dy = -SCAN_RADIUS_Y; dy <= SCAN_RADIUS_Y; dy++) {
      for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
        for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
          if (++checked % BLOCKS_PER_YIELD === 0) yield;

          const pos = { x: cx + dx, y: cy + dy, z: cz + dz };
          let typeId: string | undefined;
          try {
            typeId = dimension.getBlock(pos)?.typeId;
          } catch {
            continue; // outside world bounds or in an unloaded chunk
          }
          if (typeId === undefined) continue;

          const oreIndex = ORE_INDEX.get(typeId);
          if (oreIndex === undefined) continue;

          hits.push({ pos, oreIndex, distSq: dx * dx + dy * dy + dz * dz });
        }
      }
    }

    if (!player.isValid) return;

    // Valuable ores first, then nearest first, and cap the entity count.
    hits.sort((a, b) => a.oreIndex - b.oreIndex || a.distSq - b.distSq);
    for (const hit of hits.slice(0, MAX_MARKERS)) {
      const ore = ORES[hit.oreIndex];
      if (ore) upsertMarker(dimension, hit.pos, ore.label);
    }

    if (report) {
      player.sendMessage({
        rawtext: [
          { text: `${Format.gray}[X-Ray Helmet]${Format.reset} ` },
          {
            translate: 'xray_helmet.debug.scan',
            with: [`${hits.length}`, `${Math.floor(player.location.y)}`, `${MINE_MAX_Y}`],
          },
        ],
      });
    }
  } catch (err) {
    log.error('scan failed', err);
  } finally {
    scanning.delete(player.id);
  }
}

/** Drops markers whose ore has not been re-detected recently. */
function expireMarkers(): void {
  const now = system.currentTick;
  for (const [key, marker] of markers) {
    if (!marker.entity.isValid || now - marker.lastSeen > MARKER_EXPIRE_TICKS) {
      removeMarker(key, marker);
    }
  }
}

function removeAllMarkers(): void {
  for (const [key, marker] of markers) removeMarker(key, marker);
}

// Fast loop: tracks who wears the helmet. The glow should die with the
// helmet, not linger until the markers' scan-based expiry catches up.
system.runInterval(() => {
  let anyWearing = false;
  let helmetCameOff = false;

  for (const player of world.getAllPlayers()) {
    const hasHelmet = isWearingHelmet(player);
    if (hasHelmet) anyWearing = true;

    if (hasHelmet && !wearing.has(player.id)) {
      wearing.add(player.id);
      player.sendMessage({
        rawtext: [
          { text: `${Format.gray}[X-Ray Helmet]${Format.reset} ` },
          { translate: 'xray_helmet.equipped' },
        ],
      });
    } else if (!hasHelmet && wearing.has(player.id)) {
      wearing.delete(player.id);
      helmetCameOff = true;
    }
  }

  if (helmetCameOff && !anyWearing) removeAllMarkers();
}, EQUIP_CHECK_TICKS);

// Slow loop: expiry plus one scan per wearing player.
system.runInterval(() => {
  expireMarkers();

  for (const player of world.getAllPlayers()) {
    if (!wearing.has(player.id)) continue;
    if (player.location.y >= MINE_MAX_Y) continue; // above ground: stay quiet
    if (scanning.has(player.id)) continue;

    scanning.add(player.id);
    system.runJob(scanJob(player));
  }
}, SCAN_INTERVAL_TICKS);

// A mined ore should stop glowing immediately, not when its marker expires.
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const key = markerKey(event.dimension.id, event.block.location);
  const marker = markers.get(key);
  if (marker) removeMarker(key, marker);
});

// Debug: `/scriptevent steveo:xray` spawns one test marker of each color in
// the air in front of the player (they burn down their own 6s timer), and
// runs a scan that reports its findings in chat. Boxes visible but no ore
// glow means the scan/gating side; no boxes at all means the resource pack
// is not rendering the marker entity.
system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'xray') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    const view = player.getViewDirection();
    const flat = Math.hypot(view.x, view.z) || 1;
    const fx = view.x / flat;
    const fz = view.z / flat;
    for (const [i, ore] of ORES.entries()) {
      const spread = (i - (ORES.length - 1) / 2) * 1.5;
      try {
        player.dimension.spawnEntity(
          MARKER_ID,
          {
            x: player.location.x + fx * 5 - fz * spread,
            y: player.location.y + 1,
            z: player.location.z + fz * 5 + fx * spread,
          },
          { spawnEvent: `steveo:${ore.label}` },
        );
      } catch (err) {
        log.error(`debug marker spawn failed for ${ore.label}`, err);
      }
    }
    player.sendMessage({
      rawtext: [
        { text: `${Format.gray}[X-Ray Helmet]${Format.reset} ` },
        { translate: 'xray_helmet.debug.markers' },
      ],
    });

    if (!scanning.has(player.id)) {
      scanning.add(player.id);
      system.runJob(scanJob(player, true));
    }
  },
  { namespaces: ['steveo'] },
);

world.afterEvents.playerLeave.subscribe((event) => {
  wearing.delete(event.playerId);
  scanning.delete(event.playerId);
});

log.info('loaded');
