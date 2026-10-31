// Generates the item icons, the armor layers, and the pack icons.
// Run from the repo root:  node addons/nether-armor/assets/generate.mjs addons/nether-armor
// It overwrites the generated files; the output is what gets committed.
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
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
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
    set(x, y, [r, g, b]) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    },
    clear(x, y) {
      buf.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
    },
    png: () => png(w, h, buf),
  };
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

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
  yellow: hex('#FFD93B'),
  orange: hex('#F58A1F'),
  red: hex('#D2301C'),
  darkRed: hex('#8E1A14'),
  brown: hex('#6B3A1E'),
  darkBrown: hex('#3F2212'),
};
const L = { y: P.yellow, o: P.orange, r: P.red, d: P.darkRed, b: P.brown, B: P.darkBrown };

// ---------- Item icons ----------
const paintHelmet = () => paintRows([
  '................',
  '................',
  '.....oyyyyo.....',
  '...rooyyyyoor...',
  '..rroooooooorr..',
  '..bbbbbbbbbbbb..',
  '..rryyrrrryyrr..',
  '..rrb......brr..',
  '..rrb......brr..',
  '..ddB......Bdd..',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], L);
const paintChestplate = () => paintRows([
  '................',
  '..rrb......brr..',
  '.roorrb..brroor.',
  '.rooorrbbrroood.',
  '.rdrrooyyoorrdd.',
  '.Bbdrroyyorrdbb.',
  '....rroyyorr....',
  '....rooyyoor....',
  '....roooooor....',
  '....drroorrd....',
  '....drrrrrrd....',
  '....bbbbbbbb....',
  '....orrrrrro....',
  '....drrrrrrd....',
  '....BBBBBBBB....',
  '................',
], L);
const paintLeggings = () => paintRows([
  '................',
  '...bbbbbbbbbb...',
  '...BByyyyyyBB...',
  '...rroooooorr...',
  '...rrooddoorr...',
  '...rrod..dorr...',
  '...rro....orr...',
  '...oor....roo...',
  '...oor....roo...',
  '...rrd....drr...',
  '...rrd....drr...',
  '...yyd....dyy...',
  '...rrd....drr...',
  '...ddB....Bdd...',
  '................',
  '................',
], L);
const paintBoots = () => paintRows([
  '................',
  '................',
  '................',
  '................',
  '...yyy....yyy...',
  '...rrd....drr...',
  '...rrd....drr...',
  '...ooo....ooo...',
  '...rrd....drr...',
  '...rrd....drr...',
  '..oorrd..drroo..',
  '..oorrd..drroo..',
  '..bbbbb..bbbbb..',
  '..BBBBB..BBBBB..',
  '................',
  '................',
], L);

// ---------- Armor layers (64x32, the vanilla humanoid armor layout) ----------
// Regions: head at (0,0) 8x8x8; body at (16,16) 8x12x4; arm at (40,16) 4x12x4;
// leg at (0,16) 4x12x4. Each box's faces are [side][front][side][back] under
// [top][bottom].
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
function fillBox(c, b, color, rand) {
  for (const [x, y, w, h] of Object.values(b)) fill(c, x, y, w, h, color, rand);
}
const SIDES = ['front', 'left', 'right', 'back'];

/** Flame licks rising from row `base` of a face, tallest in the middle of each lick. */
function flames(c, [x, y, w], base, rand) {
  const heights = [3, 5, 2, 6, 3, 5, 2, 4];
  for (let i = 0; i < w; i++) {
    const h = heights[(x + i) % heights.length];
    fill(c, x + i, y + base - h, 1, h, P.orange, rand);
    fill(c, x + i, y + base - Math.floor(h / 2), 1, Math.floor(h / 2), P.yellow, rand);
  }
}

