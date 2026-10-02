/**
 * The recipes the Uncrafting Table knows, and the icon each item shows in
 * its menu.
 *
 * The Script API cannot read the game's recipe book, so these are written
 * out by hand from the vanilla crafting recipes (Mojang/bedrock-samples,
 * behavior_pack/recipes/). Each keeps its crafting-grid shape so the menu can
 * lay the ingredients out the way a crafting table would. Where a recipe
 * accepts any of several items (any planks, any cobblestone-like stone), the
 * table gives back the plain one: oak planks, cobblestone.
 *
 * This module imports nothing from the game, so it can be checked from Node.
 */

export interface Recipe {
  /** How many of the item one craft produces, and so how many one uncraft takes. */
  makes: number;
  /** Up to three rows of up to three key letters; a space is an empty slot. */
  pattern: readonly string[];
  /** Item id for each letter in the pattern. */
  key: Readonly<Record<string, string>>;
}

function recipe(pattern: readonly string[], key: Record<string, string>, makes = 1): Recipe {
  return { makes, pattern, key };
}

export const RECIPES: Record<string, Recipe> = {};

const STICK = 'minecraft:stick';

/** Swords, pickaxes, axes, shovels and hoes made from one material and sticks. */
function toolSet(prefix: string, material: string): void {
  const key = { M: material, S: STICK };
  RECIPES[`minecraft:${prefix}_sword`] = recipe([' M ', ' M ', ' S '], key);
  RECIPES[`minecraft:${prefix}_pickaxe`] = recipe(['MMM', ' S ', ' S '], key);
  RECIPES[`minecraft:${prefix}_axe`] = recipe(['MM ', 'MS ', ' S '], key);
  RECIPES[`minecraft:${prefix}_shovel`] = recipe([' M ', ' S ', ' S '], key);
  RECIPES[`minecraft:${prefix}_hoe`] = recipe(['MM ', ' S ', ' S '], key);
}

/** Helmet, chestplate, leggings and boots made from one material. */
function armorSet(prefix: string, material: string): void {
  const key = { M: material };
  RECIPES[`minecraft:${prefix}_helmet`] = recipe(['MMM', 'M M'], key);
  RECIPES[`minecraft:${prefix}_chestplate`] = recipe(['M M', 'MMM', 'MMM'], key);
  RECIPES[`minecraft:${prefix}_leggings`] = recipe(['MMM', 'M M', 'M M'], key);
  RECIPES[`minecraft:${prefix}_boots`] = recipe(['M M', 'M M'], key);
}

/**
 * Netherite gear comes from the smithing table, not the crafting grid; the
 * menu shows its three inputs in a row: template, diamond piece, ingot.
 */
function netheriteSet(pieces: readonly string[]): void {
  for (const piece of pieces) {
    RECIPES[`minecraft:netherite_${piece}`] = recipe(['TDN'], {
      T: 'minecraft:netherite_upgrade_smithing_template',
      D: `minecraft:diamond_${piece}`,
      N: 'minecraft:netherite_ingot',
    });
  }
}

