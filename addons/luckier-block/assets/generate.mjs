// Generates the Luckier Block texture (a 16×16 rainbow question block, as a
// vertical flipbook strip whose frames cycle the hue) and both pack icons
// (128×128, the first frame scaled up).
// Run from the repo root:  node addons/luckier-block/assets/generate.mjs addons/luckier-block
// The generated output is what gets committed; this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

function write(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
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
    get(x, y) {
      const i = (y * w + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 2]];
    },
    png: () => png(w, h, buf),
  };
}

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}
const WHITE = [255, 255, 255];
const OUTLINE = [40, 24, 48];

// ---------- Block texture ----------
const QUESTION_GLYPH = [
  '.WWWW.',
  'WW..WW',
  'WW..WW',
  '...WW.',
  '..WW..',
  '..WW..',
  '......',
  '..WW..',
  '..WW..',
];
const FRAMES = 16;

/** Paints one 16×16 frame at row offset `oy`; `phase` (0..1) shifts the rainbow. */
function paintFrame(c, oy, phase) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const hue = ((x + y) / 30 + phase) % 1;
    let v = 0.95;
    if (x === 0 || y === 0) v = 1;
    if (x === 15 || y === 15) v = 0.6;
    const s = x === 0 || y === 0 ? 0.45 : 0.75;
    c.set(x, oy + y, hsv(hue, s, v));
  }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) c.set(x, oy + y, OUTLINE);
  QUESTION_GLYPH.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'W') c.set(5 + x + 1, oy + 3 + y + 1, OUTLINE);
  });
  QUESTION_GLYPH.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'W') c.set(5 + x, oy + 3 + y, WHITE);
  });
}

const strip = canvas(16, 16 * FRAMES);
for (let f = 0; f < FRAMES; f++) paintFrame(strip, f * 16, f / FRAMES);
write('resource_pack/textures/blocks/luckier_block.png', strip.png());

// ---------- Pack icons (128x128): the block, centered with a margin ----------
// The game rounds and crops icon corners, so the block keeps a 24px margin.
const ICON_SCALE = 5;
function packIcon(label) {
  const c = canvas(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) c.set(x, y, hsv(0.75, 0.5, 0.25 + 0.15 * (y / 127)));
  const size = 16 * ICON_SCALE;
  const offset = (128 - size) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    c.set(offset + x, offset + y, strip.get(Math.floor(x / ICON_SCALE), Math.floor(y / ICON_SCALE)));
  }
  const tag = label === 'BP' ? [242, 193, 78] : [91, 232, 199];
  for (let y = 118; y < 122; y++) for (let x = 6; x < (label === 'BP' ? 14 : 22); x++) c.set(x, y, tag);
  return c.png();
}
write('behavior_pack/pack_icon.png', packIcon('BP'));
write('resource_pack/pack_icon.png', packIcon('RP'));
