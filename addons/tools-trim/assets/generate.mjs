// Generates everything derived for this add-on from the tables below:
//   - behavior_pack/items/<tier>_<tool>_<material>_trim.json, one custom item
//     per trimmed tool (7 tiers x 6 tools x 11 materials = 462), each a copy of
//     the untrimmed tool's stats
//   - behavior_pack/recipes/: the Better Smithing Table, and a netherite
//     upgrade per trimmed diamond tool so the trim survives the upgrade
//   - resource_pack/textures/items/trimmed/*.png: the vanilla tool texture with
//     a trim overlay colored from Mojang's own trim palettes
//   - the Better Smithing Table textures, the pack icons, and the generated
//     block of item names in en_US.lang
//
// Inputs under assets/vanilla/ are unmodified copies from Mojang/bedrock-samples
// v1.26.50.4 (resource_pack/textures/items/<tier>_<tool>.png,
// textures/trims/color_palettes/*.png, textures/blocks/smithing_table_*.png).
// Paxels are not vanilla: their stats, names, and icons are read straight from
// the paxel add-on (addons/paxel), so rerun this after regenerating that one.
//
// Run from the repo root:  node addons/tools-trim/assets/generate.mjs addons/tools-trim
// The generated output is what gets committed; this script only regenerates it.
// Keep TIERS, TOOLS, and MATERIALS in step with src/trims.ts.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');
const vanilla = path.join(path.dirname(new URL(import.meta.url).pathname), 'vanilla');

// ---------- Tables ----------

// Bedrock values for the vanilla tools of each material. `attack` is the
// sword's total hit; the other tools hit for less (TOOLS[].attackOffset).
// The item's minecraft:damage is the bonus over a bare fist, so total - 1.
// `texture` is the tier's name in vanilla texture file names. Copper has no
// confirmed tier tag, so it borrows stone's, as the paxel add-on does.
const TIERS = [
  { id: 'wooden', texture: 'wood', name: 'Wooden', durability: 59, speed: 2, attack: 5, enchant: 15, tier: 'minecraft:wooden_tier', mines: 0, repair: ['minecraft:oak_planks', 'minecraft:spruce_planks', 'minecraft:birch_planks', 'minecraft:jungle_planks', 'minecraft:acacia_planks', 'minecraft:dark_oak_planks', 'minecraft:mangrove_planks', 'minecraft:cherry_planks', 'minecraft:pale_oak_planks', 'minecraft:bamboo_planks', 'minecraft:crimson_planks', 'minecraft:warped_planks'] },
  { id: 'stone', texture: 'stone', name: 'Stone', durability: 131, speed: 4, attack: 6, enchant: 5, tier: 'minecraft:stone_tier', mines: 1, repair: ['minecraft:cobblestone', 'minecraft:cobbled_deepslate', 'minecraft:blackstone'] },
  { id: 'copper', texture: 'copper', name: 'Copper', durability: 190, speed: 5, attack: 6, enchant: 13, tier: 'minecraft:stone_tier', mines: 1, repair: ['minecraft:copper_ingot'], trimMatch: 'copper' },
  { id: 'iron', texture: 'iron', name: 'Iron', durability: 250, speed: 6, attack: 7, enchant: 14, tier: 'minecraft:iron_tier', mines: 2, repair: ['minecraft:iron_ingot'], trimMatch: 'iron' },
  { id: 'golden', texture: 'gold', name: 'Golden', durability: 32, speed: 12, attack: 5, enchant: 22, tier: 'minecraft:golden_tier', mines: 0, repair: ['minecraft:gold_ingot'], trimMatch: 'gold' },
  // The smithing table's base slot only takes items with
  // minecraft:transformable_items, so the trimmed diamond tools carry it for
  // the netherite upgrade (see the paxel add-on's history).
  { id: 'diamond', texture: 'diamond', name: 'Diamond', durability: 1561, speed: 8, attack: 8, enchant: 10, tier: 'minecraft:diamond_tier', mines: 3, repair: ['minecraft:diamond'], trimMatch: 'diamond', extraTags: ['minecraft:transformable_items'] },
  { id: 'netherite', texture: 'netherite', name: 'Netherite', durability: 2031, speed: 9, attack: 9, enchant: 15, tier: 'minecraft:netherite_tier', mines: 3, repair: ['minecraft:netherite_ingot'], trimMatch: 'netherite' },
];

