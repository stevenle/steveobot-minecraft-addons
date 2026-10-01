/**
 * Uncrafting — the Uncrafting Table breaks a crafted item back down into the
 * ingredients its crafting recipe used.
 *
 * Hold an item and use the table: a menu shows what one craft's worth of the
 * item returns, with a button to uncraft once and, for stacks, another to
 * uncraft as many as the stack allows. The items are taken from the held
 * stack and the ingredients go into the inventory (any overflow drops on the
 * table).
 *
 * The Script API cannot read the game's recipe book, so the recipes live in
 * RECIPES below, written out by hand from the vanilla crafting recipes. Where
 * a recipe accepts any of several items (any planks, any cobblestone-like
 * stone), the table gives back the plain one: oak planks, cobblestone.
 *
 * Damaged gear returns ingredients in proportion to the durability left,
 * rounded down, so uncrafting can never repair anything. Enchantments are
 * lost; the menu warns before that happens.
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

const log = createLogger('uncrafting');
const PREFIX: RawMessage = { text: `${Format.gray}[Uncrafting]${Format.reset} ` };

const TABLE_ID = 'steveo:uncrafting_table';

/** How far away the table can be tapped; matches the game's block reach. */
const TABLE_REACH = 7;

// ---------- the recipes ----------

interface Recipe {
  /** How many of the item one craft produces, and so how many one uncraft takes. */
  makes: number;
  /** Ingredients returned per uncraft, by item id. */
  gives: Record<string, number>;
}

function recipe(gives: Record<string, number>, makes = 1): Recipe {
  return { makes, gives };
}

const RECIPES: Record<string, Recipe> = {};

/** Swords, pickaxes, axes, shovels and hoes made from one material and sticks. */
function toolSet(prefix: string, material: string): void {
  RECIPES[`minecraft:${prefix}_sword`] = recipe({ [material]: 2, 'minecraft:stick': 1 });
  RECIPES[`minecraft:${prefix}_pickaxe`] = recipe({ [material]: 3, 'minecraft:stick': 2 });
  RECIPES[`minecraft:${prefix}_axe`] = recipe({ [material]: 3, 'minecraft:stick': 2 });
  RECIPES[`minecraft:${prefix}_shovel`] = recipe({ [material]: 1, 'minecraft:stick': 2 });
  RECIPES[`minecraft:${prefix}_hoe`] = recipe({ [material]: 2, 'minecraft:stick': 2 });
}

/** Helmet, chestplate, leggings and boots made from one material. */
function armorSet(prefix: string, material: string): void {
  RECIPES[`minecraft:${prefix}_helmet`] = recipe({ [material]: 5 });
  RECIPES[`minecraft:${prefix}_chestplate`] = recipe({ [material]: 8 });
  RECIPES[`minecraft:${prefix}_leggings`] = recipe({ [material]: 7 });
  RECIPES[`minecraft:${prefix}_boots`] = recipe({ [material]: 4 });
}

/** Netherite gear: the smithing table's diamond piece, ingot, and template. */
function netheriteSet(pieces: readonly string[]): void {
  for (const piece of pieces) {
    RECIPES[`minecraft:netherite_${piece}`] = recipe({
      [`minecraft:diamond_${piece}`]: 1,
      'minecraft:netherite_ingot': 1,
      'minecraft:netherite_upgrade_smithing_template': 1,
    });
  }
}

/** Nine-of-a-kind storage blocks. */
function storageBlock(block: string, item: string, count = 9): void {
  RECIPES[`minecraft:${block}`] = recipe({ [`minecraft:${item}`]: count });
}

toolSet('wooden', 'minecraft:oak_planks');
toolSet('stone', 'minecraft:cobblestone');
toolSet('iron', 'minecraft:iron_ingot');
toolSet('golden', 'minecraft:gold_ingot');
toolSet('diamond', 'minecraft:diamond');

armorSet('leather', 'minecraft:leather');
armorSet('iron', 'minecraft:iron_ingot');
armorSet('golden', 'minecraft:gold_ingot');
armorSet('diamond', 'minecraft:diamond');

netheriteSet(['sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots']);

storageBlock('iron_block', 'iron_ingot');
storageBlock('gold_block', 'gold_ingot');
storageBlock('diamond_block', 'diamond');
storageBlock('emerald_block', 'emerald');
storageBlock('lapis_block', 'lapis_lazuli');
storageBlock('redstone_block', 'redstone');
storageBlock('coal_block', 'coal');
storageBlock('copper_block', 'copper_ingot');
storageBlock('netherite_block', 'netherite_ingot');
storageBlock('raw_iron_block', 'raw_iron');
storageBlock('raw_gold_block', 'raw_gold');
storageBlock('raw_copper_block', 'raw_copper');
storageBlock('hay_block', 'wheat');
storageBlock('slime', 'slime_ball');
storageBlock('bone_block', 'bone_meal');
storageBlock('dried_kelp_block', 'dried_kelp');
storageBlock('honey_block', 'honey_bottle', 4);

