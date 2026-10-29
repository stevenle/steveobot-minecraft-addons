/**
 * Block classification for the dungeon generator: what counts as untouched
 * underground, what betrays a build or another structure (a hard stop),
 * and what is ground at the surface.
 */

/** Underground blocks the generator may carve through freely. */
const NATURAL = new Set([
  'minecraft:air', 'minecraft:water', 'minecraft:flowing_water', 'minecraft:lava', 'minecraft:flowing_lava',
  'minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:granite', 'minecraft:diorite',
  'minecraft:andesite', 'minecraft:calcite', 'minecraft:smooth_basalt', 'minecraft:dripstone_block',
  'minecraft:pointed_dripstone', 'minecraft:dirt', 'minecraft:coarse_dirt', 'minecraft:rooted_dirt',
  'minecraft:gravel', 'minecraft:clay', 'minecraft:sand', 'minecraft:red_sand', 'minecraft:sandstone',
  'minecraft:red_sandstone', 'minecraft:grass_block', 'minecraft:podzol', 'minecraft:mycelium', 'minecraft:mud',
  'minecraft:moss_block', 'minecraft:moss_carpet', 'minecraft:glow_lichen', 'minecraft:cave_vines',
  'minecraft:cave_vines_body_with_berries', 'minecraft:cave_vines_head_with_berries', 'minecraft:hanging_roots',
  'minecraft:spore_blossom', 'minecraft:azalea', 'minecraft:flowering_azalea', 'minecraft:big_dripleaf',
  'minecraft:small_dripleaf_block', 'minecraft:amethyst_block', 'minecraft:budding_amethyst',
  'minecraft:small_amethyst_bud', 'minecraft:medium_amethyst_bud', 'minecraft:large_amethyst_bud',
  'minecraft:amethyst_cluster', 'minecraft:magma', 'minecraft:obsidian', 'minecraft:sculk', 'minecraft:sculk_vein',
  'minecraft:sculk_sensor', 'minecraft:sculk_shrieker', 'minecraft:sculk_catalyst', 'minecraft:snow',
  'minecraft:snow_layer', 'minecraft:ice', 'minecraft:packed_ice', 'minecraft:blue_ice', 'minecraft:powder_snow',
  'minecraft:raw_iron_block', 'minecraft:raw_copper_block', 'minecraft:bedrock', 'minecraft:seagrass',
  'minecraft:kelp', 'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern',
  'minecraft:deadbush', 'minecraft:bubble_column', 'minecraft:pale_moss_block', 'minecraft:pale_moss_carpet',
]);

/**
 * Anything matching this is a build, a vanilla structure (mineshaft,
 * stronghold, ancient city, dungeon, trial chamber), or another creeper
 * dungeon. One of these anywhere in the sample and the site is rejected.
 */
const ARTIFICIAL = /planks|chest|rail|fence|torch|glass|wool|_bed$|door|crafting|furnace|spawner|brick|lantern|concrete|_slab|_stairs|_wall$|ladder|sign|barrel|bookshelf|carpet|candle|scaffolding|beacon|anvil|shulker|bulb|lamp|pressure_plate|button|lever|redstone|hopper|dispenser|dropper|piston|observer|tnt|bell|campfire|cobblestone|polished_|chiseled|cut_|smooth_stone|web|vault|trial|copper|tiles|reinforced|^steveo:/;

export function isNatural(id: string): boolean {
  return NATURAL.has(id) || id.endsWith('_ore') || id.startsWith('minecraft:infested_') || /terracotta$/.test(id);
}

export function isArtificial(id: string): boolean {
  if (isNatural(id)) return false;
  return ARTIFICIAL.test(id);
}

export function isLiquid(id: string): boolean {
  return id.endsWith('water') || id.endsWith('lava') || id === 'minecraft:bubble_column';
}

/** What the surface search skips over on the way down to the ground. */
export function isCover(id: string): boolean {
  return (
    id === 'minecraft:air' ||
    id.endsWith('_leaves') ||
    id.endsWith('_log') ||
    id.endsWith('_wood') ||
    id.endsWith('_stem') ||
    id.endsWith('mushroom_block') ||
    id.endsWith('_sapling') ||
    id.endsWith('_flower') ||
    id.endsWith('_tulip') ||
    id.endsWith('vines') ||
    id === 'minecraft:vine' ||
    id === 'minecraft:snow_layer' ||
    id === 'minecraft:short_grass' ||
    id === 'minecraft:tall_grass' ||
    id === 'minecraft:fern' ||
    id === 'minecraft:large_fern' ||
    id === 'minecraft:deadbush' ||
    id === 'minecraft:sweet_berry_bush' ||
    id === 'minecraft:bamboo' ||
    id === 'minecraft:cactus' ||
    id === 'minecraft:sugar_cane' ||
    id === 'minecraft:pumpkin' ||
    id === 'minecraft:melon_block' ||
    id === 'minecraft:bee_nest' ||
    id === 'minecraft:moss_carpet' ||
    id === 'minecraft:pale_moss_carpet' ||
    id === 'minecraft:pale_hanging_moss' ||
    id === 'minecraft:dandelion' ||
    id === 'minecraft:poppy'
  );
}

/** Solid natural ground a ruin can stand on. */
export function isGround(id: string): boolean {
  return isNatural(id) && !isLiquid(id) && !isCover(id) && !id.endsWith('ice') && id !== 'minecraft:powder_snow';
}

/** Blocks a surface ruin may clear away: air, plants, snow. */
export function isReplaceable(id: string): boolean {
  return id === 'minecraft:air' || (isCover(id) && !id.endsWith('_leaves') && !id.endsWith('_log') && !id.endsWith('_wood') && !id.endsWith('_stem'));
}
