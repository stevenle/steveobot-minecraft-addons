/**
 * Uncrafting — the Uncrafting Table breaks a crafted item back down into the
 * ingredients its crafting recipe used.
 *
 * Hold an item and use the table: a menu laid out like a crafting table run
 * backwards shows the held item on the left, an arrow, and the 3×3 grid of
 * ingredients it breaks into, with a button to uncraft once and, for stacks,
 * another to uncraft as many as the stack allows. The items are taken from
 * the held stack and the ingredients go into the inventory (any overflow
 * drops on the table).
 *
 * The menu is an ActionForm. resource_pack/ui/server_form.json redraws any
 * form whose title starts with FORM_MARKER as that crafting layout, and
 * leaves every other add-on's forms on the vanilla layout. The button order
 * is the contract between the two files: see SLOT below.
 *
 * Recipes and icons live in recipes.ts. Gear gives back its full recipe
 * however worn it is. Enchantments are lost; the menu warns before that
 * happens.
 */
import {
  ItemStack,
  ItemTypes,
  Player,
  system,
  world,
  type Block,
  type Container,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

import { RECIPES, allItemIds, grid, iconFor, ingredients, type Recipe } from './recipes';

const log = createLogger('uncrafting');
const PREFIX: RawMessage = { text: `${Format.gray}[Uncrafting]${Format.reset} ` };

const TABLE_ID = 'steveo:uncrafting_table';

/** How far away the table can be tapped; matches the game's block reach. */
const TABLE_REACH = 7;

/**
 * Starts the title of the uncrafting menu so server_form.json can tell it
 * from other forms. Formatting codes only, so it never shows; keep it in step
 * with the string in server_form.json.
 */
const FORM_MARKER = '§u§n§c§r';

/** Button indices the custom layout in server_form.json places by position. */
const SLOT = {
  input: 0,
  /** The nine grid cells are buttons 1 to 9, in reading order. */
  grid: 1,
  once: 10,
  all: 11,
} as const;

// ---------- chat and item helpers ----------

function say(player: Player, key: string, ...args: (string | RawMessage)[]): void {
  player.sendMessage([PREFIX, { translate: key, with: { rawtext: args.map((a) => (typeof a === 'string' ? { text: a } : a)) } }]);
}

function nameOf(typeId: string): RawMessage {
  try {
    return { translate: new ItemStack(typeId).localizationKey };
  } catch {
    return { text: typeId };
  }
}

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent('minecraft:inventory')?.container;
}

function heldItem(player: Player): ItemStack | undefined {
  try {
    return inventoryOf(player)?.getItem(player.selectedSlotIndex);
  } catch {
    return undefined;
  }
}

