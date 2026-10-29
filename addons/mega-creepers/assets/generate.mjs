// Generates the block textures, item icons, creeperite armor layers, the Mega
// Creeper's skin, the particle texture, and the pack icons for this add-on.
// Run from the repo root:  node addons/mega-creepers/assets/generate.mjs addons/mega-creepers
// It overwrites the generated files under resource_pack/ and behavior_pack/;
// the generated output is what gets committed, this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

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
    get(x, y) {
      const i = (y * w + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 2]];
    },
    png: () => png(w, h, buf),
  };
}

function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }

/** Deterministic noise so regenerating gives identical bytes. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Fills a rectangle with `color`, lightly speckled so it does not look flat. */
function fill(c, x0, y0, w, h, color, rand, grain = 0.08) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = rand ? (rand() - 0.5) * 2 * grain : 0;
    c.set(x, y, n >= 0 ? mix(color, [255, 255, 255], n) : mix(color, [0, 0, 0], -n));
  }
}

/** Paints a 16x16 icon from character rows and a legend. */
function paintRows(rows, legend) {
  if (rows.length !== 16 || rows.some((r) => r.length !== 16)) throw new Error('icon rows must be 16x16');
  const c = canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = legend[rows[y][x]];
    if (col) c.set(x, y, col);
  }
  return c;
}

// ---------- Palette ----------
const P = {
  // Creeperite stone: the creeper's mottled greens, dulled toward slate.
  s0: hex('#22361F'),
  s1: hex('#2F4A2A'),
  s2: hex('#3E6236'),
  s3: hex('#527D45'),
  s4: hex('#6A9A57'),
  mortar: hex('#1A2418'),
  // Refined creeperite metal.
  m0: hex('#1E5A26'),
  m1: hex('#2F8A38'),
  m2: hex('#46B84E'),
  m3: hex('#7FE07A'),
  m4: hex('#C8FFB8'),
  glow: hex('#9CFF6E'),
  black: hex('#0E120D'),
  haft: hex('#6B4A2A'),
  haftDark: hex('#3E2A16'),
  haftLight: hex('#8C6A3E'),
  gray: hex('#B8B8B8'),
};

/** The creeper face on an 8x8 grid: 1 = dark. */
const FACE = [
  '........',
  '........',
  '.##..##.',
  '.##..##.',
  '...##...',
  '..####..',
  '..####..',
  '..#..#..',
];

/** Creeper camouflage: blotches of 2x2 cells in four shades. */
function camo(c, x0, y0, w, h, shades, seed) {
  const rand = rng(seed);
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const r = rand();
    const shade = shades[r < 0.15 ? 0 : r < 0.5 ? 1 : r < 0.85 ? 2 : 3];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      if (x + dx >= w || y + dy >= h) continue;
      const n = (rand() - 0.5) * 0.12;
      c.set(x0 + x + dx, y0 + y + dy, n >= 0 ? mix(shade, [255, 255, 255], n) : mix(shade, [0, 0, 0], -n));
    }
  }
}

// ---------- Blocks (16x16) ----------
function paintCreeperite() {
  const c = canvas(16, 16);
  camo(c, 0, 0, 16, 16, [P.s0, P.s1, P.s2, P.s3], 101);
  return c;
}

function paintPolished() {
  const c = canvas(16, 16);
  const rand = rng(102);
  fill(c, 0, 0, 16, 16, P.s2, rand, 0.05);
  fill(c, 1, 1, 14, 1, P.s3, rand, 0.03);
  fill(c, 1, 1, 1, 14, P.s3, rand, 0.03);
  for (let i = 0; i < 16; i++) {
    c.set(i, 0, P.s1); c.set(0, i, P.s1);
    c.set(i, 15, P.s0); c.set(15, i, P.s0);
  }
  return c;
}

