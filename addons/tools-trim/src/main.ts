/**
 * Tools Trim — armor-style trims for swords, pickaxes, axes, shovels, hoes,
 * and paxels (from the paxel add-on), applied at the Better Smithing Table.
 *
 * Hold a tool and use the table: a menu lists the eleven trim materials with
 * how many of each you carry, plus "Remove trim" when the tool already has
 * one. Picking a material takes one of it and swaps the tool in your hand for
 * its trimmed twin (see trims.ts for why a trim is a different item). The
 * swap carries everything over: enchantments, durability, custom name, lore,
 * and other add-ons' dynamic properties (Super Enchantments keeps its data
 * there).
 *
 * The vanilla smithing table cannot do this. Its base slot only accepts items
 * tagged minecraft:transformable_items, which vanilla gives to diamond tools
 * alone, and an add-on cannot tag vanilla items, so the trim goes through a
 * script form on a custom block instead. Trimmed diamond tools do carry the
 * tag, so the vanilla netherite upgrade still works on them and keeps the trim.
 *
 * The trimmed items copy the vanilla tools' stats in JSON. The script covers
 * what JSON cannot guarantee:
 *
 * - **Wear from mining.** After a block breaks, if the game left the tool's
 *   durability unchanged, the script takes the vanilla amount (1, or 2 for a
 *   sword), honoring Unbreaking. If the game already did it, nothing happens,
 *   so the two never double up.
 * - **Stripping, path making, and tilling, as a fallback**, the same way the
 *   paxel add-on does it: after an interaction, if the block is still
 *   unconverted, the script converts it.
 * - **Debug.** `/scriptevent steveo:tools_trim ...`, since chat is the only
 *   console a Realm has.
 */
import {
  BlockPermutation,
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  ItemComponentTypes,
  ItemStack,
  ItemTypes,
  Player,
  system,
  world,
  type Block,
  type Container,
  type Enchantment,
  type RawMessage,
} from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

import {
  MATERIALS,
  TIERS,
  TOOLS,
  allItemIds,
  findMaterial,
  idOf,
  isTier,
  isTool,
  parseTool,
  type Material,
  type TrimmableTool,
} from './trims';

const log = createLogger('tools-trim');
const PREFIX: RawMessage = { text: `${Format.gray}[Tools Trim]${Format.reset} ` };

const TABLE_ID = 'steveo:better_smithing_table';

/** How far away the table can be tapped; matches the game's block reach. */
const TABLE_REACH = 7;

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
  return player.getComponent(EntityComponentTypes.Inventory)?.container;
}

function heldItem(player: Player): ItemStack | undefined {
  try {
    return inventoryOf(player)?.getItem(player.selectedSlotIndex);
  } catch {
    return undefined;
  }
}

function isCreative(player: Player): boolean {
  return player.getGameMode() === GameMode.Creative;
}

function countItem(container: Container, typeId: string): number {
  let count = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === typeId) count += item.amount;
  }
  return count;
}

function removeOne(container: Container, typeId: string): void {
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId !== typeId) continue;
    if (item.amount > 1) {
      item.amount -= 1;
      container.setItem(slot, item);
    } else {
      container.setItem(slot, undefined);
    }
    return;
  }
}

function damageOf(item: ItemStack): number {
  return item.getComponent(ItemComponentTypes.Durability)?.damage ?? 0;
}

// ---------- swapping one tool for another ----------

/**
 * Builds `targetId` as a copy of `source`: enchantments, durability, name,
 * lore, and dynamic properties. Returns the enchantment that the target
 * cannot carry instead, so the caller can refuse rather than drop it.
 */
function transfer(source: ItemStack, targetId: string): ItemStack | Enchantment {
  const target = new ItemStack(targetId);

  const enchantments = source.getComponent(ItemComponentTypes.Enchantable)?.getEnchantments() ?? [];
  if (enchantments.length > 0) {
    const enchantable = target.getComponent(ItemComponentTypes.Enchantable);
    for (const enchantment of enchantments) {
      let fits = false;
      try {
        fits = enchantable?.canAddEnchantment(enchantment) ?? false;
      } catch {
        fits = false;
      }
      if (!fits) return enchantment;
    }
    enchantable?.addEnchantments(enchantments);
  }

  const from = source.getComponent(ItemComponentTypes.Durability);
  const to = target.getComponent(ItemComponentTypes.Durability);
  if (from && to) to.damage = Math.min(from.damage, to.maxDurability - 1);

  if (source.nameTag !== undefined) target.nameTag = source.nameTag;
  target.setLore(source.getLore());
  target.keepOnDeath = source.keepOnDeath;
  target.lockMode = source.lockMode;
  target.setCanDestroy(source.getCanDestroy());
  target.setCanPlaceOn(source.getCanPlaceOn());
  for (const id of source.getDynamicPropertyIds()) target.setDynamicProperty(id, source.getDynamicProperty(id));
  return target;
}

