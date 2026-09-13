/**
 * Backpack — a portable chest you carry in your inventory, like a shulker box
 * that never has to be placed.
 *
 * Bedrock cannot add inventory tabs, so the extra storage lives in a hidden
 * `steveo:backpack_storage` entity that has a 27-slot container. Each backpack
 * item remembers the id of its storage entity in a dynamic property, and the
 * entity spends its life parked in a "vault": a fixed spot far up in the
 * Overworld sky that the script keeps loaded with a ticking area, so the
 * entity can always be found no matter where its owner travels.
 *
 * Opening: the player uses the backpack from their hand. The script fetches
 * the storage entity and floats it in front of the player's face; tapping it
 * opens the familiar chest screen (the game handles that — it is a real
 * container). When the player walks away, no longer has the backpack, or a
 * couple of minutes pass, the entity goes back to the vault. Only the player
 * who opened a backpack can look inside it while it is out.
 *
 * Nothing here serializes items: the container is the storage, so
 * enchantments, names, shulker contents, and nested backpacks all survive
 * untouched. The one rule is that a backpack cannot be put inside itself;
 * the script ejects it back to the player if that happens.
 */
import {
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Container,
  type ContainerSlot,
  type Dimension,
  type Entity,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('backpack');
const PREFIX: RawMessage = { text: `${Format.gray}[Backpack]${Format.reset} ` };

const BACKPACK_ID = 'steveo:backpack';
const STORAGE_ID = 'steveo:backpack_storage';

/** Dynamic property on the backpack item: the id of its storage entity. */
const STORAGE_PROP = 'steveo:storage_entity';
/** Dynamic property on the storage entity: the tick it was last opened. Debug aid. */
const LAST_OPENED_PROP = 'steveo:last_opened';

/** Where storage entities wait when no one is using them. Far from anywhere
 * a player is likely to build, high in the sky, and kept loaded by the
 * ticking area below. Coordinates are kept modest so entity positions stay
 * precise. */
const VAULT: Vector3 = { x: 100_000, y: 200, z: 100_000 };
const VAULT_TICKING_AREA = 'steveo_backpack_vault';

/** How far in front of the eyes the backpack floats, and how much closer it
 * comes when a wall is in the way. */
const OPEN_DISTANCE = 1.4;
const WALL_GAP = 0.45;
const MIN_OPEN_DISTANCE = 0.5;

/** A floating backpack goes home when its owner is farther than this. */
const SESSION_RANGE = 4;
/** ...or when this many ticks have passed since it came out (2 minutes). */
const SESSION_MAX_TICKS = 20 * 120;
/** Poll cadence for open sessions and for the stray-entity sweep. */
const SESSION_TICKS = 10;
const SWEEP_TICKS = 100;

/** A storage entity that is "out" for a player. */
interface Session {
  playerId: string;
  entityId: string;
  openedTick: number;
}

/** Open sessions keyed by player id. At most one per player. */
const sessions = new Map<string, Session>();

// ---------- Helpers ----------

function overworld(): Dimension {
  return world.getDimension('overworld');
}

function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function say(player: Player, key: string, withArgs?: string[]): void {
  const message: RawMessage = withArgs ? { translate: key, with: withArgs } : { translate: key };
  player.sendMessage({ rawtext: [PREFIX, message] });
}

function actionBar(player: Player, key: string): void {
  player.onScreenDisplay.setActionBar({ translate: key });
}

function isBackpack(slot: ContainerSlot): boolean {
  return slot.hasItem() && slot.getItem()?.typeId === BACKPACK_ID;
}

/** The main-hand slot if it holds a backpack, else undefined. */
function heldBackpack(player: Player): ContainerSlot | undefined {
  const equippable = player.getComponent('minecraft:equippable');
  if (!equippable) return undefined;
  const slot = equippable.getEquipmentSlot(EquipmentSlot.Mainhand);
  return isBackpack(slot) ? slot : undefined;
}

function storageIdOf(slot: ContainerSlot): string | undefined {
  const id = slot.getDynamicProperty(STORAGE_PROP);
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** Whether the backpack tied to `storageId` is anywhere in the player's
 * inventory. Access to the storage lasts only as long as it is. */
function carries(player: Player, storageId: string): boolean {
  const inventory = player.getComponent('minecraft:inventory')?.container;
  if (!inventory) return false;
  for (let i = 0; i < inventory.size; i++) {
    const slot = inventory.getSlot(i);
    if (isBackpack(slot) && storageIdOf(slot) === storageId) return true;
  }
  return false;
}

function isAtVault(entity: Entity): boolean {
  return entity.dimension.id === overworld().id && distance(entity.location, VAULT) < 2;
}

function vaultLoaded(): boolean {
  try {
    return overworld().getBlock(VAULT) !== undefined;
  } catch {
    return false;
  }
}

/** Keeps the vault chunk loaded. Safe to call repeatedly: a second `add` with
 * the same name fails, and that failure is ignored. */
function ensureVaultTickingArea(): void {
  try {
    overworld().runCommand(
      `tickingarea add ${VAULT.x} ${VAULT.y} ${VAULT.z} ${VAULT.x} ${VAULT.y} ${VAULT.z} ${VAULT_TICKING_AREA} true`,
    );
    log.info('vault ticking area created');
  } catch {
    // Already exists (the normal case after the first run) or the world has
    // hit its ticking-area limit; the open flow reports the latter.
  }
}

function storageContainer(entity: Entity): Container | undefined {
  return entity.getComponent('minecraft:inventory')?.container;
}

function countItems(container: Container): number {
  let count = 0;
  for (let i = 0; i < container.size; i++) if (container.getItem(i)) count++;
  return count;
}

function parkEntity(entity: Entity): void {
  try {
    if (!entity.isValid) return;
    entity.teleport(VAULT, { dimension: overworld() });
  } catch (error) {
    log.warn(`could not park storage entity ${entity.id}: ${String(error)}`);
  }
}

/** Moves a backpack that ended up inside its own storage back to the player,
 * so it can never be sealed away with its own contents. */
function ejectSelf(entity: Entity, player: Player): void {
  const container = storageContainer(entity);
  const inventory = player.getComponent('minecraft:inventory')?.container;
  if (!container) return;
  let ejected = false;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId !== BACKPACK_ID || item.getDynamicProperty(STORAGE_PROP) !== entity.id) continue;
    container.setItem(i, undefined);
    if (inventory && inventory.emptySlotsCount > 0) inventory.addItem(item);
    else player.dimension.spawnItem(item, player.location);
    ejected = true;
  }
  if (ejected) say(player, 'backpack.self_nest');
}

