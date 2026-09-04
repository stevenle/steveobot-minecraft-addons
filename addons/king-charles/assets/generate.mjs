// Generates the model, coat textures, crown icon, and pack icons for this add-on.
// Run from the repo root:  node addons/king-charles/assets/generate.mjs addons/king-charles
// It overwrites the generated files under resource_pack/ and behavior_pack/;
// the generated output is what gets committed, this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node gen-dog.mjs <addon dir>');

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

// ---------- Model ----------
// Model space: +Y up, head toward -Z. Units are 1/16 block.
// cubes: { part, origin:[x,y,z], size:[w,h,d], uv:[u,v] }
const TEX_W = 64;
const TEX_H = 32;
const cubes = [
  { part: 'body',    origin: [-3, 4, -5],   size: [6, 5, 10], uv: [0, 0] },
  { part: 'head',    origin: [-3, 6, -10],  size: [6, 5, 5],  uv: [32, 0] },
  { part: 'snout',   origin: [-1.5, 6, -13], size: [3, 2, 3], uv: [32, 10] },
  { part: 'tail',    origin: [-1, 7, 5],    size: [2, 2, 4],  uv: [44, 10] },
  { part: 'leg_fl',  origin: [-3, 0, -4],   size: [2, 5, 2],  uv: [0, 16] },
  { part: 'leg_fr',  origin: [1, 0, -4],    size: [2, 5, 2],  uv: [8, 16] },
  { part: 'leg_bl',  origin: [-3, 0, 2],    size: [2, 5, 2],  uv: [16, 16] },
  { part: 'leg_br',  origin: [1, 0, 2],     size: [2, 5, 2],  uv: [24, 16] },
  { part: 'ear_l',   origin: [-4, 5, -9],   size: [1, 6, 3],  uv: [32, 16] },
  { part: 'ear_r',   origin: [3, 5, -9],    size: [1, 6, 3],  uv: [40, 16] },
  // Crown: a band on top of the head, four points, and a gem at the front.
  { part: 'crown_band',  origin: [-2, 11, -9.5],  size: [4, 1, 4], uv: [48, 16] },
  { part: 'crown_point', origin: [-2, 12, -9.5],  size: [1, 1, 1], uv: [48, 22] },
  { part: 'crown_point', origin: [1, 12, -9.5],   size: [1, 1, 1], uv: [52, 22] },
  { part: 'crown_point', origin: [-2, 12, -6.5],  size: [1, 1, 1], uv: [56, 22] },
  { part: 'crown_point', origin: [1, 12, -6.5],   size: [1, 1, 1], uv: [60, 22] },
  { part: 'crown_gem',   origin: [-0.5, 12, -9.5], size: [1, 1, 1], uv: [48, 24] },
];
const byPart = Object.fromEntries(cubes.map((c) => [c.part, c]));
const crownCubes = cubes.filter((c) => c.part.startsWith('crown'));

const bones = [
  { name: 'body', pivot: [0, 4, 5], cubes: ['body'] },
  { name: 'head', parent: 'body', pivot: [0, 7, -5], cubes: ['head'] },
  { name: 'snout', parent: 'head', pivot: [0, 7, -10], cubes: ['snout'] },
  { name: 'ear_l', parent: 'head', pivot: [-3.5, 11, -7.5], cubes: ['ear_l'] },
  { name: 'ear_r', parent: 'head', pivot: [3.5, 11, -7.5], cubes: ['ear_r'] },
  { name: 'crown', parent: 'head', pivot: [0, 11, -7.5], cubes: 'crown' },
  { name: 'tail', parent: 'body', pivot: [0, 8, 5], cubes: ['tail'] },
  { name: 'leg_fl', parent: 'body', pivot: [-2, 5, -3], cubes: ['leg_fl'] },
  { name: 'leg_fr', parent: 'body', pivot: [2, 5, -3], cubes: ['leg_fr'] },
  { name: 'leg_bl', parent: 'body', pivot: [-2, 5, 3], cubes: ['leg_bl'] },
  { name: 'leg_br', parent: 'body', pivot: [2, 5, 3], cubes: ['leg_br'] },
];

const geo = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: {
        identifier: 'geometry.steveo_king_charles',
        texture_width: TEX_W,
        texture_height: TEX_H,
        visible_bounds_width: 2,
        visible_bounds_height: 1.5,
        visible_bounds_offset: [0, 0.5, 0],
      },
      bones: bones.map((b) => ({
        name: b.name,
        ...(b.parent ? { parent: b.parent } : {}),
        pivot: b.pivot,
        cubes: (b.cubes === 'crown' ? crownCubes : b.cubes.map((c) => byPart[c])).map((c) => ({
          origin: c.origin,
          size: c.size,
          uv: c.uv,
        })),
      })),
    },
  ],
};

