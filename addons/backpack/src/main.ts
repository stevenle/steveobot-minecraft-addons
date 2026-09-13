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
 * Opening: the player uses the backpack from their hand and a chest-styled
 * form opens at once (see chest-ui/chest-form.ts). The top grid shows the
 * backpack, the bottom mirrors the player's inventory, and tapping an item
 * moves it across; the form re-opens after every move until the player
 * closes it. Items move with `Container.transferItem`, so enchantments,
 * names, shulker contents, and nested backpacks all survive untouched. The
 * one rule is that a backpack cannot be put inside itself.
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
import { FormCancelationReason } from '@minecraft/server-ui';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

import { CHEST_27_SLOTS, ChestForm, describeItem } from './chest-ui/chest-form.js';

const log = createLogger('backpack');
const PREFIX: RawMessage = { text: `${Format.gray}[Backpack]${Format.reset} ` };

const BACKPACK_ID = 'steveo:backpack';
const STORAGE_ID = 'steveo:backpack_storage';

/** Dynamic property on the backpack item: the id of its storage entity. */
const STORAGE_PROP = 'steveo:storage_entity';
/** Dynamic property on the storage entity: the tick it was last opened. Debug aid. */
const LAST_OPENED_PROP = 'steveo:last_opened';

/** Where storage entities live. Far from anywhere a player is likely to
 * build, high in the sky, and kept loaded by the ticking area below.
 * Coordinates are kept modest so entity positions stay precise. */
const VAULT: Vector3 = { x: 100_000, y: 200, z: 100_000 };
const VAULT_TICKING_AREA = 'steveo_backpack_vault';

/** How often to park storage entities that are loaded but not at the vault. */
const SWEEP_TICKS = 100;

/** How many times to retry opening the form when the player is busy with
 * another screen (the use often lands while the previous form is closing). */
const BUSY_RETRIES = 4;
const BUSY_RETRY_TICKS = 5;

/** Players with a backpack form open, so a use cannot stack a second one. */
const browsing = new Set<string>();

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

function wait(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
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

function playerInventory(player: Player): Container | undefined {
  return player.getComponent('minecraft:inventory')?.container;
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

function createStorage(player: Player, slot: ContainerSlot): Entity {
  const entity = overworld().spawnEntity(STORAGE_ID, vaultLoaded() ? VAULT : player.location);
  if (!isAtVault(entity)) parkEntity(entity);
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

// ---------- The form ----------

function buildForm(bag: Container, inventory: Container): ChestForm {
  const form = new ChestForm({ translate: 'item.steveo:backpack.name' });
  for (let i = 0; i < CHEST_27_SLOTS; i++) {
    const item = i < bag.size ? bag.getItem(i) : undefined;
    form.slot(item ? describeItem(item) : undefined);
  }
  for (let i = 0; i < inventory.size; i++) {
    const item = inventory.getItem(i);
    form.slot(item ? describeItem(item) : undefined);
  }
  return form;
}

/** Moves the item in `from[slot]` into `to`, telling the player if it did
 * not all fit. */
function move(player: Player, from: Container, slot: number, to: Container, fullKey: string): void {
  const leftover = from.transferItem(slot, to);
  if (leftover) actionBar(player, fullKey);
  else player.playSound('random.pop');
}

/** Shows the backpack and keeps re-showing it after each move until the
 * player closes it. */
async function browse(player: Player): Promise<void> {
  if (browsing.has(player.id)) return;
  browsing.add(player.id);
  try {
    let busyRetries = BUSY_RETRIES;
    while (player.isValid) {
      const slot = heldBackpack(player);
      if (!slot) return;
      const storage = resolveStorage(player, slot);
      if (!storage) return;
      const bag = storageContainer(storage);
      const inventory = playerInventory(player);
      if (!bag || !inventory) return;
      storage.setDynamicProperty(LAST_OPENED_PROP, system.currentTick);

      const response = await buildForm(bag, inventory).show(player);
      if (response.canceled) {
        if (response.cancelationReason === FormCancelationReason.UserBusy && busyRetries-- > 0) {
          await wait(BUSY_RETRY_TICKS);
          continue;
        }
        return;
      }
      busyRetries = BUSY_RETRIES;
      const selection = response.selection;
      if (selection === undefined || !player.isValid || !storage.isValid) return;

      if (selection < CHEST_27_SLOTS) {
        if (bag.getItem(selection)) move(player, bag, selection, inventory, 'backpack.inventory_full');
        continue;
      }
      const invSlot = selection - CHEST_27_SLOTS;
      const item = inventory.getItem(invSlot);
      if (!item) continue;
      if (item.typeId === BACKPACK_ID && item.getDynamicProperty(STORAGE_PROP) === storage.id) {
        actionBar(player, 'backpack.self_nest');
        continue;
      }
      move(player, inventory, invSlot, bag, 'backpack.full');
    }
  } catch (error) {
    log.error('backpack form failed', error);
  } finally {
    browsing.delete(player.id);
  }
}

// ---------- Events ----------

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId !== BACKPACK_ID) return;
  void browse(event.source);
});

/** Storage entities are never opened directly; the form is the only door. */
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  if (event.target.typeId === STORAGE_ID) event.cancel = true;
});

/** Parks any loaded storage entity that is away from the vault — left out by
 * an older version of this add-on, or spawned before the vault was loaded. */
system.runInterval(() => {
  for (const dimensionId of ['overworld', 'nether', 'the_end']) {
    let entities: Entity[];
    try {
      entities = world.getDimension(dimensionId).getEntities({ type: STORAGE_ID });
    } catch {
      continue;
    }
    for (const entity of entities) {
      if (!isAtVault(entity)) parkEntity(entity);
    }
  }
}, SWEEP_TICKS);

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
        if (heldBackpack(player)) void browse(player);
        else say(player, 'backpack.debug.status.none');
        break;
      }
      case 'give': {
        playerInventory(player)?.addItem(new ItemStack(BACKPACK_ID, 1));
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
