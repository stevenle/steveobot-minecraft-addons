// Generates the block textures and pack icons for this add-on.
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
      const [r, g, b] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
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

const rp = path.join(out, 'resource_pack');
const blocks = path.join(rp, 'textures', 'blocks');
fs.mkdirSync(blocks, { recursive: true });
fs.writeFileSync(path.join(blocks, 'cloud_block.png'), png(16, cloud));
fs.writeFileSync(path.join(blocks, 'cloud_portal_top.png'), png(16, portalTop));
fs.writeFileSync(path.join(blocks, 'cloud_portal_side.png'), png(16, portalSide));
const packIcon = png(128, icon);
fs.writeFileSync(path.join(rp, 'pack_icon.png'), packIcon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), packIcon);
console.log('wrote block textures and pack icons to', out);