function isEnchanted(item: ItemStack): boolean {
  try {
    return (item.getComponent('minecraft:enchantable')?.getEnchantments().length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Puts `count` of an item into the inventory, dropping what does not fit at `spill`. */
function give(player: Player, typeId: string, count: number, spill: Vector3): void {
  const inventory = inventoryOf(player);
  let left = count;
  while (left > 0) {
    const stack = new ItemStack(typeId);
    stack.amount = Math.min(left, stack.maxAmount);
    left -= stack.amount;
    const leftover = inventory === undefined ? stack : inventory.addItem(stack);
    if (leftover !== undefined) player.dimension.spawnItem(leftover, spill);
  }
}

// ---------- the table ----------

function menu(item: ItemStack, entry: Recipe, cells: readonly (string | undefined)[], most: number): ActionFormData {
  const notes: RawMessage[] = [];
  if (isEnchanted(item)) notes.push({ translate: 'uncrafting.form.enchanted' });
  const body: RawMessage[] = notes.flatMap((note, i) => (i === 0 ? [note] : [{ text: '\n' }, note]));

  const form = new ActionFormData()
    .title({ rawtext: [{ text: FORM_MARKER }, { translate: 'tile.steveo:uncrafting_table.name' }] })
    .body({ rawtext: body.length > 0 ? body : [{ text: '' }] });

  // SLOT.input: the held item, labelled with how many one uncraft takes.
  form.button(entry.makes > 1 ? String(entry.makes) : '', iconFor(item.typeId));
  // SLOT.grid ... SLOT.grid + 8: the ingredients where a crafting table would hold them.
  for (const id of cells) {
    if (id === undefined) form.button('');
    else form.button('', iconFor(id));
  }
  form.button({ translate: 'uncrafting.form.once' });
  // SLOT.all is always sent so the indices stay fixed; the layout hides it when blank.
  form.button(most > 1 ? { translate: 'uncrafting.form.all', with: [String(most * entry.makes)] } : '');
  return form;
}

async function openTable(player: Player, table: Block): Promise<void> {
  const item = heldItem(player);
  if (item === undefined) {
    say(player, 'uncrafting.hold');
    return;
  }
  const entry = RECIPES[item.typeId];
  if (entry === undefined) {
    say(player, 'uncrafting.unknown', nameOf(item.typeId));
    return;
  }
  if (item.amount < entry.makes) {
    say(player, 'uncrafting.too_few', String(entry.makes), nameOf(item.typeId));
    return;
  }
  const cells = grid(entry);

  const most = Math.floor(item.amount / entry.makes);
  const response = await menu(item, entry, cells, most).show(player);
  if (response.canceled) return;
  // The ingredient slots are buttons too; tapping one does nothing.
  let batches: number;
  if (response.selection === SLOT.once) batches = 1;
  else if (response.selection === SLOT.all && most > 1) batches = most;
  else return;

  // The menu was open for a while; uncraft only what is in hand now.
  const now = heldItem(player);
  if (now === undefined || now.typeId !== item.typeId || now.amount < batches * entry.makes) {
    say(player, 'uncrafting.changed');
    return;
  }
  const items = ingredients(grid(entry));
  const inventory = inventoryOf(player);
  const remaining = now.amount - batches * entry.makes;
  if (remaining > 0) {
    now.amount = remaining;
    inventory?.setItem(player.selectedSlotIndex, now);
  } else {
    inventory?.setItem(player.selectedSlotIndex, undefined);
  }

  const spill = { x: table.location.x + 0.5, y: table.location.y + 1.1, z: table.location.z + 0.5 };
  for (const [id, count] of items) give(player, id, count * batches, spill);
  try {
    table.dimension.playSound('block.grindstone.use', spill);
  } catch {
    // Cosmetic only.
  }
  say(player, 'uncrafting.done', String(batches * entry.makes), nameOf(item.typeId));
  log.info(`${player.name}: uncrafted ${batches * entry.makes} ${item.typeId}`);
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.block.typeId !== TABLE_ID || !event.isFirstEvent) return;
  event.cancel = true;
  const { player, block } = event;
  system.run(() => {
    openTable(player, block).catch((err: unknown) => log.error('table menu failed', err));
  });
});

/** True when the table is the block under the player's crosshair. */
function facingTable(player: Player): boolean {
  try {
    return player.getBlockFromViewDirection({ maxDistance: TABLE_REACH, includeLiquidBlocks: false })?.block.typeId === TABLE_ID;
  } catch {
    return false;
  }
}

// Cancelling the block interaction does not stop the held item from being
// used as well: armor would equip itself, food would start being eaten, a bow
// would draw. Swallow the item use whenever the table is what was tapped, so
// the item is still in hand when the menu opens.
world.beforeEvents.itemUse.subscribe((event) => {
  if (facingTable(event.source)) event.cancel = true;
});

// ---------- debug: /scriptevent steveo:uncraft <table|check|held> ----------

function debugTable(player: Player): void {
  let above: Block | undefined;
  try {
    above = player.getBlockFromViewDirection({ maxDistance: 8, includeLiquidBlocks: false })?.block.above();
  } catch {
    above = undefined;
  }
  if (above === undefined) {
    say(player, 'uncrafting.debug.look');
    return;
  }
  above.setType(TABLE_ID);
  say(player, 'uncrafting.debug.table');
}

/** Every item id in the recipes must exist in this game version; reports any that do not. */
function debugCheck(player: Player): void {
  const ids = allItemIds();
  const missing = ids.filter((id) => ItemTypes.get(id) === undefined);
  say(player, 'uncrafting.debug.check', String(Object.keys(RECIPES).length), String(ids.length), String(missing.length));
  if (missing.length > 0) say(player, 'uncrafting.debug.missing', missing.join(', '));
}

function debugHeld(player: Player): void {
  const item = heldItem(player);
  const entry = item === undefined ? undefined : RECIPES[item.typeId];
  if (item === undefined || entry === undefined) {
    say(player, 'uncrafting.debug.held.none');
    return;
  }
  const lines = [...ingredients(grid(entry))].flatMap(([id, count]): RawMessage[] => [
    { text: '\n' },
    { translate: 'uncrafting.debug.held.line', with: { rawtext: [{ text: String(count) }, nameOf(id)] } },
  ]);
  player.sendMessage({
    rawtext: [
      PREFIX,
      {
        translate: 'uncrafting.debug.held',
        with: { rawtext: [{ text: String(entry.makes) }, nameOf(item.typeId)] },
      },
      ...lines,
    ],
  });
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:uncraft') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    switch (event.message.trim()) {
      case 'table':
        debugTable(player);
        break;
      case 'check':
        debugCheck(player);
        break;
      case 'held':
        debugHeld(player);
        break;
      default:
        say(player, 'uncrafting.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info(`loaded with ${Object.keys(RECIPES).length} recipes`);