// ---------- the table ----------

type Choice = { kind: 'trim'; material: Material } | { kind: 'remove' };

async function openTable(player: Player, table: Block): Promise<void> {
  const item = heldItem(player);
  if (item === undefined) {
    say(player, 'tools_trim.hold');
    return;
  }
  const tool = parseTool(item.typeId);
  if (tool === undefined) {
    say(player, 'tools_trim.not_a_tool', nameOf(item.typeId));
    return;
  }
  const inventory = inventoryOf(player);
  const creative = isCreative(player);
  const toolName = nameOf(item.typeId);

  const form = new ActionFormData().title({ translate: 'tile.steveo:better_smithing_table.name' });
  form.body(
    tool.trim === undefined
      ? { translate: 'tools_trim.form.body', with: { rawtext: [toolName] } }
      : { translate: 'tools_trim.form.body_trimmed', with: { rawtext: [toolName, nameOf(tool.trim.item)] } },
  );
  const choices: Choice[] = [];
  for (const material of MATERIALS) {
    const name = nameOf(material.item);
    const have = inventory === undefined ? 0 : countItem(inventory, material.item);
    let label: RawMessage;
    if (tool.trim === material) label = { translate: 'tools_trim.form.current', with: { rawtext: [name] } };
    else if (have > 0 || creative) label = { translate: 'tools_trim.form.material', with: { rawtext: [name, { text: String(have) }] } };
    else label = { translate: 'tools_trim.form.missing', with: { rawtext: [name] } };
    form.button(label, material.icon);
    choices.push({ kind: 'trim', material });
  }
  if (tool.trim !== undefined) {
    form.button({ translate: 'tools_trim.form.remove' }, 'textures/blocks/smithing_table_front');
    choices.push({ kind: 'remove' });
  }

  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  const choice = choices[response.selection];
  if (choice === undefined) return;
  apply(player, table, item, tool, choice);
}

