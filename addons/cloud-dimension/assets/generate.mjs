// Generates the block, entity and item textures and the pack icons for this add-on.
// Run from the repo root:
//   node addons/cloud-dimension/assets/generate.mjs addons/cloud-dimension
// It overwrites the generated files; the generated output is what gets
// committed, this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node addons/cloud-dimension/assets/generate.mjs <addon dir>');

// ---------- PNG ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic per-pixel noise in [0, 1). */
function noise(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const WHITE = [250, 252, 255];
const SHADE = [214, 228, 246];
const SKY = [126, 196, 245];
const DEEP = [64, 138, 222];

// Cloud: soft white with faint blue puffs.
const cloud = (x, y) => {
  const puff = (Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 0.8 - x * 0.3)) * 0.25 + 0.5;
  return mix(WHITE, SHADE, Math.min(1, puff * 0.5 + noise(x, y, 1) * 0.35));
};

// Portal top: a blue swirl inside a cloud rim.
const portalTop = (x, y) => {
  const cx = x - 7.5, cy = y - 7.5;
  const r = Math.hypot(cx, cy);
  if (r > 6.5) return cloud(x, y);
  const a = Math.atan2(cy, cx);
  const swirl = (Math.sin(a * 3 + r * 1.1) + 1) / 2;
  return mix(DEEP, [235, 248, 255], swirl * (1 - r / 9));
};

// Portal side: cloud with a sky-blue band.
const portalSide = (x, y) => (y >= 6 && y <= 9 ? mix(SKY, DEEP, noise(x, y, 2) * 0.4) : cloud(x, y));

// Pack icon: a white cloud on a sky gradient.
const icon = (x, y) => {
  const blobs = [[40, 74, 24], [64, 60, 30], [90, 72, 24], [64, 82, 22]];
  const inCloud = blobs.some(([bx, by, br]) => Math.hypot(x - bx, y - by) < br);
  if (inCloud) return mix(WHITE, SHADE, y > 80 ? 0.6 : 0.1);
  return mix([170, 220, 255], SKY, y / 128);
};

// Gust pad top: white arrows pointing up out of a sky-blue swirl.
const gustTop = (x, y) => {
  const cx = x - 7.5, cy = y - 7.5;
  const ring = Math.abs(Math.hypot(cx, cy) - 5) < 1.1;
  const arrow = (y >= 3 && y <= 12 && Math.abs(cx) < 1) || (y >= 3 && y <= 6 && Math.abs(cx) <= 7 - y);
  if (arrow) return WHITE;
  if (ring) return mix(SKY, WHITE, 0.4);
  return mix(SKY, DEEP, noise(x, y, 3) * 0.5);
};

// Storm altar: dark storm-cloud stone with a lightning crystal socket on top.
const STORM = [72, 84, 120];
const STORM_DARK = [44, 52, 80];
const BOLT = [255, 230, 90];
const altarSide = (x, y) => {
  if (y === 0 || y === 15) return STORM_DARK;
  const bolt = [[8, 3], [7, 4], [7, 5], [6, 6], [7, 7], [8, 7], [9, 7], [8, 8], [8, 9], [7, 10], [7, 11], [6, 12]];
  if (bolt.some(([bx, by]) => bx === x && by === y)) return BOLT;
  return mix(STORM, STORM_DARK, noise(x, y, 4) * 0.6);
};
const altarTop = (x, y) => {
  const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  if (d < 2.5) return mix([150, 220, 255], [80, 150, 240], noise(x, y, 5));
  if (d < 3.5) return BOLT;
  return mix(STORM, STORM_DARK, noise(x, y, 6) * 0.6);
};

