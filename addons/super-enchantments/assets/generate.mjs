// Generates everything derived for this add-on:
//   - the pack icons (128×128)
//   - the Super Enchantment Fountain block texture (32×32 atlas)
//   - the enchantment-letter particle sheet (16 glyphs, 8×8 each)
//   - behavior_pack/structures/steveo/enchantment_tower.mcstructure, the
//     Enchantment Tower that world generation scatters across the Overworld
// Run from the repo root:  node addons/super-enchantments/assets/generate.mjs addons/super-enchantments
// The generated output is what gets committed; this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

// ---------- deterministic randomness ----------
// A fixed seed so regenerating the pack reproduces the same textures and tower.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
function canvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  return {
    w, h, buf,
    set(x, y, [r, g, b], a = 255) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    },
    fill(x0, y0, w0, h0, col, a = 255) {
      for (let y = y0; y < y0 + h0; y++) for (let x = x0; x < x0 + w0; x++) this.set(x, y, col, a);
    },
    png: () => png(w, h, buf),
  };
}
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(a, b, t) { return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)); }
function shade(col, f) { return col.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))); }

function write(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${file} (${data.length} bytes)`);
}

// ---------- Palette ----------
const STONE = hex('#8A8A8A');
const STONE_DARK = hex('#5E5E5E');
const STONE_LIGHT = hex('#A9A9A9');
const LAPIS = hex('#2A4FB0');
const LAPIS_LIGHT = hex('#5B84E8');
const GLOW = hex('#C77DFF');
const GLOW_LIGHT = hex('#F1D8FF');
const NIGHT_TOP = hex('#120A2E');
const NIGHT_BOTTOM = hex('#3B1F6E');

// ---------- Fountain block texture (32×32 atlas) ----------
// Left 16×16: lapis-flecked stone for the pedestal, stem and basin.
// Right 16×16: the glowing pool of enchanting light on top of the basin.
{
  const rnd = mulberry32(0x5e7a);
  const c = canvas(32, 32);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = rnd();
    let col = n < 0.12 ? STONE_DARK : n > 0.85 ? STONE_LIGHT : STONE;
    if (rnd() < 0.09) col = rnd() < 0.5 ? LAPIS : LAPIS_LIGHT;
    c.set(x, y, col);
  }
  // A carved rim so the pedestal edge reads as masonry.
  for (let i = 0; i < 16; i++) { c.set(i, 0, STONE_LIGHT); c.set(i, 15, STONE_DARK); c.set(0, i, STONE_LIGHT); c.set(15, i, STONE_DARK); }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy) / 8;
    const swirl = 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * 3 + d * 6);
    let col = mix(GLOW, LAPIS_LIGHT, Math.min(1, d));
    col = mix(col, GLOW_LIGHT, swirl * 0.5 * (1 - d));
    if (rnd() < 0.05) col = GLOW_LIGHT;
    c.set(16 + x, y, col);
  }
  // Bottom half of the atlas is unused; keep it opaque so mipmaps stay clean.
  c.fill(0, 16, 32, 16, STONE_DARK);
  write('resource_pack/textures/blocks/enchantment_fountain.png', c.png());
}

// ---------- Enchantment letter particle sheet (128×8, sixteen 8×8 glyphs) ----------
// Random rune-like glyphs in the spirit of the enchanting table's alphabet.
// Each glyph is a mirrored scribble so it reads as a letter rather than noise.
{
  const rnd = mulberry32(0x1e77e5);
  const c = canvas(128, 8);
  for (let g = 0; g < 16; g++) {
    const ox = g * 8;
    // Vertical stroke plus a random set of horizontal ticks and a diagonal.
    const strokeX = 2 + Math.floor(rnd() * 3);
    const top = 1 + Math.floor(rnd() * 2);
    const bottom = 5 + Math.floor(rnd() * 2);
    for (let y = top; y <= bottom; y++) c.set(ox + strokeX, y, GLOW_LIGHT);
    for (let k = 0; k < 2 + Math.floor(rnd() * 2); k++) {
      const y = top + Math.floor(rnd() * (bottom - top + 1));
      const len = 1 + Math.floor(rnd() * 3);
      const dir = rnd() < 0.5 ? -1 : 1;
      for (let i = 1; i <= len; i++) c.set(ox + strokeX + dir * i, y, GLOW_LIGHT);
    }
    if (rnd() < 0.6) {
      const dir = rnd() < 0.5 ? -1 : 1;
      for (let i = 0; i < 3; i++) c.set(ox + strokeX + dir * (i + 1), bottom - i, GLOW_LIGHT);
    }
    if (rnd() < 0.5) c.set(ox + strokeX + (rnd() < 0.5 ? -2 : 2), top, GLOW_LIGHT);
  }
  write('resource_pack/textures/particle/enchantment_letters.png', c.png());
}

// ---------- Pack icons (128×128) ----------
function icon(label) {
  const rnd = mulberry32(0xabcd);
  const c = canvas(128, 128);
  for (let y = 0; y < 128; y++) {
    const col = mix(NIGHT_TOP, NIGHT_BOTTOM, y / 127);
    for (let x = 0; x < 128; x++) c.set(x, y, col);
  }
  for (let i = 0; i < 60; i++) c.set(Math.floor(rnd() * 128), Math.floor(rnd() * 90), GLOW_LIGHT, 200);
  // Tower: body, battlements, a doorway, and window slits.
  const body = shade(STONE, 0.75);
  c.fill(44, 40, 40, 88, body);
  for (let x = 44; x < 84; x += 8) c.fill(x, 32, 4, 8, body);
  c.fill(60, 108, 8, 20, NIGHT_TOP);
  for (let y = 52; y < 100; y += 16) { c.fill(52, y, 3, 6, GLOW_LIGHT); c.fill(73, y, 3, 6, GLOW_LIGHT); }
  // Masonry lines.
  for (let y = 44; y < 128; y += 6) for (let x = 44; x < 84; x++) if ((x + (y / 6) * 3) % 8 === 0) c.set(x, y, shade(body, 0.8));
  // The fountain on top with its glow.
  c.fill(58, 26, 12, 6, mix(STONE, LAPIS, 0.3));
  for (let r = 14; r > 0; r--) {
    const col = mix(GLOW_LIGHT, GLOW, r / 14);
    for (let a = 0; a < 360; a += 4) {
      const x = Math.round(64 + Math.cos((a * Math.PI) / 180) * r);
      const y = Math.round(22 + Math.sin((a * Math.PI) / 180) * r * 0.7);
      c.set(x, y, col, Math.round(255 * (1 - r / 16)));
    }
  }
  c.fill(62, 18, 4, 8, GLOW_LIGHT);
  // Floating glyph specks rising from the fountain.
  for (let i = 0; i < 18; i++) {
    const x = 50 + Math.floor(rnd() * 28);
    const y = 4 + Math.floor(rnd() * 18);
    c.fill(x, y, 2, 2, rnd() < 0.5 ? GLOW_LIGHT : LAPIS_LIGHT);
  }
  // Corner tag so BP and RP icons are distinguishable at a glance.
  const tag = label === 'BP' ? hex('#F2C14E') : hex('#5BE8C7');
  c.fill(4, 116, 20, 8, NIGHT_TOP);
  c.fill(6, 118, label === 'BP' ? 8 : 16, 4, tag);
  return c.png();
}
write('behavior_pack/pack_icon.png', icon('BP'));
write('resource_pack/pack_icon.png', icon('RP'));

// ---------- NBT (Bedrock: little-endian, uncompressed) ----------
// Values are tagged: byte/short/int/long/float/string/list/compound.
const T = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11 };
const tag = {
  byte: (v) => ({ t: T.byte, v }),
  int: (v) => ({ t: T.int, v }),
  string: (v) => ({ t: T.string, v }),
  list: (of, v) => ({ t: T.list, of, v }),
  compound: (v) => ({ t: T.compound, v }),
};

function nbtWriter() {
  const parts = [];
  const w = {
    u8: (v) => { const b = Buffer.alloc(1); b.writeUInt8(v); parts.push(b); },
    i16: (v) => { const b = Buffer.alloc(2); b.writeInt16LE(v); parts.push(b); },
    i32: (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); },
    str: (s) => { const d = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16LE(d.length); parts.push(l, d); },
    payload(node) {
      switch (node.t) {
        case T.byte: w.u8(node.v & 0xff); break;
        case T.short: w.i16(node.v); break;
        case T.int: w.i32(node.v); break;
        case T.string: w.str(node.v); break;
        case T.list:
          w.u8(node.of);
          w.i32(node.v.length);
          for (const item of node.v) w.payload(item);
          break;
        case T.compound:
          for (const [name, child] of Object.entries(node.v)) w.named(name, child);
          w.u8(T.end);
          break;
        default: throw new Error(`unsupported tag ${node.t}`);
      }
    },
    named(name, node) { w.u8(node.t); w.str(name); w.payload(node); },
    bytes: () => Buffer.concat(parts),
  };
  return w;
}

// ---------- The Enchantment Tower ----------
// Coordinates are structure-local: x/z 0..8 across, y 0..25 up. Layers 0-4 are
// a buried foundation; the feature rule plants the structure four blocks below
// the surface so the ground floor sits at (or one above) the terrain.
const SX = 9, SY = 26, SZ = 9;
const FOUNDATION_TOP = 4; // last foundation layer
const WALL_BOTTOM = 5;
const PLATFORM_Y = 23; // top floor
const MID_FLOORS = [11, 17];
const LADDER = { x: 4, z: 1 }; // against the inner north wall (z = 0)
const DOOR = { x: 4, z: 8 }; // south wall, two blocks tall
const CENTER = 4;
const BLOCK_VERSION = 18168865;

const rnd = mulberry32(0x70ae5);
const AIR = 'minecraft:air';

const grid = Array.from({ length: SX }, () => Array.from({ length: SY }, () => new Array(SZ).fill(AIR)));
const at = (x, y, z, block) => { grid[x][y][z] = block; };
const isEdge = (x, z) => x === 0 || x === SX - 1 || z === 0 || z === SZ - 1;
const brick = () => { const n = rnd(); return n < 0.12 ? 'minecraft:mossy_stone_bricks' : n < 0.24 ? 'minecraft:cracked_stone_bricks' : 'minecraft:stone_bricks'; };
const cobble = () => (rnd() < 0.3 ? 'minecraft:mossy_cobblestone' : 'minecraft:cobblestone');
const withStates = (name, states) => ({ name, states });

// Foundation.
for (let y = 0; y <= FOUNDATION_TOP; y++) for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) at(x, y, z, cobble());

// Walls up to the platform; corners chiseled, the rest mixed stone bricks.
for (let y = WALL_BOTTOM; y < PLATFORM_Y; y++) for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
  if (!isEdge(x, z)) continue;
  const corner = (x === 0 || x === SX - 1) && (z === 0 || z === SZ - 1);
  at(x, y, z, corner ? 'minecraft:chiseled_stone_bricks' : brick());
}

// Window slits on every side, three levels, avoiding the ladder's backing block.
for (const y of [8, 14, 20]) {
  for (const i of [2, 6]) {
    at(i, y, 0, 'minecraft:glass_pane');
    at(i, y, SZ - 1, 'minecraft:glass_pane');
    at(0, y, i, 'minecraft:glass_pane');
    at(SX - 1, y, i, 'minecraft:glass_pane');
  }
  at(CENTER, y, SZ - 1, 'minecraft:glass_pane');
  at(0, y, CENTER, 'minecraft:glass_pane');
  at(SX - 1, y, CENTER, 'minecraft:glass_pane');
}

// Sea lanterns set into the inner corners so the stairwell is lit.
for (const y of [7, 13, 19]) for (const x of [0, SX - 1]) for (const z of [0, SZ - 1]) at(x, y, z, 'minecraft:sea_lantern');

// Mid floors with a hatch for the ladder.
for (const y of MID_FLOORS) for (let x = 1; x < SX - 1; x++) for (let z = 1; z < SZ - 1; z++) {
  if (x === LADDER.x && z === LADDER.z) continue;
  at(x, y, z, 'minecraft:dark_oak_planks');
}

// Top platform: stone bricks with a chiseled dais under the fountain.
for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
  const dais = Math.abs(x - CENTER) <= 1 && Math.abs(z - CENTER) <= 1;
  at(x, PLATFORM_Y, z, dais ? 'minecraft:chiseled_stone_bricks' : brick());
}
// Parapet: a full ring, then merlons on every other block above it.
for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
  if (!isEdge(x, z)) continue;
  at(x, PLATFORM_Y + 1, z, brick());
  if ((x + z) % 2 === 0) at(x, PLATFORM_Y + 2, z, brick());
}
// The fountain, its lanterns, lapis, and bookshelves.
at(CENTER, PLATFORM_Y + 1, CENTER, 'steveo:enchantment_fountain');
for (const [x, z] of [[2, 2], [2, 6], [6, 2], [6, 6]]) at(x, PLATFORM_Y + 1, z, 'minecraft:sea_lantern');
for (const [x, z] of [[1, 1], [1, 7], [7, 1], [7, 7]]) {
  at(x, PLATFORM_Y + 1, z, 'minecraft:bookshelf');
  at(x, PLATFORM_Y + 2, z, 'minecraft:bookshelf');
}
for (const [x, z] of [[CENTER, 2], [CENTER, 6], [2, CENTER], [6, CENTER]]) at(x, PLATFORM_Y, z, 'minecraft:lapis_block');

// Doorway on the south wall.
at(DOOR.x, WALL_BOTTOM, DOOR.z, AIR);
at(DOOR.x, WALL_BOTTOM + 1, DOOR.z, AIR);
// Ladder from the ground floor through every hatch onto the platform. It hangs
// on the inner face of the north wall, so it faces south (facing_direction 3).
for (let y = WALL_BOTTOM; y <= PLATFORM_Y; y++) {
  at(LADDER.x, y, LADDER.z, withStates('minecraft:ladder', { facing_direction: tag.int(3) }));
}

// Palette and indices. Index order is x, then y, then z (z fastest).
const paletteKeys = new Map();
const palette = [];
const indices = [];
for (let x = 0; x < SX; x++) for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) {
  const block = grid[x][y][z];
  const entry = typeof block === 'string' ? { name: block, states: {} } : block;
  const key = JSON.stringify(entry);
  let index = paletteKeys.get(key);
  if (index === undefined) {
    index = palette.length;
    paletteKeys.set(key, index);
    palette.push(entry);
  }
  indices.push(tag.int(index));
}
const waterlogged = indices.map(() => tag.int(-1));

const root = tag.compound({
  format_version: tag.int(1),
  size: tag.list(T.int, [tag.int(SX), tag.int(SY), tag.int(SZ)]),
  structure: tag.compound({
    block_indices: tag.list(T.list, [tag.list(T.int, indices), tag.list(T.int, waterlogged)]),
    entities: tag.list(T.compound, []),
    palette: tag.compound({
      default: tag.compound({
        block_palette: tag.list(
          T.compound,
          palette.map((p) => tag.compound({ name: tag.string(p.name), states: tag.compound(p.states), version: tag.int(BLOCK_VERSION) })),
        ),
        block_position_data: tag.compound({}),
      }),
    }),
  }),
  structure_world_origin: tag.list(T.int, [tag.int(0), tag.int(0), tag.int(0)]),
});
const nbt = nbtWriter();
nbt.named('', root);
write('behavior_pack/structures/steveo/enchantment_tower.mcstructure', nbt.bytes());
console.log(`tower: ${SX}x${SY}x${SZ}, ${palette.length} palette entries`);