/** Nine-of-a-kind storage blocks. */
function storageBlock(block: string, item: string): void {
  RECIPES[`minecraft:${block}`] = recipe(['XXX', 'XXX', 'XXX'], { X: `minecraft:${item}` });
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

const PLANKS = 'minecraft:oak_planks';
const COBBLE = 'minecraft:cobblestone';
const IRON = 'minecraft:iron_ingot';
const GOLD = 'minecraft:gold_ingot';

Object.assign(RECIPES, {
  'minecraft:honey_block': recipe(['XX', 'XX'], { X: 'minecraft:honey_bottle' }),

  // Weapons and tools
  'minecraft:bow': recipe([' TS', 'T S', ' TS'], { T: STICK, S: 'minecraft:string' }),
  'minecraft:crossbow': recipe(['SIS', 'THT', ' S '], {
    S: STICK,
    I: IRON,
    T: 'minecraft:string',
    H: 'minecraft:tripwire_hook',
  }),
  'minecraft:shield': recipe(['WIW', 'WWW', ' W '], { W: PLANKS, I: IRON }),
  'minecraft:mace': recipe([' H ', ' B '], { H: 'minecraft:heavy_core', B: 'minecraft:breeze_rod' }),
  'minecraft:fishing_rod': recipe(['  S', ' ST', 'S T'], { S: STICK, T: 'minecraft:string' }),
  'minecraft:flint_and_steel': recipe(['I ', ' F'], { I: IRON, F: 'minecraft:flint' }),
  'minecraft:shears': recipe([' I', 'I '], { I: IRON }),
  'minecraft:brush': recipe([' F ', ' C ', ' S '], { F: 'minecraft:feather', C: 'minecraft:copper_ingot', S: STICK }),
  'minecraft:spyglass': recipe([' A ', ' C ', ' C '], { A: 'minecraft:amethyst_shard', C: 'minecraft:copper_ingot' }),
  'minecraft:bucket': recipe(['I I', ' I '], { I: IRON }),
  'minecraft:compass': recipe([' I ', 'IRI', ' I '], { I: IRON, R: 'minecraft:redstone' }),
  'minecraft:clock': recipe([' G ', 'GRG', ' G '], { G: GOLD, R: 'minecraft:redstone' }),

  // Workstations and furniture
  'minecraft:crafting_table': recipe(['PP', 'PP'], { P: PLANKS }),
  'minecraft:chest': recipe(['PPP', 'P P', 'PPP'], { P: PLANKS }),
  'minecraft:furnace': recipe(['CCC', 'C C', 'CCC'], { C: COBBLE }),
  'minecraft:blast_furnace': recipe(['III', 'IFI', 'SSS'], {
    I: IRON,
    F: 'minecraft:furnace',
    S: 'minecraft:smooth_stone',
  }),
  'minecraft:smoker': recipe([' L ', 'LFL', ' L '], { L: 'minecraft:oak_log', F: 'minecraft:furnace' }),
  'minecraft:anvil': recipe(['BBB', ' I ', 'III'], { B: 'minecraft:iron_block', I: IRON }),
  'minecraft:cauldron': recipe(['I I', 'I I', 'III'], { I: IRON }),
  'minecraft:hopper': recipe(['I I', 'ICI', ' I '], { I: IRON, C: 'minecraft:chest' }),
  'minecraft:bookshelf': recipe(['PPP', 'BBB', 'PPP'], { P: PLANKS, B: 'minecraft:book' }),
  'minecraft:book': recipe(['PP', 'PL'], { P: 'minecraft:paper', L: 'minecraft:leather' }),
  'minecraft:enchanting_table': recipe([' B ', 'DOD', 'OOO'], {
    B: 'minecraft:book',
    D: 'minecraft:diamond',
    O: 'minecraft:obsidian',
  }),
  'minecraft:jukebox': recipe(['PPP', 'PDP', 'PPP'], { P: PLANKS, D: 'minecraft:diamond' }),
  'minecraft:beacon': recipe(['GGG', 'GNG', 'OOO'], {
    G: 'minecraft:glass',
    N: 'minecraft:nether_star',
    O: 'minecraft:obsidian',
  }),

  // Redstone and rails
  'minecraft:piston': recipe(['PPP', 'CIC', 'CRC'], { P: PLANKS, C: COBBLE, I: IRON, R: 'minecraft:redstone' }),
  'minecraft:sticky_piston': recipe(['S', 'P'], { S: 'minecraft:slime_ball', P: 'minecraft:piston' }),
  'minecraft:tnt': recipe(['GSG', 'SGS', 'GSG'], { G: 'minecraft:gunpowder', S: 'minecraft:sand' }),
  'minecraft:minecart': recipe(['I I', 'III'], { I: IRON }),
  'minecraft:rail': recipe(['I I', 'ISI', 'I I'], { I: IRON, S: STICK }, 16),
  'minecraft:iron_bars': recipe(['III', 'III'], { I: IRON }, 16),

  // Light
  'minecraft:torch': recipe(['C', 'S'], { C: 'minecraft:coal', S: STICK }, 4),
  'minecraft:lantern': recipe(['NNN', 'NTN', 'NNN'], { N: 'minecraft:iron_nugget', T: 'minecraft:torch' }),

  // Food and odds and ends
  'minecraft:golden_apple': recipe(['GGG', 'GAG', 'GGG'], { G: GOLD, A: 'minecraft:apple' }),
  'minecraft:golden_carrot': recipe(['NNN', 'NCN', 'NNN'], { N: 'minecraft:gold_nugget', C: 'minecraft:carrot' }),
  'minecraft:ender_eye': recipe(['PB'], { P: 'minecraft:ender_pearl', B: 'minecraft:blaze_powder' }),
  [STICK]: recipe(['P', 'P'], { P: PLANKS }, 4),
} satisfies Record<string, Recipe>);

/**
 * The recipe laid out on a 3×3 grid in reading order, centred the way the
 * menu shows it.
 */
export function grid(entry: Recipe): (string | undefined)[] {
  const width = Math.max(...entry.pattern.map((row) => row.length));
  const left = Math.floor((3 - width) / 2);
  const top = Math.floor((3 - entry.pattern.length) / 2);
  const cells: (string | undefined)[] = new Array<string | undefined>(9).fill(undefined);
  entry.pattern.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      const id = entry.key[letter];
      if (id !== undefined) cells[(top + y) * 3 + left + x] = id;
    });
  });
  return cells;
}