// Block tags a pickaxe must at least match to mine a block at speed; a tier
// with `mines: n` is fast on everything below index n's requirement. Both the
// older *_pick_diggable names and the newer *_tier_destructible ones are
// listed; a tag the game does not define simply never matches.
const PICK_REQUIREMENTS = [
  ['stone_pick_diggable', 'minecraft:stone_tier_destructible'],
  ['iron_pick_diggable', 'minecraft:iron_tier_destructible'],
  ['diamond_pick_diggable', 'minecraft:diamond_tier_destructible'],
];

// Trim regions per tool, as [x0, y0, x1, y1] rectangles (inclusive) on the
// 16x16 icon, each with the palette index range its pixels are shaded across
// (brightest vanilla pixel -> lo, darkest -> hi). Only opaque pixels are
// trimmed, so tiers whose silhouettes differ slightly (netherite, the hoes)
// still come out right. The digging tools get a binding where the head meets
// the handle and a wrapped grip; the sword gets an inlaid fuller down the
// blade and a trimmed pommel.
// The grip is wound, not painted: every third diagonal across the handle is
// left bare.
const GRIP = { rects: [[3, 10, 7, 12]], lo: 1, hi: 6, skip: (x, y) => (y - x) % 3 === 0 };
// Swords enchant in the melee_spear slot, not sword. Since spears arrived,
// Looting (and likely Knockback and Fire Aspect) only go on items in that
// slot, so a "sword" slot trimmed sword refused Looting from its vanilla twin.
// Every Bedrock sword enchantment is also a spear one, so nothing is lost.
const TOOLS = [
  {
    id: 'sword', name: 'Sword', slot: 'melee_spear', attackOffset: 0, tags: ['minecraft:is_sword'],
    regions: [
      { points: [[13, 2], [12, 3], [11, 4], [10, 5], [9, 6], [8, 7]], lo: 1, hi: 1 },
      { rects: [[0, 13, 1, 15], [2, 14, 2, 15]], lo: 1, hi: 6 },
    ],
  },
  { id: 'pickaxe', name: 'Pickaxe', slot: 'pickaxe', attackOffset: -2, tags: ['minecraft:is_tool', 'minecraft:is_pickaxe', 'minecraft:digger'], regions: [{ rects: [[11, 3, 13, 5]], lo: 0, hi: 6 }, GRIP] },
  { id: 'axe', name: 'Axe', slot: 'axe', attackOffset: -1, tags: ['minecraft:is_tool', 'minecraft:is_axe', 'minecraft:digger'], regions: [{ rects: [[10, 4, 13, 6]], lo: 0, hi: 6 }, GRIP] },
  { id: 'shovel', name: 'Shovel', slot: 'shovel', attackOffset: -3, tags: ['minecraft:is_tool', 'minecraft:is_shovel', 'minecraft:digger'], regions: [{ rects: [[8, 6, 10, 8]], lo: 0, hi: 6 }, GRIP] },
  { id: 'hoe', name: 'Hoe', slot: 'hoe', attackOffset: -3, tags: ['minecraft:is_tool', 'minecraft:is_hoe', 'minecraft:digger'], regions: [{ rects: [[10, 3, 13, 5]], lo: 0, hi: 6 }, GRIP] },
  // From the paxel add-on: a binding where the axe head meets the stick, and
  // a wound grip low on the stick. `custom` marks a tool whose untrimmed item,
  // stats, and icon come from that add-on rather than vanilla.
  {
    id: 'paxel', custom: 'paxel',
    regions: [{ rects: [[8, 6, 10, 7]], lo: 0, hi: 6 }, { rects: [[1, 10, 6, 13]], lo: 1, hi: 6, skip: (x, y) => (y - x) % 3 === 0 }],
  },
];

// The vanilla armor trim materials. `palette` names the file under
// assets/vanilla/palettes; a trim on a tool of the same material uses the
// `_darker` palette when one exists, as vanilla armor does.
const MATERIALS = [
  { id: 'quartz', palette: 'quartz' },
  { id: 'iron', palette: 'iron' },
  { id: 'netherite', palette: 'netherite' },
  { id: 'redstone', palette: 'redstone' },
  { id: 'copper', palette: 'copper' },
  { id: 'gold', palette: 'gold' },
  { id: 'emerald', palette: 'emerald' },
  { id: 'diamond', palette: 'diamond' },
  { id: 'lapis', palette: 'lapis' },
  { id: 'amethyst', palette: 'amethyst' },
  { id: 'resin', palette: 'resin' },
];