Object.assign(RECIPES, {
  // Weapons and tools
  'minecraft:bow': recipe({ 'minecraft:stick': 3, 'minecraft:string': 3 }),
  'minecraft:crossbow': recipe({
    'minecraft:stick': 3,
    'minecraft:string': 2,
    'minecraft:iron_ingot': 1,
    'minecraft:tripwire_hook': 1,
  }),
  'minecraft:shield': recipe({ 'minecraft:oak_planks': 6, 'minecraft:iron_ingot': 1 }),
  'minecraft:mace': recipe({ 'minecraft:heavy_core': 1, 'minecraft:breeze_rod': 1 }),
  'minecraft:fishing_rod': recipe({ 'minecraft:stick': 3, 'minecraft:string': 2 }),
  'minecraft:flint_and_steel': recipe({ 'minecraft:iron_ingot': 1, 'minecraft:flint': 1 }),
  'minecraft:shears': recipe({ 'minecraft:iron_ingot': 2 }),
  'minecraft:brush': recipe({ 'minecraft:feather': 1, 'minecraft:copper_ingot': 1, 'minecraft:stick': 1 }),
  'minecraft:spyglass': recipe({ 'minecraft:amethyst_shard': 1, 'minecraft:copper_ingot': 2 }),
  'minecraft:bucket': recipe({ 'minecraft:iron_ingot': 3 }),
  'minecraft:compass': recipe({ 'minecraft:iron_ingot': 4, 'minecraft:redstone': 1 }),
  'minecraft:clock': recipe({ 'minecraft:gold_ingot': 4, 'minecraft:redstone': 1 }),

  // Workstations and furniture
  'minecraft:crafting_table': recipe({ 'minecraft:oak_planks': 4 }),
  'minecraft:chest': recipe({ 'minecraft:oak_planks': 8 }),
  'minecraft:furnace': recipe({ 'minecraft:cobblestone': 8 }),
  'minecraft:blast_furnace': recipe({
    'minecraft:iron_ingot': 5,
    'minecraft:furnace': 1,
    'minecraft:smooth_stone': 3,
  }),
  'minecraft:smoker': recipe({ 'minecraft:furnace': 1, 'minecraft:oak_log': 4 }),
  'minecraft:anvil': recipe({ 'minecraft:iron_block': 3, 'minecraft:iron_ingot': 4 }),
  'minecraft:cauldron': recipe({ 'minecraft:iron_ingot': 7 }),
  'minecraft:hopper': recipe({ 'minecraft:iron_ingot': 5, 'minecraft:chest': 1 }),
  'minecraft:bookshelf': recipe({ 'minecraft:oak_planks': 6, 'minecraft:book': 3 }),
  'minecraft:book': recipe({ 'minecraft:paper': 3, 'minecraft:leather': 1 }),
  'minecraft:enchanting_table': recipe({
    'minecraft:book': 1,
    'minecraft:diamond': 2,
    'minecraft:obsidian': 4,
  }),
  'minecraft:jukebox': recipe({ 'minecraft:oak_planks': 8, 'minecraft:diamond': 1 }),
  'minecraft:beacon': recipe({
    'minecraft:glass': 5,
    'minecraft:nether_star': 1,
    'minecraft:obsidian': 3,
  }),

  // Redstone and rails
  'minecraft:piston': recipe({
    'minecraft:oak_planks': 3,
    'minecraft:cobblestone': 4,
    'minecraft:iron_ingot': 1,
    'minecraft:redstone': 1,
  }),
  'minecraft:sticky_piston': recipe({ 'minecraft:piston': 1, 'minecraft:slime_ball': 1 }),
  'minecraft:tnt': recipe({ 'minecraft:gunpowder': 5, 'minecraft:sand': 4 }),
  'minecraft:minecart': recipe({ 'minecraft:iron_ingot': 5 }),
  'minecraft:rail': recipe({ 'minecraft:iron_ingot': 6, 'minecraft:stick': 1 }, 16),
  'minecraft:iron_bars': recipe({ 'minecraft:iron_ingot': 6 }, 16),

  // Light
  'minecraft:torch': recipe({ 'minecraft:coal': 1, 'minecraft:stick': 1 }, 4),
  'minecraft:lantern': recipe({ 'minecraft:iron_nugget': 8, 'minecraft:torch': 1 }),

  // Food and odds and ends
  'minecraft:golden_apple': recipe({ 'minecraft:gold_ingot': 8, 'minecraft:apple': 1 }),
  'minecraft:golden_carrot': recipe({ 'minecraft:gold_nugget': 8, 'minecraft:carrot': 1 }),
  'minecraft:ender_eye': recipe({ 'minecraft:ender_pearl': 1, 'minecraft:blaze_powder': 1 }),
  'minecraft:stick': recipe({ 'minecraft:oak_planks': 2 }, 4),
});

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