/** Sends a floating backpack home. Ejects a self-nested backpack first, while
 * the player is still around to receive it. */
function endSession(playerId: string): void {
  const session = sessions.get(playerId);
  if (!session) return;
  sessions.delete(playerId);
  const entity = world.getEntity(session.entityId);
  if (!entity?.isValid) return;
  const player = world.getEntity(playerId);
  if (player instanceof Player && player.isValid) ejectSelf(entity, player);
  parkEntity(entity);
}

// ---------- Opening ----------

/** Where the backpack should float: in front of the eyes, pulled closer if a
 * block is in the way so it never spawns inside a wall. */
function floatLocation(player: Player): Vector3 {
  const head = player.getHeadLocation();
  const view = player.getViewDirection();
  let reach = OPEN_DISTANCE;
  const hit = player.getBlockFromViewDirection({ maxDistance: OPEN_DISTANCE + WALL_GAP, includeLiquidBlocks: false });
  if (hit) {
    const point = {
      x: hit.block.location.x + hit.faceLocation.x,
      y: hit.block.location.y + hit.faceLocation.y,
      z: hit.block.location.z + hit.faceLocation.z,
    };
    reach = Math.max(MIN_OPEN_DISTANCE, Math.min(reach, distance(head, point) - WALL_GAP));
  }
  // The entity's origin is its bottom; lift it so the bag is centered on the eyes.
  return { x: head.x + view.x * reach, y: head.y + view.y * reach - 0.35, z: head.z + view.z * reach };
}

function createStorage(player: Player, slot: ContainerSlot): Entity {
  const entity = player.dimension.spawnEntity(STORAGE_ID, player.location);
  slot.setDynamicProperty(STORAGE_PROP, entity.id);
  log.info(`created storage ${entity.id} for ${player.name}`);
  return entity;
}

/** Finds the backpack's storage entity, or explains to the player why it
 * cannot. Creates one only for a backpack that never had storage. */
function resolveStorage(player: Player, slot: ContainerSlot): Entity | undefined {
  const id = storageIdOf(slot);
  if (id === undefined) return createStorage(player, slot);

  const entity = world.getEntity(id);
  if (entity?.isValid) return entity;

  if (!vaultLoaded()) {
    // The vault chunk is not loaded (first run, or the ticking area is
    // missing), so the entity may simply be unreachable. Never replace it.
    ensureVaultTickingArea();
    say(player, 'backpack.unreachable');
    return undefined;
  }
  // The vault is loaded and the entity is not there: it is gone for good.
  say(player, 'backpack.lost');
  return undefined;
}

/** True if the player's floating backpack is out and under their crosshair,
 * meaning the use that just happened was the tap that opens it. */