// ---------- Coats ----------
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
const WHITE = hex('#F4EDE0');
const CHESTNUT = hex('#A2471F');
const RUBY = hex('#8F3616');
const BLACK = hex('#211D1C');
const TAN = hex('#C07A36');
const EYE = hex('#17110E');
const GOLD = hex('#E8B93C');
const GOLD_DARK = hex('#B8862A');
const GEM = hex('#2FBF5A');
const NOSE = hex('#141010');

const coats = {
  blenheim: { base: WHITE, patch: CHESTNUT, tan: null, solid: false },
  tricolor: { base: WHITE, patch: BLACK, tan: TAN, solid: false },
  black_tan: { base: BLACK, patch: BLACK, tan: TAN, solid: true },
  ruby: { base: RUBY, patch: RUBY, tan: null, solid: true },
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coat colour for a texel at model position (x,y,z) on `part`, facing `n`. */
function coatColor(coat, part, x, y, z, n) {
  const c = coats[coat];
  const head = byPart.head;
  const eyeRow = head.origin[1] + 3; // y = 9
  const isEyeCol = x === -2 || x === 1;

  // The crown is the same on every coat.
  if (part === 'crown_gem') return GEM;
  if (part === 'crown_point') return n === 'up' ? GOLD : GOLD_DARK;
  if (part === 'crown_band') return n === 'up' || n === 'down' ? GOLD_DARK : GOLD;

  // Face details, shared by every coat.
  if (part === 'head' && n === 'north') {
    if (y === eyeRow && isEyeCol) return EYE;
    if (y === eyeRow + 1 && isEyeCol && c.tan) return c.tan; // eyebrows
  }
  if (part === 'snout' && n === 'north' && y === 7 && x === -0.5) return NOSE;

  if (coat === 'ruby') {
    // Solid, with paler feathering on ear tips and tail underside.
    if ((part.startsWith('ear') && y <= 5) || (part === 'tail' && n === 'down')) return hex('#A8481F');
    return c.base;
  }

  if (coat === 'black_tan') {
    // Black with tan points: muzzle, cheeks, chest, lower legs, under tail. Ears stay black.
    if (part === 'snout' && !(n === 'up' || (n === 'north' && y === 7))) return c.tan;
    if (part === 'head' && (n === 'east' || n === 'west') && y <= 7 && z <= -8) return c.tan;
    if (part === 'body' && n === 'north') return c.tan;
    if (part === 'body' && n === 'down' && z <= -2) return c.tan;
    if (part.startsWith('leg') && y <= 1) return c.tan;
    if (part === 'tail' && n === 'down') return c.tan;
    return c.base;
  }

  // Blenheim / tricolor: white base with coloured patches.
  const blaze = x === -1 || x === 0;
  if (part.startsWith('ear')) return c.patch;
  if (part === 'head') {
    if (n === 'down') return c.base;
    if (n === 'south') return c.patch;
    if (n === 'up') {
      if (blaze) return z === -8 ? c.patch : c.base; // lozenge spot in the blaze
      return c.patch;
    }
    if (n === 'north') {
      if (blaze) return c.base;
      if (y <= 6) return c.base; // white muzzle surround
      return c.patch;
    }
    // sides: patch around the eye/ear, white low at the front
    if (y <= 6 && z <= -8) return c.tan ?? c.base; // tricolor cheeks are tan
    if (y <= 6) return c.base;
    return c.patch;
  }
  if (part === 'snout') return c.base;
  if (part === 'body') {
    if (n === 'down' || n === 'north') return c.base;
    if (y < 6 && n !== 'up') return c.base;
    const inPatch = (z >= -2 && z <= 0) || z >= 3;
    return inPatch ? c.patch : c.base;
  }
  if (part === 'tail') {
    if (n === 'down') return c.tan ?? c.base;
    return y >= 8 ? c.patch : c.base;
  }
  return c.base; // legs
}

const SHADE = { up: 1.0, north: 0.95, south: 0.9, east: 0.9, west: 0.9, down: 0.8 };

function paintCoat(coat) {
  const buf = Buffer.alloc(TEX_W * TEX_H * 4); // transparent where unused
  const rnd = mulberry32(coat.length * 7919 + coat.charCodeAt(0));
  const put = (u, v, rgb, shade) => {
    const noise = 0.94 + rnd() * 0.1;
    const i = (v * TEX_W + u) * 4;
    buf[i] = Math.min(255, Math.round(rgb[0] * shade * noise));
    buf[i + 1] = Math.min(255, Math.round(rgb[1] * shade * noise));
    buf[i + 2] = Math.min(255, Math.round(rgb[2] * shade * noise));
    buf[i + 3] = 255;
  };
  for (const cube of cubes) {
    const [ox, oy, oz] = cube.origin;
    const [w, h, d] = cube.size;
    const [u0, v0] = cube.uv;
    // Box UV layout: top (u+d,v) w×d; bottom (u+d+w,v) w×d;
    // side (u,v+d) d×h; front (u+d,v+d) w×h; side (u+d+w,v+d) d×h; back (u+2d+w,v+d) w×h.
    const faces = [
      { n: 'up', u: u0 + d, v: v0, fw: w, fh: d, pos: (a, b) => [ox + a, oy + h - 1, oz + (d - 1 - b)] },
      { n: 'down', u: u0 + d + w, v: v0, fw: w, fh: d, pos: (a, b) => [ox + a, oy, oz + b] },
      { n: 'east', u: u0, v: v0 + d, fw: d, fh: h, pos: (a, b) => [ox + w - 1, oy + h - 1 - b, oz + (d - 1 - a)] },
      { n: 'north', u: u0 + d, v: v0 + d, fw: w, fh: h, pos: (a, b) => [ox + (w - 1 - a), oy + h - 1 - b, oz] },
      { n: 'west', u: u0 + d + w, v: v0 + d, fw: d, fh: h, pos: (a, b) => [ox, oy + h - 1 - b, oz + a] },
      { n: 'south', u: u0 + 2 * d + w, v: v0 + d, fw: w, fh: h, pos: (a, b) => [ox + a, oy + h - 1 - b, oz + d - 1] },
    ];
    for (const f of faces) {
      for (let b = 0; b < f.fh; b++) {
        for (let a = 0; a < f.fw; a++) {
          const [x, y, z] = f.pos(a, b);
          put(f.u + a, f.v + b, coatColor(coat, cube.part, x, y, z, f.n), SHADE[f.n]);
        }
      }
    }
  }
  return png(TEX_W, TEX_H, buf);
}

// ---------- Pack icon: a blenheim face, front view, big pixels ----------
function paintIcon() {
  const S = 128;
  const buf = Buffer.alloc(S * S * 4);
  const bg = hex('#7FA36B');
  const border = hex('#5E7F4C');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    const c = edge ? border : bg;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  // 10 wide × 8 tall pixel grid, scaled ×11, centred.
  const grid = [
    '..PPPPPP..',
    '.PPPWWPPP.',
    '.PPEWWEPP.',
    '.PPWWWWPP.',
    '.PPWNNWPP.',
    '.PPWWWWPP.',
    '.PP.WW.PP.',
    '.PP....PP.',
  ];
  const colors = { P: CHESTNUT, W: WHITE, E: EYE, N: NOSE };
  const cell = 11;
  const gx0 = Math.floor((S - 10 * cell) / 2);
  const gy0 = Math.floor((S - 8 * cell) / 2);
  const rnd = mulberry32(42);
  for (let gy = 0; gy < grid.length; gy++) {
    for (let gx = 0; gx < 10; gx++) {
      const ch = grid[gy][gx];
      const c = colors[ch];
      if (!c) continue;
      const noise = 0.95 + rnd() * 0.08;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const px = gx0 + gx * cell + x;
        const py = gy0 + gy * cell + y;
        const i = (py * S + px) * 4;
        buf[i] = Math.min(255, Math.round(c[0] * noise));
        buf[i + 1] = Math.min(255, Math.round(c[1] * noise));
        buf[i + 2] = Math.min(255, Math.round(c[2] * noise));
        buf[i + 3] = 255;
      }
    }
  }
  return png(S, S, buf);
}