function paintBricks(seed = 103) {
  const c = canvas(16, 16);
  camo(c, 0, 0, 16, 16, [P.s1, P.s2, P.s2, P.s3], seed);
  // Four courses of 4px, each brick 8 wide, alternate courses offset by 4.
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 3;
    for (let x = 0; x < 16; x++) c.set(x, y, P.mortar);
    const off = row % 2 === 0 ? 0 : 4;
    for (let x = off; x < 16; x += 8) for (let dy = 0; dy < 3; dy++) c.set(x, row * 4 + dy, P.mortar);
    // Top-left lip highlight on each brick.
    for (let x = off + 1; x < off + 8 && x < 16; x++) c.set(x % 16, row * 4, mix(c.get(x % 16, row * 4), P.s4, 0.4));
  }
  return c;
}

function paintCrackedBricks() {
  const c = paintBricks(104);
  const crack = [[2, 0], [3, 1], [3, 2], [4, 3], [5, 4], [5, 5], [6, 6], [6, 7], [8, 8], [9, 9], [9, 10], [10, 11], [12, 12], [13, 13],
    [11, 2], [12, 3], [12, 4], [13, 5], [5, 10], [4, 11], [4, 12], [3, 13], [2, 14]];
  for (const [x, y] of crack) c.set(x, y, P.black);
  return c;
}

/** Bricks frame around a creeper face, the face dark or glowing. */
function paintCarved(faceColor, frameColor, seed) {
  const c = canvas(16, 16);
  camo(c, 0, 0, 16, 16, [P.s1, P.s2, P.s2, P.s3], seed);
  for (let i = 0; i < 16; i++) {
    for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i], [i, 3], [i, 12], [3, i], [12, i]]) {
      if ((y === 3 || y === 12) && (x < 3 || x > 12)) continue;
      if ((x === 3 || x === 12) && (y < 3 || y > 12)) continue;
      c.set(x, y, frameColor);
    }
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (FACE[y][x] === '#') c.set(4 + x, 4 + y, faceColor);
  }
  return c;
}

function paintCreeperiteBlock() {
  const c = canvas(16, 16);
  const rand = rng(105);
  fill(c, 0, 0, 16, 16, P.m2, rand, 0.05);
  for (let i = 0; i < 16; i++) {
    c.set(i, 0, P.m3); c.set(0, i, P.m3);
    c.set(i, 15, P.m0); c.set(15, i, P.m0);
    c.set(i, 1, mix(P.m2, P.m3, 0.5)); c.set(1, i, mix(P.m2, P.m3, 0.5));
    c.set(i, 14, P.m1); c.set(14, i, P.m1);
  }
  // A faint creeper face pressed into the metal.
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (FACE[y][x] === '#') c.set(4 + x, 4 + y, P.m1);
  }
  return c;
}

function paintOre() {
  const c = canvas(16, 16);
  camo(c, 0, 0, 16, 16, [P.s0, P.s0, P.s1, P.s2], 106);
  const veins = [
    [3, 2, 2], [10, 3, 2], [6, 7, 3], [12, 9, 2], [2, 11, 2], [8, 12, 2],
  ];
  for (const [vx, vy, r] of veins) {
    for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) c.set(vx + x, vy + y, P.m2);
    c.set(vx, vy, P.m4);
    c.set(vx + r, vy + 1, P.m1);
    c.set(vx + 1, vy + r, P.m1);
  }
  return c;
}

// ---------- Items (16x16) ----------
const METAL = { K: P.m0, D: P.m1, G: P.m2, L: P.m3, W: P.m4, H: P.haft, h: P.haftLight, d: P.haftDark };

function paintIngot() {
  return paintRows([
    '................',
    '................',
    '................',
    '................',
    '................',
    '......KKKKKKK...',
    '.....KWLLLLLGK..',
    '....KLLGGGGGDK..',
    '...KLGGGGGGDK...',
    '..KLGGGGGGDDK...',
    '..KDDDDDDDDK....',
    '...KKKKKKKK.....',
    '................',
    '................',
    '................',
    '................',
  ], METAL);
}