function isTappingOwnBackpack(player: Player): boolean {
  const session = sessions.get(player.id);
  if (!session) return false;
  return player
    .getEntitiesFromViewDirection({ maxDistance: SESSION_RANGE })
    .some((hit) => hit.entity.id === session.entityId);
}

function openBackpack(player: Player, slot: ContainerSlot): void {
  // Re-using it while it is already out just refreshes the timer and position.
  endSession(player.id);

  const entity = resolveStorage(player, slot);
  if (!entity) return;
  entity.setDynamicProperty(LAST_OPENED_PROP, system.currentTick);

  const head = player.getHeadLocation();
  entity.teleport(floatLocation(player), { dimension: player.dimension, facingLocation: head });
  sessions.set(player.id, { playerId: player.id, entityId: entity.id, openedTick: system.currentTick });
  actionBar(player, 'backpack.tap');
  player.playSound('armor.equip_leather');
}

// ---------- Input ----------

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId !== BACKPACK_ID) return;
  const { source: player } = event;
  if (isTappingOwnBackpack(player)) return; // let the tap open the container
  const slot = heldBackpack(player);
  if (slot) openBackpack(player, slot);
});

/** Only the player who brought a backpack out may open it. */
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  if (event.target.typeId !== STORAGE_ID) return;
  const session = sessions.get(event.player.id);
  if (session && session.entityId === event.target.id) return;
  event.cancel = true;
  const { player } = event;
  system.run(() => actionBar(player, 'backpack.not_yours'));
});

// ---------- Housekeeping ----------

/** Ends sessions whose owner walked away, lost the backpack, or left. */
system.runInterval(() => {
  for (const [playerId, session] of sessions) {
    const player = world.getEntity(playerId);
    const entity = world.getEntity(session.entityId);
    if (!(player instanceof Player) || !player.isValid || !entity?.isValid) {
      sessions.delete(playerId);
      if (entity) parkEntity(entity);
      continue;
    }
    // Eject first, so a backpack dropped into itself is never parked inside.
    ejectSelf(entity, player);
    const inRange =
      entity.dimension.id === player.dimension.id && distance(entity.location, player.getHeadLocation()) <= SESSION_RANGE;
    const expired = system.currentTick - session.openedTick > SESSION_MAX_TICKS;
    if (!carries(player, session.entityId) || !inRange || expired) endSession(playerId);
  }
}, SESSION_TICKS);

/** Parks any loaded storage entity that is out without a session — left
 * behind by a crash, a reload mid-session, or a player who logged off. */
system.runInterval(() => {
  const out = new Set([...sessions.values()].map((s) => s.entityId));
  for (const dimensionId of ['overworld', 'nether', 'the_end']) {
    let entities: Entity[];
    try {
      entities = world.getDimension(dimensionId).getEntities({ type: STORAGE_ID });
    } catch {
      continue;
    }
    for (const entity of entities) {
      if (out.has(entity.id) || isAtVault(entity)) continue;
      parkEntity(entity);
    }
  }
}, SWEEP_TICKS);

world.afterEvents.playerLeave.subscribe((event) => {
  endSession(event.playerId);
});

world.afterEvents.worldLoad.subscribe(() => {
  ensureVaultTickingArea();
});

// ---------- Chat commands ----------

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'backpack') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    switch (event.message.trim()) {
      case 'open': {
        const slot = heldBackpack(player);
        if (slot) openBackpack(player, slot);
        else say(player, 'backpack.debug.status.none');
        break;
      }
      case 'give': {
        player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(BACKPACK_ID, 1));
        say(player, 'backpack.debug.given');
        break;
      }
      case 'status': {
        const slot = heldBackpack(player);
        if (!slot) {
          say(player, 'backpack.debug.status.none');
          break;
        }
        const id = storageIdOf(slot);
        const entity = id === undefined ? undefined : world.getEntity(id);
        const container = entity ? storageContainer(entity) : undefined;
        const storage = id === undefined ? 'not created yet' : entity ? `entity ${id}` : `missing (${id})`;
        const items = container ? `${countItems(container)}/${container.size}` : '?';
        say(player, 'backpack.debug.status', [storage, items, vaultLoaded() ? 'yes' : 'no']);
        break;
      }
      case 'reset': {
        const slot = heldBackpack(player);
        if (!slot) {
          say(player, 'backpack.debug.status.none');
          break;
        }
        endSession(player.id);
        const old = storageIdOf(slot);
        const entity = old === undefined ? undefined : world.getEntity(old);
        if (entity?.isValid) entity.remove();
        createStorage(player, slot);
        say(player, 'backpack.reset');
        break;
      }
      default:
        say(player, 'backpack.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
