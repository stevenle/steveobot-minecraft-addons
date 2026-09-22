// Generates the per-tier item definitions, recipes, item icons, and the pack
// icons for this add-on from the TIERS table below.
// Run from the repo root:  node addons/paxel/assets/generate.mjs addons/paxel
// The generated files are what gets committed; this script only regenerates
// them. Edit the table, rerun, and commit the output.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

// ---------- Tiers ----------
// Numbers follow the vanilla tools of the same material (Bedrock values):
// durability, dig speed, sword damage, and enchantability. `tier` is the item
// tag the game reads for drop eligibility; copper mines the same blocks as
// stone, and there is no confirmed copper_tier tag, so it borrows stone's.
// `diggable` lists the pickaxe block tags this tier breaks at full speed;
// block tags like iron_pick_diggable mark the minimum pickaxe a block needs.
const PICK_BASE = ['stone', 'metal'];
const TIERS = [
  {
    id: 'wooden', name: 'Wooden Paxel', durability: 59, speed: 2, damage: 4, enchant: 15,
    tier: 'minecraft:wooden_tier', diggable: PICK_BASE,
    ingredient: { tag: 'minecraft:planks' },
    repair: ['minecraft:oak_planks', 'minecraft:spruce_planks', 'minecraft:birch_planks', 'minecraft:jungle_planks', 'minecraft:acacia_planks', 'minecraft:dark_oak_planks', 'minecraft:mangrove_planks', 'minecraft:cherry_planks', 'minecraft:pale_oak_planks', 'minecraft:bamboo_planks', 'minecraft:crimson_planks', 'minecraft:warped_planks'],
    unlock: [{ item: 'minecraft:stick' }],
    colors: { A: [55, 41, 16], B: [134, 101, 38], C: [107, 81, 31], D: [117, 88, 33], I: [32, 24, 10], J: [89, 67, 25] },
  },
  {
    id: 'stone', name: 'Stone Paxel', durability: 131, speed: 4, damage: 5, enchant: 5,
    tier: 'minecraft:stone_tier', diggable: [...PICK_BASE, 'stone_pick_diggable'],
    ingredient: { tag: 'minecraft:stone_tool_materials' },
    repair: ['minecraft:cobblestone', 'minecraft:cobbled_deepslate', 'minecraft:blackstone'],
    unlock: [{ item: 'minecraft:cobblestone' }, { item: 'minecraft:cobbled_deepslate' }, { item: 'minecraft:blackstone' }],
    colors: { A: [73, 73, 73], B: [154, 154, 154], C: [127, 127, 127], D: [137, 137, 137], I: [24, 24, 24], J: [108, 108, 108] },
  },
  {
    id: 'copper', name: 'Copper Paxel', durability: 190, speed: 5, damage: 5, enchant: 13,
    tier: 'minecraft:stone_tier', diggable: [...PICK_BASE, 'stone_pick_diggable'],
    ingredient: { item: 'minecraft:copper_ingot' },
    repair: ['minecraft:copper_ingot'],
    unlock: [{ item: 'minecraft:copper_ingot' }],
    colors: { A: [107, 50, 32], B: [252, 174, 156], C: [219, 115, 80], D: [242, 143, 116], I: [68, 28, 19], J: [187, 88, 53] },
  },
  {
    id: 'iron', name: 'Iron Paxel', durability: 250, speed: 6, damage: 6, enchant: 14,
    tier: 'minecraft:iron_tier', diggable: [...PICK_BASE, 'stone_pick_diggable', 'iron_pick_diggable'],
    ingredient: { item: 'minecraft:iron_ingot' },
    repair: ['minecraft:iron_ingot'],
    unlock: [{ item: 'minecraft:iron_ingot' }],
    colors: { A: [68, 68, 68], B: [255, 255, 255], C: [193, 193, 193], D: [216, 216, 216], I: [24, 24, 24], J: [150, 150, 150] },
  },
  {
    id: 'golden', name: 'Golden Paxel', durability: 32, speed: 12, damage: 4, enchant: 22,
    tier: 'minecraft:golden_tier', diggable: PICK_BASE,
    ingredient: { item: 'minecraft:gold_ingot' },
    repair: ['minecraft:gold_ingot'],
    unlock: [{ item: 'minecraft:gold_ingot' }],
    colors: { A: [130, 93, 22], B: [253, 255, 118], C: [233, 177, 21], D: [234, 238, 87], I: [63, 46, 14], J: [220, 150, 19] },
  },
  {
    id: 'diamond', name: 'Diamond Paxel', durability: 1561, speed: 8, damage: 7, enchant: 10,
    tier: 'minecraft:diamond_tier', diggable: [...PICK_BASE, 'stone_pick_diggable', 'iron_pick_diggable', 'diamond_pick_diggable'],
    ingredient: { item: 'minecraft:diamond' },
    repair: ['minecraft:diamond'],
    unlock: [{ item: 'minecraft:diamond' }],
    colors: { A: [14, 63, 54], B: [51, 235, 203], C: [39, 178, 154], D: [43, 199, 172], I: [8, 37, 32], J: [30, 138, 119] },
  },
  {
    id: 'netherite', name: 'Netherite Paxel', durability: 2031, speed: 9, damage: 8, enchant: 15,
    tier: 'minecraft:netherite_tier', diggable: [...PICK_BASE, 'stone_pick_diggable', 'iron_pick_diggable', 'diamond_pick_diggable'],
    // Made at a smithing table from the diamond paxel, like vanilla netherite gear.
    smithing: { base: 'diamond', template: 'minecraft:netherite_upgrade_smithing_template', addition: 'minecraft:netherite_ingot' },
    repair: ['minecraft:netherite_ingot'],
    colors: { A: [74, 41, 64], B: [134, 123, 134], C: [79, 60, 62], D: [93, 86, 93], I: [35, 16, 18], J: [50, 39, 39] },
  },
];