function paintRaw() {
  return paintRows([
    '................',
    '................',
    '................',
    '.....aaaa.......',
    '....aLGGsa......',
    '...aLGsGGGaa....',
    '...aGGGssGGGa...',
    '..aGsGGGGLsGa...',
    '..aGGGGsGGGGGa..',
    '..asGLGGGGsGGa..',
    '...aGGGsGGGGa...',
    '....aaGGGGsa....',
    '......aaaaa.....',
    '................',
    '................',
    '................',
  ], { a: P.s0, s: P.s2, G: P.m1, L: P.m3 });
}

function paintSword() {
  return paintRows([
    '.............KKK',
    '............KWLK',
    '...........KWLGK',
    '..........KWLGK.',
    '.........KWLGK..',
    '........KWLGK...',
    '.......KWLGK....',
    '..KK..KWLGK.....',
    '..KDKKWLGK......',
    '...KDGLGK.......',
    '....KDGK........',
    '...KhKDDK.......',
    '..KhK..KK.......',
    'KKhK............',
    'KhK.............',
    'KK..............',
  ], METAL);
}

function paintPickaxe() {
  return paintRows([
    '................',
    '....KKKKKK......',
    '...KWLLLLGKK....',
    '....KKKKGGLGK...',
    '.........KHGLK..',
    '........KhKKGLK.',
    '.......KhK..KGK.',
    '......KhK...KGK.',
    '.....KhK....KDK.',
    '....KhK......K..',
    '...KhK..........',
    '..KhK...........',
    '.KhK............',
    '.KK.............',
    '................',
    '................',
  ], METAL);
}

function paintAxe() {
  return paintRows([
    '................',
    '.......KKK......',
    '......KWLGK.....',
    '.....KWLLGGK....',
    '....KWLGGGGGK...',
    '....KLGGGGKhK...',
    '....KLGGGKhK....',
    '.....KDDKhK.....',
    '......KKhK......',
    '......KhK.......',
    '.....KhK........',
    '....KhK.........',
    '...KhK..........',
    '..KhK...........',
    '.KhK............',
    '.KK.............',
  ], METAL);
}

function paintShovel() {
  return paintRows([
    '................',
    '..........KKK...',
    '.........KWLGK..',
    '.........KLGGK..',
    '.........KGGDK..',
    '........KhKKK...',
    '.......KhK......',
    '......KhK.......',
    '.....KhK........',
    '....KhK.........',
    '...KhK..........',
    '..KhK...........',
    '.KhK............',
    '.KK.............',
    '................',
    '................',
  ], METAL);
}

function paintHoe() {
  return paintRows([
    '................',
    '.......KKKK.....',
    '......KWLLGK....',
    '.......KKGhK....',
    '........KhK.....',
    '.......KhK......',
    '......KhK.......',
    '.....KhK........',
    '....KhK.........',
    '...KhK..........',
    '..KhK...........',
    '.KhK............',
    '.KK.............',
    '................',
    '................',
    '................',
  ], METAL);
}

const ARMOR_LEGEND = { g: P.m3, G: P.m2, d: P.m1, o: P.s1, O: P.s2, m: P.black, w: P.m4 };

