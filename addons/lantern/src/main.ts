/**
 * Lantern — a Hand Lantern you hold in your off-hand (or main hand) that
 * lights up the area around you as you walk.
 *
 * Bedrock has no dynamic lighting, so the light is faked: an invisible
 * `light_block_15` is kept in the air cell at the player's head and moved
 * along as they walk. Lights only ever replace air, and are only ever removed
 * when the cell still holds our light block, so a lantern can never eat a
 * block the player placed.
 *
 * Every light currently in the world is recorded in a world dynamic property.
 * If the world shuts down or a player logs off with a lantern lit, the light
 * stays behind; on the next load those positions are swept back to air as
 * their chunks come into range.
 */
import {
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Block,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';

const log = createLogger('lantern');

const LANTERN_ID = 'steveo:lantern';
const LIGHT_ID = 'minecraft:light_block_15';
/** World dynamic property holding the JSON array of lights placed by lanterns. */
const LIGHTS_PROP = 'steveo:lantern_lights';
const TICK_INTERVAL = 2;
/** How often to retry stale lights whose chunks were not loaded. */
const SWEEP_INTERVAL = 100;

interface Light {
  dimension: string;
  x: number;
  y: number;
  z: number;
}

/** The light each player's lantern currently holds, by player id. */
const active = new Map<string, Light>();
/** Lights left over from a previous session or a departed player. */
let stale: Light[] = [];

function sameLight(a: Light, b: Light): boolean {
  return a.dimension === b.dimension && a.x === b.x && a.y === b.y && a.z === b.z;
}

function getBlock(light: Light): Block | undefined {
  try {
    return world.getDimension(light.dimension).getBlock(light);
  } catch {
    // Unloaded chunk or outside the world's height range.
    return undefined;
  }
}

function save(): void {
  const all = [...active.values(), ...stale];
  world.setDynamicProperty(LIGHTS_PROP, JSON.stringify(all));
}

function load(): Light[] {
  const raw = world.getDynamicProperty(LIGHTS_PROP);
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Light[]) : [];
  } catch (error) {
    log.error('discarding unreadable light list', error);
    return [];
  }
}

/**
 * Turns a light back into air. Returns false when its chunk is not loaded, so
 * the caller can try again later.
 */
function extinguish(light: Light): boolean {
  const block = getBlock(light);
  if (!block) return false;
  if (block.typeId === LIGHT_ID) block.setType('minecraft:air');
  return true;
}

function isHoldingLantern(player: Player): boolean {
  const equippable = player.getComponent('minecraft:equippable');
  if (!equippable) return false;
  return (
    equippable.getEquipment(EquipmentSlot.Offhand)?.typeId === LANTERN_ID ||
    equippable.getEquipment(EquipmentSlot.Mainhand)?.typeId === LANTERN_ID
  );
}

/**
 * Picks the cell to light: the head, or the feet when the head is in a block
 * (crawling, swimming through a gap). Returns undefined when neither is air,
 * e.g. underwater.
 */
function lightCellFor(player: Player): { light: Light; block: Block } | undefined {
  const head = player.getHeadLocation();
  const feet = player.location;
  const candidates: Vector3[] = [head, { x: feet.x, y: feet.y + 0.5, z: feet.z }];
  for (const at of candidates) {
    const light: Light = {
      dimension: player.dimension.id,
      x: Math.floor(at.x),
      y: Math.floor(at.y),
      z: Math.floor(at.z),
    };
    const block = getBlock(light);
    if (block && (block.isAir || block.typeId === LIGHT_ID)) return { light, block };
  }
  return undefined;
}

function updatePlayer(player: Player): boolean {
  const previous = active.get(player.id);
  const target = isHoldingLantern(player) ? lightCellFor(player) : undefined;

  if (target) {
    // Re-place even when unmoved: another lantern may have cleared this cell.
    if (target.block.typeId !== LIGHT_ID) target.block.setType(LIGHT_ID);
    if (previous && sameLight(previous, target.light)) return false;
    active.set(player.id, target.light);
  } else {
    if (!previous) return false;
    active.delete(player.id);
  }

  if (previous && !extinguish(previous)) stale.push(previous);
  return true;
}

function tick(): void {
  let changed = false;
  for (const player of world.getPlayers()) {
    try {
      if (updatePlayer(player)) changed = true;
    } catch (error) {
      log.error(`update failed for ${player.name}`, error);
    }
  }
  if (changed) save();
}

function sweep(): void {
  if (stale.length === 0) return;
  const before = stale.length;
  // Never sweep a cell a lit lantern is using right now.
  stale = stale.filter((light) => [...active.values()].some((a) => sameLight(a, light)) || !extinguish(light));
  if (stale.length !== before) save();
}

world.afterEvents.worldLoad.subscribe(() => {
  stale = load();
  sweep();
  system.runInterval(tick, TICK_INTERVAL);
  system.runInterval(sweep, SWEEP_INTERVAL);
});

world.afterEvents.playerLeave.subscribe((event) => {
  const light = active.get(event.playerId);
  if (!light) return;
  active.delete(event.playerId);
  if (!extinguish(light)) stale.push(light);
  save();
});

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:lantern') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    system.run(() => {
      player.getComponent('inventory')?.container.addItem(new ItemStack(LANTERN_ID));
      player.sendMessage({
        translate: 'lantern.debug.status',
        with: [String(active.size), String(stale.length)],
      });
    });
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