// ---------- Item JSON ----------
function tags(list) {
  return `query.any_tag(${list.map((t) => `'${t}'`).join(', ')})`;
}
function itemJson(t) {
  return {
    format_version: '1.21.40',
    'minecraft:item': {
      description: {
        identifier: `steveo:${t.id}_paxel`,
        menu_category: { category: 'equipment', group: 'minecraft:itemGroup.name.pickaxe' },
      },
      components: {
        'minecraft:icon': `steveo_${t.id}_paxel`,
        'minecraft:display_name': { value: `item.steveo:${t.id}_paxel.name` },
        'minecraft:max_stack_size': 1,
        'minecraft:hand_equipped': true,
        'minecraft:can_destroy_in_creative': true,
        'minecraft:damage': t.damage,
        'minecraft:durability': { max_durability: t.durability },
        'minecraft:enchantable': { slot: 'pickaxe', value: t.enchant },
        'minecraft:repairable': {
          repair_items: [{ items: t.repair, repair_amount: 'query.max_durability * 0.25' }],
        },
        'minecraft:tags': {
          tags: ['minecraft:is_tool', 'minecraft:is_pickaxe', 'minecraft:is_axe', 'minecraft:is_shovel', t.tier],
        },
        'minecraft:digger': {
          use_efficiency: true,
          destroy_speeds: [
            { block: { tags: tags(t.diggable) }, speed: t.speed },
            { block: { tags: tags(['wood', 'pumpkin', 'plant']) }, speed: t.speed },
            { block: { tags: tags(['dirt', 'sand', 'gravel', 'grass', 'snow']) }, speed: t.speed },
            { block: 'minecraft:web', speed: 15 },
            { block: 'minecraft:bamboo', speed: 20 },
          ],
        },
      },
    },
  };
}