// ---------- Floatato texture, 32x32 ----------
// UVs from models/entity/floatato.geo.json: the body box (6x7x6) at (0,0),
// whose front face (north) is x 6..11, y 6..12; the wings (4x3x1) at (0,16).
function floatato(skin, spot, shine) {
  return (x, y) => {
    if (y >= 16 && y < 20 && x < 10) {
      return mix([255, 255, 255], [214, 228, 246], (x + y) % 3 === 0 ? 0.7 : 0);
    }
    if (y >= 13 || x >= 24) return [0, 0, 0, 0];
    // The face.
    if (x >= 6 && x < 12 && y >= 6) {
      const fx = x - 6, fy = y - 6;
      if ((fx === 1 || fx === 4) && fy === 2) return [30, 20, 15];
      if ((fx === 1 || fx === 4) && fy === 1) return [255, 255, 255];
      if (fy === 4 && fx >= 2 && fx <= 3) return [120, 50, 40];
      if (fy === 3 && (fx === 1 || fx === 4)) return [240, 140, 140];
    }
    const n = noise(x, y, 7);
    if (n < 0.08) return spot;
    if (n > 0.9) return shine;
    return mix(skin, spot, n * 0.25);
  };
}

// ---------- Item icons, 16x16 ----------
function art(rows, palette) {
  return (x, y) => palette[rows[y]?.[x] ?? '.'] ?? [0, 0, 0, 0];
}
const staffIcon = art(
  [
    '..........wwww..',
    '.........wwccww.',
    '........wcbbcw..',
    '........wcbbcw..',
    '.........wccw...',
    '........dd......',
    '.......dd.......',
    '......dd........',
    '.....dd.........',
    '....dd..........',
    '...dd...........',
    '..dd............',
    '.dd.............',
    'dd..............',
    '................',
    '................',
  ],
  { w: WHITE, c: SHADE, b: SKY, d: [120, 90, 60] },
);
const crystalIcon = art(
  [
    '................',
    '.......y........',
    '......bcb.......',
    '.....bccdb......',
    '....bcccddb.....',
    '...bccyccddb....',
    '...bcccyccdb....',
    '...bccycccdb....',
    '...bcccyccdb....',
    '...bccyccddb....',
    '....bccccdb.....',
    '.....bccdb......',
    '......bdb.......',
    '.......b........',
    '................',
    '................',
  ],
  { b: [40, 70, 140], c: [130, 200, 255], d: [70, 130, 220], y: BOLT },
);

const rp = path.join(out, 'resource_pack');
const blocks = path.join(rp, 'textures', 'blocks');
fs.mkdirSync(blocks, { recursive: true });
fs.writeFileSync(path.join(blocks, 'cloud_block.png'), png(16, cloud));
fs.writeFileSync(path.join(blocks, 'cloud_portal_top.png'), png(16, portalTop));
fs.writeFileSync(path.join(blocks, 'cloud_portal_side.png'), png(16, portalSide));
fs.writeFileSync(path.join(blocks, 'gust_pad_top.png'), png(16, gustTop));
fs.writeFileSync(path.join(blocks, 'storm_altar_side.png'), png(16, altarSide));
fs.writeFileSync(path.join(blocks, 'storm_altar_top.png'), png(16, altarTop));
const ent = path.join(rp, 'textures', 'entity', 'floatato');
fs.mkdirSync(ent, { recursive: true });
fs.writeFileSync(path.join(ent, 'floatato.png'), png(32, floatato([196, 150, 92], [140, 100, 56], [222, 186, 130])));
fs.writeFileSync(path.join(ent, 'floatato_golden.png'), png(32, floatato([244, 196, 48], [184, 134, 11], [255, 240, 160])));
const items = path.join(rp, 'textures', 'items');
fs.mkdirSync(items, { recursive: true });
fs.writeFileSync(path.join(items, 'cloud_staff.png'), png(16, staffIcon));
fs.writeFileSync(path.join(items, 'storm_crystal.png'), png(16, crystalIcon));
const packIcon = png(128, icon);
fs.writeFileSync(path.join(rp, 'pack_icon.png'), packIcon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), packIcon);
console.log('wrote block textures and pack icons to', out);