function apply(player: Player, table: Block, before: ItemStack, tool: TrimmableTool, choice: Choice): void {
  const inventory = inventoryOf(player);
  // The menu was open for a while; work only on what is in hand now.
  const now = heldItem(player);
  if (inventory === undefined || now === undefined || now.typeId !== before.typeId || damageOf(now) !== damageOf(before)) {
    say(player, 'tools_trim.changed');
    return;
  }
  const trim = choice.kind === 'trim' ? choice.material : undefined;
  if (trim === tool.trim) {
    say(player, 'tools_trim.same');
    return;
  }
  const creative = isCreative(player);
  if (trim !== undefined && !creative && countItem(inventory, trim.item) < 1) {
    say(player, 'tools_trim.need', nameOf(trim.item));
    return;
  }

  const targetId = idOf({ ...tool, trim });
  const result = transfer(now, targetId);
  if (!(result instanceof ItemStack)) {
    say(player, 'tools_trim.enchant_blocked', nameOf(targetId), result.type.id);
    return;
  }
  if (trim !== undefined && !creative) removeOne(inventory, trim.item);
  inventory.setItem(player.selectedSlotIndex, result);

  const at = { x: table.location.x + 0.5, y: table.location.y + 1, z: table.location.z + 0.5 };
  try {
    table.dimension.playSound('smithing_table.use', at);
  } catch {
    // Cosmetic only.
  }
  if (trim === undefined) say(player, 'tools_trim.removed', nameOf(targetId));
  else say(player, 'tools_trim.trimmed', nameOf(targetId), nameOf(trim.item));
  log.info(`${player.name}: ${now.typeId} -> ${targetId}`);
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
// used as well. Swallow the item use whenever the table is what was tapped, so
// the tool is still in hand, unchanged, when the menu opens.
world.beforeEvents.itemUse.subscribe((event) => {
  if (facingTable(event.source)) event.cancel = true;
});

// ---------- wear ----------

/**
 * Takes `amount` durability off the trimmed tool in the player's main hand,
 * provided it is still `expected` (same type, same damage), and breaks it on
 * the last point. Each point is skipped with Unbreaking's vanilla chance.
 */
function wear(player: Player, expected: ItemStack, amount: number): void {
  if (isCreative(player)) return;
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (!equippable || held?.typeId !== expected.typeId || damageOf(held) !== damageOf(expected)) return;
  const durability = held.getComponent(ItemComponentTypes.Durability);
  if (!durability) return;
  const unbreaking = held.getComponent(ItemComponentTypes.Enchantable)?.getEnchantment('unbreaking')?.level ?? 0;
  let points = 0;
  for (let i = 0; i < amount; i++) if (Math.random() < 1 / (unbreaking + 1)) points++;
  if (points === 0) return;
  if (durability.damage + points >= durability.maxDurability) {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    player.playSound('random.break');
    return;
  }
  durability.damage += points;
  equippable.setEquipment(EquipmentSlot.Mainhand, held);
}

world.afterEvents.playerBreakBlock.subscribe((event) => {
  const before = event.itemStackBeforeBreak;
  const after = event.itemStackAfterBreak;
  if (before === undefined || after === undefined || after.typeId !== before.typeId) return;
  const tool = parseTool(before.typeId);
  if (tool?.trim === undefined) return;
  // The game already wore the tool down; do not do it twice.
  if (damageOf(after) !== damageOf(before)) return;
  wear(event.player, after, tool.tool === 'sword' ? 2 : 1);
});

// ---------- strip, path, and till fallbacks ----------

/** Log and wood blocks an axe strips, keyed by their unstripped id. */
const STRIPPABLE: Readonly<Record<string, string>> = {
  'minecraft:oak_log': 'minecraft:stripped_oak_log',
  'minecraft:spruce_log': 'minecraft:stripped_spruce_log',
  'minecraft:birch_log': 'minecraft:stripped_birch_log',
  'minecraft:jungle_log': 'minecraft:stripped_jungle_log',
  'minecraft:acacia_log': 'minecraft:stripped_acacia_log',
  'minecraft:dark_oak_log': 'minecraft:stripped_dark_oak_log',
  'minecraft:mangrove_log': 'minecraft:stripped_mangrove_log',
  'minecraft:cherry_log': 'minecraft:stripped_cherry_log',
  'minecraft:pale_oak_log': 'minecraft:stripped_pale_oak_log',
  'minecraft:oak_wood': 'minecraft:stripped_oak_wood',
  'minecraft:spruce_wood': 'minecraft:stripped_spruce_wood',
  'minecraft:birch_wood': 'minecraft:stripped_birch_wood',
  'minecraft:jungle_wood': 'minecraft:stripped_jungle_wood',
  'minecraft:acacia_wood': 'minecraft:stripped_acacia_wood',
  'minecraft:dark_oak_wood': 'minecraft:stripped_dark_oak_wood',
  'minecraft:mangrove_wood': 'minecraft:stripped_mangrove_wood',
  'minecraft:cherry_wood': 'minecraft:stripped_cherry_wood',
  'minecraft:pale_oak_wood': 'minecraft:stripped_pale_oak_wood',
  'minecraft:crimson_stem': 'minecraft:stripped_crimson_stem',
  'minecraft:warped_stem': 'minecraft:stripped_warped_stem',
  'minecraft:crimson_hyphae': 'minecraft:stripped_crimson_hyphae',
  'minecraft:warped_hyphae': 'minecraft:stripped_warped_hyphae',
  'minecraft:bamboo_block': 'minecraft:stripped_bamboo_block',
};

/** Ground a shovel flattens into a dirt path. */
const PATHABLE = new Set([
  'minecraft:grass_block',
  'minecraft:dirt',
  'minecraft:coarse_dirt',
  'minecraft:podzol',
  'minecraft:mycelium',
  'minecraft:rooted_dirt',
]);
const PATH_ID = 'minecraft:grass_path';

/** Ground a hoe turns into farmland, and ground it turns into plain dirt first. */
const TILLABLE = new Set(['minecraft:grass_block', 'minecraft:dirt', 'minecraft:grass_path']);
const LOOSENABLE = new Set(['minecraft:coarse_dirt', 'minecraft:rooted_dirt']);

function headroom(block: Block): boolean {
  const above = block.above();
  return above !== undefined && above.isAir;
}

function tryStrip(block: Block): boolean {
  const stripped = STRIPPABLE[block.typeId];
  if (!stripped) return false;
  const axis = block.permutation.getState('pillar_axis');
  block.setPermutation(
    typeof axis === 'string' ? BlockPermutation.resolve(stripped, { pillar_axis: axis }) : BlockPermutation.resolve(stripped),
  );
  return true;
}

function tryPath(block: Block): boolean {
  if (!PATHABLE.has(block.typeId) || !headroom(block)) return false;
  block.setPermutation(BlockPermutation.resolve(PATH_ID));
  return true;
}

function tryTill(block: Block): boolean {
  if (!headroom(block)) return false;
  if (TILLABLE.has(block.typeId)) block.setPermutation(BlockPermutation.resolve('minecraft:farmland'));
  else if (LOOSENABLE.has(block.typeId)) block.setPermutation(BlockPermutation.resolve('minecraft:dirt'));
  else return false;
  return true;
}

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent || event.itemStack === undefined || event.player.isSneaking) return;
  const tool = parseTool(event.itemStack.typeId);
  if (tool?.trim === undefined) return;
  const { block } = event;
  let changed = false;
  try {
    if (tool.tool === 'axe') changed = tryStrip(block);
    else if (tool.tool === 'shovel') changed = tryPath(block);
    else if (tool.tool === 'hoe') changed = tryTill(block);
    else if (tool.tool === 'paxel') changed = tryStrip(block) || tryPath(block);
  } catch (error) {
    log.warn(`could not convert ${block.typeId}: ${String(error)}`);
    return;
  }
  if (!changed) return;
  event.player.playSound(block.typeId.includes('stripped') ? 'use.wood' : 'use.gravel', { location: block.location });
  wear(event.player, event.itemStack, 1);
});