// ---------- Recipe JSON ----------
function recipeJson(t) {
  if (t.smithing) {
    return {
      format_version: '1.21.40',
      'minecraft:recipe_smithing_transform': {
        description: { identifier: `steveo:${t.id}_paxel_smithing` },
        tags: ['smithing_table'],
        template: t.smithing.template,
        base: `steveo:${t.smithing.base}_paxel`,
        addition: t.smithing.addition,
        result: `steveo:${t.id}_paxel`,
      },
    };
  }
  return {
    format_version: '1.21.40',
    'minecraft:recipe_shaped': {
      description: { identifier: `steveo:${t.id}_paxel_recipe` },
      tags: ['crafting_table'],
      pattern: ['GGG', ' SG', ' S '],
      key: { G: t.ingredient, S: { item: 'minecraft:stick' } },
      unlock: t.unlock,
      result: { item: `steveo:${t.id}_paxel` },
    },
  };
}

// ---------- PNG ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
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

// ---------- Pixel art ----------
// A 13x14 axe-shaped head on a diagonal stick, in the style of the classic
// paxel mods: the head reads as a broad axe blade with a pick spike. Letters
// are palette roles. Head (per tier): A outline, B highlight, C base, D light,
// I deep outline, J shade. Stick (shared): E edge, F mid, G light, H dark.
const STICK = { E: [73, 54, 21], F: [104, 78, 30], G: [137, 103, 39], H: [40, 30, 11] };
const rows = [
  '................',
  '........AA......',
  '.......ABBA.....',
  '......ABCDAEF...',
  '.....ABCCCBGH...',
  '.....IBDCJCBI...',
  '......IIEAJCDI..',
  '.......EGHIJCI..',
  '......EFH..ICI..',
  '.....EGH...IDI..',
  '....EFH....IBI..',
  '...EGH......II..',
  '.EEFH...........',
  '.EGH............',
  '..HH............',
  '................',
];

function paintIcon(colors) {
  const S = 16;
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = colors[rows[y][x]];
    if (!c) continue;
    const i = (y * S + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  return png(S, S, buf);
}

// Pack icon: the diamond art scaled 7x on a dark slate background with a border.
function paintPackIcon(colors) {
  const S = 128;
  const buf = Buffer.alloc(S * S * 4);
  const scale = 7;
  const off = (S - 16 * scale) / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    let c = edge ? [40, 44, 52] : [62, 68, 80];
    const gx = Math.floor((x - off) / scale);
    const gy = Math.floor((y - off) / scale);
    if (gx >= 0 && gx < 16 && gy >= 0 && gy < 16) {
      const p = colors[rows[gy][gx]];
      if (p) c = p;
    }
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  return png(S, S, buf);
}

// ---------- Write ----------
const bp = path.join(out, 'behavior_pack');
const rp = path.join(out, 'resource_pack');
const dirs = {
  items: path.join(bp, 'items'),
  recipes: path.join(bp, 'recipes'),
  icons: path.join(rp, 'textures', 'items'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

const textureData = {};
for (const t of TIERS) {
  write(path.join(dirs.items, `${t.id}_paxel.json`), itemJson(t));
  write(path.join(dirs.recipes, `${t.id}_paxel.json`), recipeJson(t));
  fs.writeFileSync(path.join(dirs.icons, `${t.id}_paxel.png`), paintIcon({ ...t.colors, ...STICK }));
  textureData[`steveo_${t.id}_paxel`] = { textures: `textures/items/${t.id}_paxel` };
}
write(path.join(rp, 'textures', 'item_texture.json'), {
  resource_pack_name: 'paxel',
  texture_name: 'atlas.items',
  texture_data: textureData,
});
const icon = paintPackIcon({ ...TIERS.find((t) => t.id === 'diamond').colors, ...STICK });
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(bp, 'pack_icon.png'), icon);
console.log(`wrote ${TIERS.length} items, recipes, and icons plus pack icons to`, out);