// ---------- Item icon: 16x16 crown ----------
function paintCrownIcon() {
  const S = 16;
  const buf = Buffer.alloc(S * S * 4);
  const rows = [
    '................',
    '................',
    '....G.......G...',
    '...GG...G...GG..',
    '...GGG.GGG.GGG..',
    '...GGGGGGGGGGG..',
    '...GGGGRRRGGGG..',
    '...GGGGRRRGGGG..',
    '...GGGGGGGGGGG..',
    '...DDDDDDDDDDD..',
    '...GGGGGGGGGGG..',
    '...DDDDDDDDDDD..',
    '................',
    '................',
    '................',
    '................',
  ];
  const colors = { G: GOLD, D: GOLD_DARK, R: GEM };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = colors[rows[y][x]];
    if (!c) continue;
    const i = (y * S + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  return png(S, S, buf);
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
const texDir = path.join(rp, 'textures', 'entity', 'king_charles');
fs.mkdirSync(texDir, { recursive: true });
fs.mkdirSync(path.join(rp, 'models', 'entity'), { recursive: true });
fs.writeFileSync(path.join(rp, 'models', 'entity', 'king_charles.geo.json'), JSON.stringify(geo, null, 2) + '\n');
for (const coat of Object.keys(coats)) {
  fs.writeFileSync(path.join(texDir, `${coat}.png`), paintCoat(coat));
}
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'items', 'dog_crown.png'), paintCrownIcon());
const icon = paintIcon();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote model, 4 coats, and pack icons to', out);
