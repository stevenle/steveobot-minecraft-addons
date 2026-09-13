// Generates the backpack textures and the pack icons for this add-on.
// Run from the repo root:  node addons/backpack/assets/generate.mjs addons/backpack
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
    png: () => png(w, h, buf),
  };
}

function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

// Deterministic speckle so leather does not read as a flat fill.
function noise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
function shade(color, t) { return color.map((v) => Math.max(0, Math.min(255, Math.round(v * t)))); }

// ---------- Item icon: 16×16 ----------
const ICON = [
  '................',
  '.....HHHHHH.....',
  '....H......H....',
  '..DDDDDDDDDDDD..',
  '..DDDDDDDDDDDD..',
  '..DDDDDDDDDDDD..',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '..BBBPPPPPPBBB..',
  '..BBBPPXXPPBBB..',
  '..BBBPPXXPPBBB..',
  '..BBBPPPPPPBBB..',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '..DBBBBBBBBBBD..',
  '...DDDDDDDDDD...',
];
const ICON_PALETTE = { B: hex('#8B5A2B'), D: hex('#5C3A1A'), P: hex('#74491F'), X: hex('#D9B44A'), H: hex('#3B2A1A') };
function paintIcon() {
  const c = canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = ICON_PALETTE[ICON[y][x]];
    if (!col) continue;
    const t = ICON[y][x] === 'B' ? 0.94 + noise(x, y) * 0.12 : 1;
    c.set(x, y, shade(col, t));
  }
  return c.png();
}

// ---------- Model texture: 32×32 ----------
// Regions used by backpack.geo.json:
//   [0,0]-[16,16]   bag leather
//   [16,0]-[32,16]  flap (darker)
//   [0,16]-[16,32]  straps and pocket sides (darkest)
//   [16,16]-[32,32] pocket front with a buckle
function paintModel() {
  const c = canvas(32, 32);
  const fill = (x0, y0, base, spread) => {
    for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
      c.set(x, y, shade(base, 1 + (noise(x, y) - 0.5) * spread));
    }
  };
  fill(0, 0, ICON_PALETTE.B, 0.16);
  fill(16, 0, ICON_PALETTE.D, 0.14);
  fill(0, 16, ICON_PALETTE.H, 0.12);
  fill(16, 16, ICON_PALETTE.P, 0.14);
  // Stitching along the flap edge and the bag seams.
  const stitch = hex('#C89A5B');
  for (let x = 16; x < 32; x++) if (x % 2 === 0) c.set(x, 3, stitch);
  for (let y = 0; y < 16; y++) if (y % 2 === 0) { c.set(0, y, stitch); c.set(6, y, stitch); }
  // Buckle on the pocket front: gold with a dark rim.
  for (let y = 17; y < 21; y++) for (let x = 17; x < 21; x++) c.set(x, y, ICON_PALETTE.H);
  for (let y = 18; y < 20; y++) for (let x = 18; x < 20; x++) c.set(x, y, ICON_PALETTE.X);
  return c.png();
}

// ---------- Pack icon: 128×128 ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const bg = hex('#1B1F27');
  const border = hex('#2C333F');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : bg);
  }
  const scale = 6;
  const offset = (S - 16 * scale) / 2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = ICON_PALETTE[ICON[y][x]];
    if (!col) continue;
    const t = ICON[y][x] === 'B' ? 0.94 + noise(x, y) * 0.12 : 1;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      c.set(offset + x * scale + dx, offset + y * scale + dy, shade(col, t));
    }
  }
  return c.png();
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
for (const dir of ['items', 'entity']) fs.mkdirSync(path.join(rp, 'textures', dir), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'items', 'backpack.png'), paintIcon());
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'backpack.png'), paintModel());
const icon = paintPackIcon();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote backpack textures and pack icons to', out);
