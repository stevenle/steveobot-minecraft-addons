// Generates the Hand Lantern item icon (16×16) and both pack icons
// (128×128, the item icon scaled up 8×).
// Run from the repo root:  node addons/lantern/assets/generate.mjs addons/lantern
// The generated output is what gets committed; this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

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
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

// An iron lantern on a carrying loop: dark frame, glowing amber glass, a bright flame.
const PALETTE = {
  '.': null,
  o: hex('#1e1e26'), // outline
  i: hex('#4a4a58'), // iron
  s: hex('#7a7a8c'), // iron highlight
  a: hex('#c46a12'), // glass, dim
  g: hex('#f2a12e'), // glass
  y: hex('#ffd45c'), // glow
  w: hex('#fff6c8'), // flame core
};
const ART = [
  '......oooo......',
  '.....o....o.....',
  '.....o....o.....',
  '......oiio......',
  '....oossssoo....',
  '....oiiiiiio....',
  '....oaggggao....',
  '....oagyygao....',
  '....ogywwygo....',
  '....ogywwygo....',
  '....oagyygao....',
  '....oaggggao....',
  '....oiiiiiio....',
  '....oossssoo....',
  '.....oiiiio.....',
  '......oooo......',
];

function render(scale) {
  const size = 16 * scale;
  const buf = Buffer.alloc(size * size * 4);
  ART.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = PALETTE[ch];
    if (c === undefined) throw new Error(`unknown pixel '${ch}'`);
    if (!c) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = ((y * scale + dy) * size + x * scale + dx) * 4;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  }));
  return png(size, size, buf);
}

fs.writeFileSync(path.join(out, 'resource_pack/textures/items/steveo_hand_lantern.png'), render(1));
for (const pack of ['behavior_pack', 'resource_pack']) {
  fs.writeFileSync(path.join(out, pack, 'pack_icon.png'), render(8));
}
