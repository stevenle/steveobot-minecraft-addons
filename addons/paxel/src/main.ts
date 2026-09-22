/**
 * Paxel — one tool that is a shovel, an axe, a pickaxe, and a sword, in every
 * vanilla tool material from wood to netherite.
 *
 * The item definitions (behavior_pack/items/<tier>_paxel.json, generated from
 * the tier table in assets/generate.mjs) do nearly all the work on their own:
 * `minecraft:digger` gives each tier its material's speed on stone, metal,
 * wood, plants, dirt, sand, gravel, and snow, plus sword speed on cobwebs and
 * bamboo; `minecraft:damage` gives it the matching sword's hit; and the
 * `minecraft:is_axe` / `minecraft:is_shovel` / `minecraft:<material>_tier`
 * tags tell the game to treat it as a real axe, shovel, and pickaxe of that
 * tier for drops, log stripping, and path making.
 *
 * This script covers the two things that only a script can guarantee:
 *
 * - **Stripping and path making, as a fallback.** Whether the item tags alone
 *   let a custom tool strip logs and flatten dirt into paths depends on the
 *   game build. So after every block interaction with the paxel, if the block
 *   is still an unstripped log or still plain dirt, the script does the
 *   conversion itself and wears the tool by one point. If the game already
 *   did it, the block has changed and the script does nothing — the two
 *   paths never double up.
 * - **Debug.** `/scriptevent steveo:paxel give [tier|all]|status` hands out
 *   paxels and reports the held one's durability from chat, which is the
 *   only console a Realm has.
 */
import {
  BlockPermutation,
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  ItemComponentTypes,
  ItemStack,
  Player,
  system,
  world,
  type Block,
  type RawMessage,
} from '@minecraft/server';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('paxel');
const TAG = `${Format.gray}[Paxel]${Format.reset} `;

/** Tiers in ascending order; the item id is `steveo:<tier>_paxel`. */
const TIERS = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'] as const;
type Tier = (typeof TIERS)[number];
const PAXEL_IDS = new Set<string>(TIERS.map((tier) => `steveo:${tier}_paxel`));

function isPaxel(item: ItemStack | undefined): item is ItemStack {
  return item !== undefined && PAXEL_IDS.has(item.typeId);
}

function isTier(name: string): name is Tier {
  return (TIERS as readonly string[]).includes(name);
}

/** Log and wood blocks the axe half strips, keyed by their unstripped id. */
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

/** Ground blocks the shovel half flattens into a dirt path. */
const PATHABLE = new Set([
  'minecraft:grass_block',
  'minecraft:dirt',
  'minecraft:coarse_dirt',
  'minecraft:podzol',
  'minecraft:mycelium',
  'minecraft:rooted_dirt',
]);
const PATH_ID = 'minecraft:grass_path';

function send(player: Player, message: RawMessage): void {
  player.sendMessage({ rawtext: [{ text: TAG }, message] });
}

/**
 * Takes one durability point off the paxel in the player's main hand, or
 * breaks it when that was the last point. Creative players pay nothing, as
 * with any vanilla tool.
 */
function wear(player: Player): void {
  if (player.getGameMode() === GameMode.Creative) return;
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (!equippable || !isPaxel(held)) return;
  const durability = held.getComponent(ItemComponentTypes.Durability);
  if (!durability) return;
  if (durability.damage + 1 >= durability.maxDurability) {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    player.playSound('random.break');
    return;
  }
  durability.damage += 1;
  equippable.setEquipment(EquipmentSlot.Mainhand, held);
}

/** Strips a log, keeping its axis, if the game has not already done so. */
function tryStrip(block: Block): boolean {
  const stripped = STRIPPABLE[block.typeId];
  if (!stripped) return false;
  const axis = block.permutation.getState('pillar_axis');
  const permutation =
    typeof axis === 'string'
      ? BlockPermutation.resolve(stripped, { pillar_axis: axis })
      : BlockPermutation.resolve(stripped);
  block.setPermutation(permutation);
  return true;
}

/** Flattens dirt into a path, if there is headroom and the game did not. */
function tryPath(block: Block): boolean {
  if (!PATHABLE.has(block.typeId)) return false;
  const above = block.above();
  if (!above || !above.isAir) return false;
  block.setPermutation(BlockPermutation.resolve(PATH_ID));
  return true;
}

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent) return;
  if (!isPaxel(event.itemStack)) return;
  if (event.player.isSneaking) return;
  const { block } = event;
  let changed = false;
  try {
    changed = tryStrip(block) || tryPath(block);
  } catch (error) {
    log.warn(`could not convert ${block.typeId}: ${String(error)}`);
    return;
  }
  if (!changed) return;
  event.player.playSound('use.wood', { location: block.location });
  wear(event.player);
});

function debugGive(player: Player, which: string): void {
  const tiers: readonly Tier[] = which === 'all' ? TIERS : isTier(which) ? [which] : [];
  if (tiers.length === 0) {
    send(player, { translate: 'paxel.debug.unknown_tier', with: [which, TIERS.join(', ')] });
    return;
  }
  const inventory = player.getComponent(EntityComponentTypes.Inventory);
  for (const tier of tiers) inventory?.container.addItem(new ItemStack(`steveo:${tier}_paxel`, 1));
  const names: RawMessage[] = [];
  tiers.forEach((tier, index) => {
    if (index > 0) names.push({ text: ', ' });
    names.push({ translate: `item.steveo:${tier}_paxel.name` });
  });
  send(player, {
    rawtext: [{ translate: 'paxel.debug.given' }, ...names, { translate: 'paxel.debug.given_hint' }],
  });
}

function debugStatus(player: Player): void {
  const held = player
    .getComponent(EntityComponentTypes.Equippable)
    ?.getEquipment(EquipmentSlot.Mainhand);
  const durability = isPaxel(held) ? held.getComponent(ItemComponentTypes.Durability) : undefined;
  if (!isPaxel(held) || !durability) {
    send(player, { translate: 'paxel.debug.not_holding' });
    return;
  }
  send(player, {
    translate: 'paxel.debug.status',
    with: {
      rawtext: [
        { translate: `item.${held.typeId}.name` },
        { text: String(durability.maxDurability - durability.damage) },
        { text: String(durability.maxDurability) },
      ],
    },
  });
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:paxel') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;
    const [command = '', argument = 'diamond'] = event.message.trim().split(/\s+/);
    switch (command) {
      case 'give':
        debugGive(player, argument);
        break;
      case 'status':
        debugStatus(player);
        break;
      default:
        send(player, { translate: 'paxel.debug.help' });
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