/** Share of the item's durability left, 1 for items that do not wear. */
function condition(item: ItemStack): number {
  const durability = item.getComponent('minecraft:durability');
  if (durability === undefined || durability.maxDurability <= 0) return 1;
  return Math.max(0, (durability.maxDurability - durability.damage) / durability.maxDurability);
}

function isEnchanted(item: ItemStack): boolean {
  try {
    return (item.getComponent('minecraft:enchantable')?.getEnchantments().length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Ingredients for `batches` uncrafts of this item, scaled down for wear. */
function yieldOf(item: ItemStack, entry: Recipe, batches: number): [string, number][] {
  const share = condition(item);
  return Object.entries(entry.gives)
    .map(([id, count]): [string, number] => [id, Math.floor(count * share) * batches])
    .filter(([, count]) => count > 0);
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

function yieldLines(items: [string, number][]): RawMessage[] {
  return items.flatMap(([id, count]): RawMessage[] => [
    { text: '\n' },
    { translate: 'uncrafting.form.line', with: { rawtext: [{ text: String(count) }, nameOf(id)] } },
  ]);
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
  const once = yieldOf(item, entry, 1);
  if (once.length === 0) {
    say(player, 'uncrafting.worn', nameOf(item.typeId));
    return;
  }

  const most = Math.floor(item.amount / entry.makes);
  const body: RawMessage[] = [
    { translate: 'uncrafting.form.body', with: { rawtext: [{ text: String(entry.makes) }, nameOf(item.typeId)] } },
    ...yieldLines(once),
  ];
  if (condition(item) < 1) body.push({ text: '\n\n' }, { translate: 'uncrafting.form.damaged' });
  if (isEnchanted(item)) body.push({ text: '\n\n' }, { translate: 'uncrafting.form.enchanted' });

  const form = new ActionFormData()
    .title({ translate: 'tile.steveo:uncrafting_table.name' })
    .body({ rawtext: body })
    .button({ translate: 'uncrafting.form.once' });
  if (most > 1) form.button({ translate: 'uncrafting.form.all', with: [String(most), String(most * entry.makes)] });

  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  const batches = response.selection === 1 ? most : 1;

  // The menu was open for a while; uncraft only what is in hand now.
  const now = heldItem(player);
  if (now === undefined || now.typeId !== item.typeId || now.amount < batches * entry.makes) {
    say(player, 'uncrafting.changed');
    return;
  }
  const items = yieldOf(now, entry, batches);
  const inventory = inventoryOf(player);
  const remaining = now.amount - batches * entry.makes;
  if (remaining > 0) {
    now.amount = remaining;
    inventory?.setItem(player.selectedSlotIndex, now);
  } else {
    inventory?.setItem(player.selectedSlotIndex, undefined);
  }

  const spill = { x: table.location.x + 0.5, y: table.location.y + 1.1, z: table.location.z + 0.5 };
  for (const [id, count] of items) give(player, id, count, spill);
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

/** Every item id in RECIPES must exist in this game version; reports any that do not. */
function debugCheck(player: Player): void {
  const ids = new Set<string>();
  for (const [id, entry] of Object.entries(RECIPES)) {
    ids.add(id);
    for (const ingredient of Object.keys(entry.gives)) ids.add(ingredient);
  }
  const missing = [...ids].filter((id) => ItemTypes.get(id) === undefined).sort();
  say(player, 'uncrafting.debug.check', String(Object.keys(RECIPES).length), String(ids.size), String(missing.length));
  if (missing.length > 0) say(player, 'uncrafting.debug.missing', missing.join(', '));
}

function debugHeld(player: Player): void {
  const item = heldItem(player);
  const entry = item === undefined ? undefined : RECIPES[item.typeId];
  if (item === undefined || entry === undefined) {
    say(player, 'uncrafting.debug.held.none');
    return;
  }
  player.sendMessage({
    rawtext: [
      PREFIX,
      {
        translate: 'uncrafting.debug.held',
        with: { rawtext: [{ text: String(entry.makes) }, nameOf(item.typeId), { text: String(Math.round(condition(item) * 100)) }] },
      },
      ...yieldLines(yieldOf(item, entry, 1)),
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