function paintHelmet() {
  return paintRows([
    '................',
    '................',
    '....GGGGGGGG....',
    '...GgggggggGd...',
    '..GgGGGGGGGGGd..',
    '..GGmmGGGGmmGd..',
    '..GGmmGGGGmmGG..',
    '..dGGGGmmGGGGd..',
    '..dG........Gd..',
    '..dG........Gd..',
    '..dd........dd..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

function paintChestplate() {
  return paintRows([
    '................',
    '..ggg......ggg..',
    '.gGGGd....dGGGg.',
    '.gGGGdGGGGdGGGg.',
    '.dGGGGGGGGGGGGd.',
    '.ddGGmmGGmmGGdd.',
    '...dGmmGGmmGd...',
    '....GGGmmGGG....',
    '....GGmmmmGG....',
    '....GGmmmmGG....',
    '....GGmGGmGG....',
    '....GGGGGGGG....',
    '....GgggggGG....',
    '....dddddddd....',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

function paintLeggings() {
  return paintRows([
    '................',
    '...ddddddddddd..',
    '...GGGGmmGGGGG..',
    '...GgggggggggG..',
    '...GGGGGGGGGGG..',
    '...GGGd..dGGGG..',
    '...GgGd..dGgGG..',
    '...GgGd..dGgGG..',
    '...GGGd..dGGGG..',
    '...GGGd..dGGGG..',
    '...GgGd..dGgGG..',
    '...GgGd..dGgGG..',
    '...dddd..ddddd..',
    '................',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

function paintBoots() {
  return paintRows([
    '................',
    '................',
    '................',
    '................',
    '................',
    '...dddd..dddd...',
    '...GGGd..dGGG...',
    '...GgGd..dGgG...',
    '...GgGd..dGgG...',
    '...GGGd..dGGG...',
    '..gGGGd..dGGGg..',
    '..GGGGd..dGGGG..',
    '..dddd....dddd..',
    '................',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

// ---------- Armor layers (64x32, the vanilla humanoid armor layout) ----------
// Regions: head box at (0,0) 8x8x8; body at (16,16) 8x12x4; arm at (40,16)
// 4x12x4; leg at (0,16) 4x12x4. Each box's faces are laid out
// [side][front][side][back] under [top][bottom].
function box(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  };
}

function camoBox(c, b, shades, seed) {
  let s = seed;
  for (const [x, y, w, h] of Object.values(b)) camo(c, x, y, w, h, shades, s++);
}

const METAL_SHADES = [P.m0, P.m1, P.m2, P.m3];

function paintArmorLayer1() {
  const c = canvas(64, 32);
  // Helmet: creeper camo with the creeper's eyes over an open face.
  const head = box(0, 0, 8, 8, 8);
  camoBox(c, head, METAL_SHADES, 201);
  {
    const [x, y] = head.front;
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 8; xx++) {
      if (FACE[yy][xx] === '#') c.set(x + xx, y + yy, P.black);
    }
    // Open face below the eyes.
    for (let yy = y + 5; yy < y + 8; yy++) for (let xx = x + 1; xx < x + 7; xx++) c.set(xx, yy, [0, 0, 0], 0);
  }

  // Chestplate: camo plate with the creeper mouth as a black chest emblem.
  const body = box(16, 16, 8, 12, 4);
  camoBox(c, body, METAL_SHADES, 211);
  {
    const [x, y] = body.front;
    for (let yy = 4; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
      if (FACE[yy][xx] === '#') c.set(x + xx, y + yy - 1, P.black);
    }
    fill(c, x, y + 11, 8, 1, P.m0);
  }
  const arm = box(40, 16, 4, 12, 4);
  camoBox(c, arm, METAL_SHADES, 221);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = arm[face];
    fill(c, x, y + 4, w, 1, P.m0);
  }

  // Boots: the leg box, lower part only (the boots model uses rows 6..12).
  const leg = box(0, 16, 4, 12, 4);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = leg[face];
    camo(c, x, y + 6, w, 6, METAL_SHADES, 231 + x);
    fill(c, x, y + 11, w, 1, P.m0);
  }
  camo(c, ...leg.bottom, METAL_SHADES, 239);
  return c;
}

function paintArmorLayer2() {
  const c = canvas(64, 32);
  const body = box(16, 16, 8, 12, 4);
  camoBox(c, body, METAL_SHADES, 241);
  {
    const [x, y] = body.front;
    fill(c, x, y + 7, 8, 1, P.black);
  }
  const leg = box(0, 16, 4, 12, 4);
  camoBox(c, leg, METAL_SHADES, 251);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = leg[face];
    fill(c, x, y + 5, w, 1, P.m0);
  }
  return c;
}

// ---------- Mega Creeper skin (64x32, the vanilla creeper layout) ----------
// Head box 8x8x8 at (0,0), body 8x12x4 at (16,16), leg 4x6x4 at (0,16).
function paintMegaCreeper() {
  const c = canvas(64, 32);
  const shades = [hex('#1F4A1C'), hex('#2E6B27'), hex('#3F8F34'), hex('#5DB24A')];
  const head = box(0, 0, 8, 8, 8);
  camoBox(c, head, shades, 301);
  {
    const [x, y] = head.front;
    for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
      if (FACE[yy][xx] === '#') c.set(x + xx, y + yy, P.black);
    }
    // Glowing creeperite pupils.
    c.set(x + 2, y + 3, P.glow);
    c.set(x + 5, y + 3, P.glow);
  }
  const body = box(16, 16, 8, 12, 4);
  camoBox(c, body, shades, 311);
  // Creeperite crystals growing out of its back and shoulders.
  for (const [dx, dy] of [[1, 2], [5, 4], [2, 8], [6, 9]]) {
    const [x, y] = body.back;
    c.set(x + dx, y + dy, P.m4);
    c.set(x + dx + 1, y + dy, P.glow);
    c.set(x + dx, y + dy + 1, P.m2);
  }
  {
    const [x, y] = body.top;
    c.set(x + 1, y + 1, P.glow);
    c.set(x + 6, y + 2, P.glow);
  }
  const leg = box(0, 16, 4, 6, 4);
  camoBox(c, leg, shades, 321);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = leg[face];
    fill(c, x, y + 5, w, 1, shades[0]);
  }
  return c;
}

// ---------- Particle: 8x8 soft white spark, tinted per effect ----------
function paintSpark() {
  const c = canvas(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const dx = x + 0.5 - 4;
    const dy = y + 0.5 - 4;
    const r = Math.sqrt(dx * dx + dy * dy) / 4;
    if (r > 1) continue;
    // Keep alpha above ~128 so an alpha-test fallback still shows the mote.
    const alpha = r < 0.5 ? 255 : Math.round(255 - (r - 0.5) * 2 * 110);
    c.set(x, y, [255, 255, 255], alpha);
  }
  return c;
}

// ---------- Pack icon: 128x128, the carved creeperite face ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const tile = paintCarved(P.black, P.mortar, 107);
  const scale = 8;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = tile.get(x, y);
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) c.set(x * scale + sx, y * scale + sy, col);
  }
  // Glowing eyes.
  for (const ex of [5, 9]) {
    for (let sy = 2; sy < 6; sy++) for (let sx = 2; sx < 6; sx++) c.set(ex * scale + sx, 7 * scale + sy, P.glow);
  }
  return c;
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
const write = (rel, canvasOrBuffer) => {
  const file = path.join(rp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canvasOrBuffer.png());
};
write('textures/blocks/creeperite.png', paintCreeperite());
write('textures/blocks/polished_creeperite.png', paintPolished());
write('textures/blocks/creeperite_bricks.png', paintBricks());
write('textures/blocks/cracked_creeperite_bricks.png', paintCrackedBricks());
write('textures/blocks/carved_creeperite_bricks.png', paintCarved(P.black, P.mortar, 107));
write('textures/blocks/sealed_creeperite_bricks.png', paintCarved(P.glow, P.m2, 108));
write('textures/blocks/creeperite_block.png', paintCreeperiteBlock());
write('textures/blocks/creeperite_ore.png', paintOre());
write('textures/items/creeperite_ingot.png', paintIngot());
write('textures/items/raw_creeperite.png', paintRaw());
write('textures/items/creeperite_sword.png', paintSword());
write('textures/items/creeperite_pickaxe.png', paintPickaxe());
write('textures/items/creeperite_axe.png', paintAxe());
write('textures/items/creeperite_shovel.png', paintShovel());
write('textures/items/creeperite_hoe.png', paintHoe());
write('textures/items/creeperite_helmet.png', paintHelmet());
write('textures/items/creeperite_chestplate.png', paintChestplate());
write('textures/items/creeperite_leggings.png', paintLeggings());
write('textures/items/creeperite_boots.png', paintBoots());
write('textures/models/armor/creeperite_1.png', paintArmorLayer1());
write('textures/models/armor/creeperite_2.png', paintArmorLayer2());
write('textures/entity/mega_creeper.png', paintMegaCreeper());
write('textures/particle/spark.png', paintSpark());
const icon = paintPackIcon().png();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote block textures, item icons, armor layers, Mega Creeper skin, spark, and pack icons to', out);