/** How many of each item a grid holds. */
export function ingredients(cells: readonly (string | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of cells) if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

// ---------- icons ----------

/** Vanilla texture paths, checked against Mojang/bedrock-samples resource_pack/textures/. */
const ITEM = (name: string): string => `textures/items/${name}`;
const BLOCK = (name: string): string => `textures/blocks/${name}`;

const ICONS: Record<string, string> = {
  'minecraft:stick': ITEM('stick'),
  'minecraft:string': ITEM('string'),
  'minecraft:leather': ITEM('leather'),
  'minecraft:diamond': ITEM('diamond'),
  'minecraft:iron_ingot': ITEM('iron_ingot'),
  'minecraft:gold_ingot': ITEM('gold_ingot'),
  'minecraft:copper_ingot': ITEM('copper_ingot'),
  'minecraft:netherite_ingot': ITEM('netherite_ingot'),
  'minecraft:netherite_upgrade_smithing_template': ITEM('netherite_upgrade_smithing_template'),
  'minecraft:emerald': ITEM('emerald'),
  'minecraft:lapis_lazuli': ITEM('dye_powder_blue_new'),
  'minecraft:redstone': ITEM('redstone_dust'),
  'minecraft:coal': ITEM('coal'),
  'minecraft:raw_iron': ITEM('raw_iron'),
  'minecraft:raw_gold': ITEM('raw_gold'),
  'minecraft:raw_copper': ITEM('raw_copper'),
  'minecraft:wheat': ITEM('wheat'),
  'minecraft:slime_ball': ITEM('slimeball'),
  'minecraft:bone_meal': ITEM('dye_powder_white_new'),
  'minecraft:dried_kelp': ITEM('dried_kelp'),
  'minecraft:honey_bottle': ITEM('honey_bottle'),
  'minecraft:flint': ITEM('flint'),
  'minecraft:breeze_rod': ITEM('breeze_rod'),
  'minecraft:feather': ITEM('feather'),
  'minecraft:amethyst_shard': ITEM('amethyst_shard'),
  'minecraft:book': ITEM('book_normal'),
  'minecraft:paper': ITEM('paper'),
  'minecraft:nether_star': ITEM('nether_star'),
  'minecraft:gunpowder': ITEM('gunpowder'),
  'minecraft:iron_nugget': ITEM('iron_nugget'),
  'minecraft:gold_nugget': ITEM('gold_nugget'),
  'minecraft:apple': ITEM('apple'),
  'minecraft:carrot': ITEM('carrot'),
  'minecraft:ender_pearl': ITEM('ender_pearl'),
  'minecraft:blaze_powder': ITEM('blaze_powder'),
  'minecraft:bow': ITEM('bow_standby'),
  'minecraft:crossbow': ITEM('crossbow_standby'),
  'minecraft:shield': ITEM('empty_armor_slot_shield'),
  'minecraft:mace': ITEM('mace'),
  'minecraft:fishing_rod': ITEM('fishing_rod_uncast'),
  'minecraft:flint_and_steel': ITEM('flint_and_steel'),
  'minecraft:shears': ITEM('shears'),
  'minecraft:brush': ITEM('brush'),
  'minecraft:spyglass': ITEM('spyglass'),
  'minecraft:bucket': ITEM('bucket_empty'),
  'minecraft:compass': ITEM('compass_item'),
  'minecraft:clock': ITEM('clock_item'),
  'minecraft:minecart': ITEM('minecart_normal'),
  'minecraft:golden_apple': ITEM('apple_golden'),
  'minecraft:golden_carrot': ITEM('carrot_golden'),
  'minecraft:ender_eye': ITEM('ender_eye'),
  'minecraft:cauldron': ITEM('cauldron'),
  'minecraft:hopper': ITEM('hopper'),
  'minecraft:lantern': ITEM('lantern'),

  'minecraft:oak_planks': BLOCK('planks_oak'),
  'minecraft:cobblestone': BLOCK('cobblestone'),
  'minecraft:smooth_stone': BLOCK('stone_slab_top'),
  'minecraft:oak_log': BLOCK('log_oak'),
  'minecraft:obsidian': BLOCK('obsidian'),
  'minecraft:glass': BLOCK('glass'),
  'minecraft:sand': BLOCK('sand'),
  'minecraft:heavy_core': BLOCK('heavy_core'),
  'minecraft:tripwire_hook': BLOCK('trip_wire_source'),
  'minecraft:torch': BLOCK('torch_on'),
  'minecraft:furnace': BLOCK('furnace_front_off'),
  'minecraft:chest': BLOCK('chest_front'),
  'minecraft:piston': BLOCK('piston_side'),
  'minecraft:sticky_piston': BLOCK('piston_side'),
  'minecraft:crafting_table': BLOCK('crafting_table_front'),
  'minecraft:blast_furnace': BLOCK('blast_furnace_front_off'),
  'minecraft:smoker': BLOCK('smoker_front_off'),
  'minecraft:anvil': BLOCK('anvil_top_damaged_0'),
  'minecraft:bookshelf': BLOCK('bookshelf'),
  'minecraft:enchanting_table': BLOCK('enchanting_table_side'),
  'minecraft:jukebox': BLOCK('jukebox_side'),
  'minecraft:beacon': BLOCK('beacon'),
  'minecraft:tnt': BLOCK('tnt_side'),
  'minecraft:rail': BLOCK('rail_normal'),
  'minecraft:iron_bars': BLOCK('iron_bars'),
  'minecraft:iron_block': BLOCK('iron_block'),
  'minecraft:gold_block': BLOCK('gold_block'),
  'minecraft:diamond_block': BLOCK('diamond_block'),
  'minecraft:emerald_block': BLOCK('emerald_block'),
  'minecraft:lapis_block': BLOCK('lapis_block'),
  'minecraft:redstone_block': BLOCK('redstone_block'),
  'minecraft:coal_block': BLOCK('coal_block'),
  'minecraft:copper_block': BLOCK('copper_block'),
  'minecraft:netherite_block': BLOCK('netherite_block'),
  'minecraft:raw_iron_block': BLOCK('raw_iron_block'),
  'minecraft:raw_gold_block': BLOCK('raw_gold_block'),
  'minecraft:raw_copper_block': BLOCK('raw_copper_block'),
  'minecraft:hay_block': BLOCK('hay_block_side'),
  'minecraft:slime': BLOCK('slime'),
  'minecraft:bone_block': BLOCK('bone_block_side'),
  'minecraft:dried_kelp_block': BLOCK('dried_kelp_side_a'),
  'minecraft:honey_block': BLOCK('honey_side'),
};

// Tools and armor follow the texture names' own spelling of each tier.
const TOOL_TIERS: Record<string, string> = {
  wooden: 'wood',
  stone: 'stone',
  iron: 'iron',
  golden: 'gold',
  diamond: 'diamond',
  netherite: 'netherite',
};
const ARMOR_TIERS: Record<string, string> = {
  leather: 'leather',
  iron: 'iron',
  golden: 'gold',
  diamond: 'diamond',
  netherite: 'netherite',
};
for (const [tier, name] of Object.entries(TOOL_TIERS)) {
  for (const tool of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) ICONS[`minecraft:${tier}_${tool}`] = ITEM(`${name}_${tool}`);
}
for (const [tier, name] of Object.entries(ARMOR_TIERS)) {
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) ICONS[`minecraft:${tier}_${piece}`] = ITEM(`${name}_${piece}`);
}

/** The menu icon for an item, or undefined to leave the slot without one. */
export function iconFor(typeId: string): string | undefined {
  return ICONS[typeId];
}

/** Every item id the recipes mention, for the debug check and tooling. */
export function allItemIds(): string[] {
  const ids = new Set<string>();
  for (const [id, entry] of Object.entries(RECIPES)) {
    ids.add(id);
    for (const ingredient of Object.values(entry.key)) ids.add(ingredient);
  }
  return [...ids].sort();
}