const itemId = (tier, tool, mat) => `${tier.id}_${tool.id}_${mat.id}_trim`;
/** The untrimmed tool: vanilla, or the add-on's own item for a custom tool. */
const vanillaId = (tier, tool) => (tool.custom ? `steveo:${tier.id}_${tool.id}` : `minecraft:${tier.id}_${tool.id}`);

// ---------- Custom tools ----------

const addons = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const customDir = (tool) => path.join(addons, tool.custom);
const customItem = (tier, tool) =>
  JSON.parse(fs.readFileSync(path.join(customDir(tool), 'behavior_pack', 'items', `${tier.id}_${tool.id}.json`), 'utf8'))['minecraft:item'];
const customTexture = (tier, tool) => path.join(customDir(tool), 'resource_pack', 'textures', 'items', `${tier.id}_${tool.id}.png`);
const customNames = new Map();
function customName(tier, tool) {
  if (!customNames.has(tool.custom)) {
    const lang = fs.readFileSync(path.join(customDir(tool), 'resource_pack', 'texts', 'en_US.lang'), 'utf8');
    customNames.set(tool.custom, new Map(lang.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])));
  }
  const key = `item.${vanillaId(tier, tool)}.name`;
  const name = customNames.get(tool.custom).get(key);
  if (!name) throw new Error(`${tool.custom} has no ${key}`);
  return name;
}

// ---------- PNG ----------

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let ihdr;
  let palette;
  let trns;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
  }
  const { w, h, depth, color, interlace } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const bpp = Math.max(1, (channels * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * h * 4);
  // Adam7 passes as [x0, y0, dx, dy]; a non-interlaced image is one pass.
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let off = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * channels * depth) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[off];
      const line = Buffer.from(raw.subarray(off + 1, off + 1 + stride));
      off += 1 + stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        line[i] = v & 255;
      }
      prev = line;
      const sample = (x, k) => {
        if (depth === 8) return line[x * channels + k];
        const bit = (x * channels + k) * depth;
        return (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      };
      for (let x = 0; x < pw; x++) {
        let px;
        if (color === 3) {
          const i = sample(x, 0);
          px = [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] : 255];
        } else if (color === 0) {
          const g = sample(x, 0);
          px = [g, g, g, 255];
        } else if (color === 4) {
          const g = sample(x, 0);
          px = [g, g, g, sample(x, 1)];
        } else {
          px = [sample(x, 0), sample(x, 1), sample(x, 2), color === 6 ? sample(x, 3) : 255];
        }
        rgba.set(px, ((y0 + y * dy) * w + x0 + x * dx) * 4);
      }
    }
  }
  return { w, h, rgba };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Art ----------

const luminance = (rgba, i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];

function loadPalette(name) {
  const { rgba } = decodePng(path.join(vanilla, 'palettes', `${name}.png`));
  return Array.from({ length: 8 }, (_, i) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
}
const palettes = Object.fromEntries(
  fs.readdirSync(path.join(vanilla, 'palettes')).filter((f) => f.endsWith('.png')).map((f) => [f.slice(0, -4), loadPalette(f.slice(0, -4))]),
);

function regionPixels(region) {
  const points = [...(region.points ?? [])];
  for (const [x0, y0, x1, y1] of region.rects ?? []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) points.push([x, y]);
  }
  return region.skip ? points.filter(([x, y]) => !region.skip(x, y)) : points;
}

/**
 * Recolors each region of a 16x16 texture with a trim palette. Within a region,
 * the distinct luminances of the opaque pixels are ranked and spread across the
 * region's palette range, so the trim keeps the shading of what it covers.
 */