function paintLayer1() {
  const c = canvas(64, 32);
  const rand = rng(7);
  // Helmet: red dome with flames climbing it, a brown brow band, open face.
  const head = box(0, 0, 8, 8, 8);
  fillBox(c, head, P.red, rand);
  fill(c, ...head.top, P.darkRed, rand);
  for (const face of SIDES) {
    flames(c, head[face], 7, rand);
    const [x, y, w] = head[face];
    fill(c, x, y + 7, w, 1, P.brown, rand);
  }
  {
    const [x, y] = head.front;
    fill(c, x, y, 8, 4, P.red, rand);
    fill(c, x + 3, y, 2, 3, P.yellow, rand);
    fill(c, x, y + 3, 8, 1, P.brown, rand);
    for (let yy = y + 4; yy < y + 8; yy++) for (let xx = x + 1; xx < x + 7; xx++) c.clear(xx, yy);
  }

  // Chestplate: red cuirass, a yellow-hot core, a brown belt; flaming arms.
  const body = box(16, 16, 8, 12, 4);
  fillBox(c, body, P.red, rand);
  {
    const [x, y] = body.front;
    fill(c, x + 1, y + 2, 6, 7, P.orange, rand);
    fill(c, x + 3, y + 3, 2, 5, P.yellow, rand);
    fill(c, x, y, 8, 1, P.darkRed, rand);
    fill(c, x, y + 10, 8, 2, P.brown, rand);
  }
  {
    const [x, y] = body.back;
    fill(c, x + 2, y + 2, 4, 6, P.orange, rand);
    fill(c, x, y + 10, 8, 2, P.brown, rand);
  }
  const arm = box(40, 16, 4, 12, 4);
  fillBox(c, arm, P.red, rand);
  for (const face of SIDES) {
    const [x, y, w] = arm[face];
    flames(c, arm[face], 12, rand);
    fill(c, x, y, w, 2, P.darkRed, rand);
    fill(c, x, y + 2, w, 1, P.brown, rand);
  }
  fill(c, ...arm.top, P.darkRed, rand);

  // Boots: the leg box, lower part only (the boots model uses rows 6..12).
  const leg = box(0, 16, 4, 12, 4);
  for (const face of SIDES) {
    const [x, y, w] = leg[face];
    fill(c, x, y + 6, w, 6, P.red, rand);
    fill(c, x, y + 6, w, 1, P.yellow, rand);
    fill(c, x, y + 8, w, 2, P.orange, rand);
    fill(c, x, y + 10, w, 2, P.brown, rand);
  }
  fill(c, ...leg.bottom, P.darkBrown, rand);
  return c;
}

function paintLayer2() {
  const c = canvas(64, 32);
  const rand = rng(9);
  // Leggings: brown belt with a yellow buckle, flames climbing red legs.
  const body = box(16, 16, 8, 12, 4);
  fillBox(c, body, P.darkRed, rand);
  for (const face of ['front', 'back', 'left', 'right']) {
    const [x, y, w] = body[face];
    fill(c, x, y + 6, w, 2, P.brown, rand);
    fill(c, x, y + 8, w, 4, P.red, rand);
  }
  {
    const [x, y] = body.front;
    fill(c, x + 3, y + 6, 2, 2, P.yellow, rand);
  }
  const leg = box(0, 16, 4, 12, 4);
  fillBox(c, leg, P.red, rand);
  for (const face of SIDES) {
    const [x, y, w] = leg[face];
    flames(c, leg[face], 12, rand);
    fill(c, x, y, w, 1, P.darkRed, rand);
  }
  return c;
}

// ---------- Pack icon: 128x128, the chestplate on a lava glow ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    const glow = Math.max(0, 1 - Math.hypot(x - 64, y - 64) / 70);
    c.set(x, y, edge ? P.orange : mix(mix(P.darkBrown, P.darkRed, y / S), P.orange, glow * 0.6));
  }
  const icon = paintChestplate();
  const scale = 6;
  const off = (S - 16 * scale) / 2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4;
    if (icon.buf[i + 3] === 0) continue;
    const col = [icon.buf[i], icon.buf[i + 1], icon.buf[i + 2]];
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      c.set(off + x * scale + sx, off + y * scale + sy, col);
    }
  }
  return c;
}

// ---------- Write ----------
const write = (rel, c) => {
  const file = path.join(out, 'resource_pack', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c.png());
};
write('textures/items/nether_helmet.png', paintHelmet());
write('textures/items/nether_chestplate.png', paintChestplate());
write('textures/items/nether_leggings.png', paintLeggings());
write('textures/items/nether_boots.png', paintBoots());
write('textures/models/armor/nether_1.png', paintLayer1());
write('textures/models/armor/nether_2.png', paintLayer2());
write('pack_icon.png', paintPackIcon());
fs.copyFileSync(path.join(out, 'resource_pack/pack_icon.png'), path.join(out, 'behavior_pack/pack_icon.png'));
console.log('wrote item icons, armor layers, and pack icons to', out);