// ---------- debug: /scriptevent steveo:tools_trim <table|give|held|check> ----------

function debugTable(player: Player): void {
  let above: Block | undefined;
  try {
    above = player.getBlockFromViewDirection({ maxDistance: 8, includeLiquidBlocks: false })?.block.above();
  } catch {
    above = undefined;
  }
  if (above === undefined) {
    say(player, 'tools_trim.debug.look');
    return;
  }
  above.setType(TABLE_ID);
  say(player, 'tools_trim.debug.table');
}

/** `give [tier] [tool] [material|none]`, defaulting to a gold-trimmed diamond pickaxe. */
function debugGive(player: Player, args: readonly string[]): void {
  const [tier = 'diamond', tool = 'pickaxe', material = 'gold'] = args;
  if (!isTier(tier)) {
    say(player, 'tools_trim.debug.unknown', 'tier', tier, TIERS.join(', '));
    return;
  }
  if (!isTool(tool)) {
    say(player, 'tools_trim.debug.unknown', 'tool', tool, TOOLS.join(', '));
    return;
  }
  const trim = material === 'none' ? undefined : findMaterial(material);
  if (material !== 'none' && trim === undefined) {
    say(player, 'tools_trim.debug.unknown', 'material', material, `${MATERIALS.map((m) => m.id).join(', ')}, none`);
    return;
  }
  const id = idOf({ tier, tool, trim });
  if (ItemTypes.get(id) === undefined) {
    say(player, 'tools_trim.debug.missing', id);
    return;
  }
  const leftover = inventoryOf(player)?.addItem(new ItemStack(id));
  if (leftover !== undefined) player.dimension.spawnItem(leftover, player.location);
  say(player, 'tools_trim.debug.given', nameOf(id));
}

function debugHeld(player: Player): void {
  const item = heldItem(player);
  const tool = item === undefined ? undefined : parseTool(item.typeId);
  if (item === undefined || tool === undefined) {
    say(player, 'tools_trim.debug.held.none');
    return;
  }
  const durability = item.getComponent(ItemComponentTypes.Durability);
  const enchantments = item.getComponent(ItemComponentTypes.Enchantable)?.getEnchantments() ?? [];
  say(
    player,
    'tools_trim.debug.held',
    item.typeId,
    tool.tier,
    tool.tool,
    tool.trim?.id ?? 'none',
    String(durability ? durability.maxDurability - durability.damage : '?'),
    String(durability?.maxDurability ?? '?'),
    String(enchantments.length),
  );
}

/** Every item id the add-on uses must exist in this game version; reports any that do not. */
function debugCheck(player: Player): void {
  const ids = allItemIds();
  const missing = ids.filter((id) => ItemTypes.get(id) === undefined);
  say(player, 'tools_trim.debug.check', String(ids.length), String(missing.length));
  if (missing.length > 0) say(player, 'tools_trim.debug.missing', missing.join(', '));
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:tools_trim') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    const [command = '', ...args] = event.message.trim().split(/\s+/);
    switch (command) {
      case 'table':
        debugTable(player);
        break;
      case 'give':
        debugGive(player, args);
        break;
      case 'held':
        debugHeld(player);
        break;
      case 'check':
        debugCheck(player);
        break;
      default:
        say(player, 'tools_trim.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