function applyTrim(base, regions, palette) {
  const rgba = Buffer.from(base);
  for (const region of regions) {
    const pixels = regionPixels(region).map(([x, y]) => (y * 16 + x) * 4).filter((i) => base[i + 3] > 0);
    const levels = [...new Set(pixels.map((i) => Math.round(luminance(base, i))))].sort((a, b) => b - a);
    for (const i of pixels) {
      const rank = levels.indexOf(Math.round(luminance(base, i)));
      const t = levels.length > 1 ? rank / (levels.length - 1) : 0;
      const [r, g, b] = palette[Math.round(region.lo + t * (region.hi - region.lo))];
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/** Repaints the gray metal of the vanilla smithing table in a palette, leaving the wood alone. */
function plate(file, palette) {
  const { rgba } = decodePng(path.join(vanilla, 'blocks', file));
  const metal = [];
  for (let i = 0; i < rgba.length; i += 4) {
    const spread = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) - Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (spread < 30) metal.push(i);
  }
  const ls = metal.map((i) => luminance(rgba, i));
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  for (const i of metal) {
    const t = hi > lo ? (hi - luminance(rgba, i)) / (hi - lo) : 0;
    const [r, g, b] = palette[Math.round(t * 7)];
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
  }
  return rgba;
}

/** 128x128: a 16x16 icon scaled 7x on a dark slate background with a border, as the paxel add-on does. */
function packIcon(icon) {
  const S = 128;
  const scale = 7;
  const off = (S - 16 * scale) / 2;
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    let c = edge ? [40, 44, 52] : [62, 68, 80];
    const gx = Math.floor((x - off) / scale);
    const gy = Math.floor((y - off) / scale);
    if (gx >= 0 && gx < 16 && gy >= 0 && gy < 16) {
      const j = (gy * 16 + gx) * 4;
      if (icon[j + 3] > 0) c = [icon[j], icon[j + 1], icon[j + 2]];
    }
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  return encodePng(S, S, buf);
}

// ---------- JSON ----------

const anyTag = (list) => `query.any_tag(${list.map((t) => `'${t}'`).join(', ')})`;

/** Digger speeds that match the vanilla tool of this kind and tier. */
function destroySpeeds(tier, tool) {
  switch (tool.id) {
    case 'pickaxe': {
      const tooHard = PICK_REQUIREMENTS.slice(tier.mines).flat();
      const fast = anyTag(['stone', 'metal', 'minecraft:is_pickaxe_item_destructible', ...PICK_REQUIREMENTS.slice(0, tier.mines).flat()]);
      return [{ block: { tags: tooHard.length > 0 ? `${fast} && !${anyTag(tooHard)}` : fast }, speed: tier.speed }];
    }
    case 'axe':
      return [{ block: { tags: anyTag(['wood', 'pumpkin', 'minecraft:is_axe_item_destructible']) }, speed: tier.speed }];
    case 'shovel':
      return [{ block: { tags: anyTag(['dirt', 'sand', 'gravel', 'grass', 'snow', 'minecraft:is_shovel_item_destructible']) }, speed: tier.speed }];
    case 'hoe':
      return [{ block: { tags: anyTag(['minecraft:is_hoe_item_destructible']) }, speed: tier.speed }];
    case 'sword':
      return [
        { block: 'minecraft:web', speed: 15 },
        { block: 'minecraft:bamboo', speed: 20 },
        { block: { tags: anyTag(['minecraft:is_sword_item_destructible']) }, speed: 1.5 },
      ];
    default:
      throw new Error(`no digger for ${tool.id}`);
  }
}

/**
 * A trimmed custom tool: the add-on's own item with a new id, icon, and name,
 * hidden from the creative inventory, and repairable by combining with
 * itself or its untrimmed twin.
 */
function customItemJson(tier, tool, mat) {
  const id = itemId(tier, tool, mat);
  const source = customItem(tier, tool);
  const components = structuredClone(source.components);
  components['minecraft:icon'] = `steveo_${id}`;
  components['minecraft:display_name'] = { value: `item.steveo:${id}.name` };
  const repair = components['minecraft:repairable']?.repair_items ?? [];
  components['minecraft:repairable'] = {
    repair_items: [
      ...repair,
      {
        items: [`steveo:${id}`, vanillaId(tier, tool)],
        repair_amount: 'context.other->query.remaining_durability + 0.05 * context.other->query.max_durability',
      },
    ],
  };
  const tags = components['minecraft:tags']?.tags ?? [];
  components['minecraft:tags'] = { tags: [...tags, 'steveo:trimmed_tool'] };
  return {
    format_version: '1.21.40',
    'minecraft:item': {
      description: { identifier: `steveo:${id}`, menu_category: { category: 'none' } },
      components,
    },
  };
}

function itemJson(tier, tool, mat) {
  if (tool.custom) return customItemJson(tier, tool, mat);
  const id = itemId(tier, tool, mat);
  return {
    format_version: '1.21.40',
    'minecraft:item': {
      description: {
        identifier: `steveo:${id}`,
        // Hidden from the creative inventory: 385 near-duplicates would bury
        // everything else. They are made at the Better Smithing Table.
        menu_category: { category: 'none' },
      },
      components: {
        'minecraft:icon': `steveo_${id}`,
        'minecraft:display_name': { value: `item.steveo:${id}.name` },
        'minecraft:max_stack_size': 1,
        'minecraft:hand_equipped': true,
        // Vanilla swords cannot break blocks in creative.
        'minecraft:can_destroy_in_creative': tool.id !== 'sword',
        'minecraft:damage': tier.attack + tool.attackOffset - 1,
        'minecraft:durability': { max_durability: tier.durability },
        'minecraft:enchantable': { slot: tool.slot, value: tier.enchant },
        'minecraft:repairable': {
          repair_items: [
            { items: tier.repair, repair_amount: 'query.max_durability * 0.25' },
            // Combining with the same tool, trimmed or not, like vanilla.
            {
              items: [`steveo:${id}`, vanillaId(tier, tool)],
              repair_amount: 'context.other->query.remaining_durability + 0.05 * context.other->query.max_durability',
            },
          ],
        },
        'minecraft:tags': { tags: [...tool.tags, tier.tier, 'steveo:trimmed_tool', ...(tier.extraTags ?? [])] },
        'minecraft:digger': { use_efficiency: true, destroy_speeds: destroySpeeds(tier, tool) },
      },
    },
  };
}

function netheriteUpgradeJson(tool, mat) {
  const diamond = TIERS.find((t) => t.id === 'diamond');
  const netherite = TIERS.find((t) => t.id === 'netherite');
  return {
    format_version: '1.21.40',
    'minecraft:recipe_smithing_transform': {
      description: { identifier: `steveo:${itemId(netherite, tool, mat)}_smithing` },
      tags: ['smithing_table'],
      template: 'minecraft:netherite_upgrade_smithing_template',
      base: `steveo:${itemId(diamond, tool, mat)}`,
      addition: 'minecraft:netherite_ingot',
      result: `steveo:${itemId(netherite, tool, mat)}`,
    },
  };
}

const tableRecipe = {
  format_version: '1.21.40',
  'minecraft:recipe_shaped': {
    description: { identifier: 'steveo:better_smithing_table_recipe' },
    tags: ['crafting_table'],
    pattern: [' G ', 'GSG', ' G '],
    key: { G: { item: 'minecraft:gold_ingot' }, S: { item: 'minecraft:smithing_table' } },
    unlock: [{ item: 'minecraft:smithing_table' }],
    result: { item: 'steveo:better_smithing_table' },
  },
};

const tableBlock = {
  format_version: '1.21.60',
  'minecraft:block': {
    description: {
      identifier: 'steveo:better_smithing_table',
      menu_category: { category: 'items' },
    },
    components: {
      'minecraft:display_name': 'tile.steveo:better_smithing_table.name',
      'minecraft:geometry': 'minecraft:geometry.full_block',
      'minecraft:material_instances': {
        '*': { texture: 'steveo_better_smithing_table_side', render_method: 'opaque' },
        north: { texture: 'steveo_better_smithing_table_front', render_method: 'opaque' },
        south: { texture: 'steveo_better_smithing_table_front', render_method: 'opaque' },
        up: { texture: 'steveo_better_smithing_table_top', render_method: 'opaque' },
        down: { texture: 'steveo_better_smithing_table_bottom', render_method: 'opaque' },
      },
      'minecraft:map_color': '#B1671A',
      'minecraft:flammable': { catch_chance_modifier: 5, destroy_chance_modifier: 20 },
      'minecraft:destructible_by_explosion': { explosion_resistance: 2.5 },
      'minecraft:destructible_by_mining': {
        seconds_to_destroy: 2.5,
        item_specific_speeds: [{ item: { tags: "q.any_tag('minecraft:is_axe')" }, destroy_speed: 0.6 }],
      },
    },
  },
};

// ---------- Write ----------

const bp = path.join(out, 'behavior_pack');
const rp = path.join(out, 'resource_pack');
const dirs = {
  items: path.join(bp, 'items'),
  recipes: path.join(bp, 'recipes'),
  blocks: path.join(bp, 'blocks'),
  icons: path.join(rp, 'textures', 'items', 'trimmed'),
  blockTextures: path.join(rp, 'textures', 'blocks'),
};
// Regenerating replaces the item and recipe sets wholesale, so a removed
// material or tier leaves nothing stale behind.
for (const d of [dirs.items, dirs.recipes, dirs.icons]) fs.rmSync(d, { recursive: true, force: true });
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

const itemTextures = {};
const names = [];
let packArt;
for (const tier of TIERS) {
  for (const tool of TOOLS) {
    const base = decodePng(tool.custom ? customTexture(tier, tool) : path.join(vanilla, 'tools', `${tier.texture}_${tool.id}.png`)).rgba;
    for (const mat of MATERIALS) {
      const id = itemId(tier, tool, mat);
      const darker = tier.trimMatch === mat.id && palettes[`${mat.palette}_darker`];
      const art = applyTrim(base, tool.regions, darker || palettes[mat.palette]);
      fs.writeFileSync(path.join(dirs.icons, `${id}.png`), encodePng(16, 16, art));
      write(path.join(dirs.items, `${id}.json`), itemJson(tier, tool, mat));
      itemTextures[`steveo_${id}`] = { textures: `textures/items/trimmed/${id}` };
      // Same name as the untrimmed tool, as vanilla does for trimmed armor.
      names.push(`item.steveo:${id}.name=${tool.custom ? customName(tier, tool) : `${tier.name} ${tool.name}`}`);
      if (tier.id === 'diamond') write(path.join(dirs.recipes, `${itemId(TIERS.at(-1), tool, mat)}.json`), netheriteUpgradeJson(tool, mat));
      if (tier.id === 'diamond' && tool.id === 'pickaxe' && mat.id === 'gold') packArt = art;
    }
  }
}
write(path.join(dirs.recipes, 'better_smithing_table.json'), tableRecipe);
write(path.join(dirs.blocks, 'better_smithing_table.json'), tableBlock);

write(path.join(rp, 'textures', 'item_texture.json'), {
  resource_pack_name: 'tools-trim',
  texture_name: 'atlas.items',
  texture_data: itemTextures,
});

const gold = palettes.gold;
const terrain = {};
for (const face of ['top', 'side', 'front', 'bottom']) {
  const name = `better_smithing_table_${face}`;
  fs.writeFileSync(path.join(dirs.blockTextures, `${name}.png`), encodePng(16, 16, plate(`smithing_table_${face}.png`, gold)));
  terrain[`steveo_${name}`] = { textures: `textures/blocks/${name}` };
}
write(path.join(rp, 'textures', 'terrain_texture.json'), {
  resource_pack_name: 'tools-trim',
  texture_name: 'atlas.terrain',
  padding: 8,
  num_mip_levels: 4,
  texture_data: terrain,
});
write(path.join(rp, 'blocks.json'), { format_version: [1, 1, 0], 'steveo:better_smithing_table': { sound: 'wood' } });

// The item names live between markers in en_US.lang; everything else in that
// file is written by hand.
const BEGIN = '## BEGIN GENERATED: trimmed tool names (assets/generate.mjs)';
const END = '## END GENERATED';
const langFile = path.join(rp, 'texts', 'en_US.lang');
const lang = fs.readFileSync(langFile, 'utf8');
const start = lang.indexOf(BEGIN);
const end = lang.indexOf(END);
if (start < 0 || end < start) throw new Error(`${langFile} is missing the generated-block markers`);
fs.writeFileSync(langFile, `${lang.slice(0, start)}${BEGIN}\n${names.join('\n')}\n${lang.slice(end)}`);

const icon = packIcon(packArt);
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(bp, 'pack_icon.png'), icon);
console.log(`wrote ${names.length} trimmed tools, ${MATERIALS.length * TOOLS.length} netherite upgrades, the table, and pack icons to`, out);
