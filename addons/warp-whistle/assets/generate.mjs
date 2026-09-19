// Generates the whistle item icon and the pack icons for this add-on.
// Run from the repo root:  node addons/warp-whistle/assets/generate.mjs addons/warp-whistle
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

// ---------- Whistle: 16×16 pixel art ----------
// Mouthpiece on the left, round barrel on the right, a dark slot on top.
const WHISTLE = [
  '................',
  '................',
  '..........oooo..',
  '.........oYhhYo.',
  '..oooooooYYDDYYo',
  '.oYhhhhhhYYYYYYo',
  '.oYYYYYYYYYYYYYo',
  '.oyyyyyyyYYYYYYo',
  '..oooooooYYYyyYo',
  '.........oYyyYo.',
  '..........oooo..',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const COLORS = {
  Y: hex('#F2C14E'), // gold
  h: hex('#FFE9A3'), // highlight
  y: hex('#C9952B'), // shade
  o: hex('#6B4712'), // outline
  D: hex('#2A1B06'), // slot
};

function paintWhistle(c, ox, oy, scale) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = COLORS[WHISTLE[y][x]];
    if (!col) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      c.set(ox + x * scale + dx, oy + y * scale + dy, col);
    }
  }
}

function paintItemIcon() {
  const c = canvas(16, 16);
  paintWhistle(c, 0, 0, 1);
  return c.png();
}

// ---------- Pack icon: 128×128 ----------
// A night-sky background, a swirl of wind, and the whistle on top.
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const bg = hex('#14213D');
  const border = hex('#26365C');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : bg);
  }
  // Wind swirl: a spiral of soft white dots, fading toward the center.
  const white = hex('#EAF2FF');
  const cx = 64, cy = 64;
  for (let t = 0; t < 900; t++) {
    const a = t / 40;
    const r = 8 + a * 8;
    if (r > 58) break;
    const px = Math.round(cx + Math.cos(a) * r);
    const py = Math.round(cy + Math.sin(a) * r * 0.8);
    const alpha = Math.round(90 + (r / 58) * 140);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.set(px + dx, py + dy, white, alpha);
  }
  paintWhistle(c, 16, 16, 6);
  return c.png();
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'items', 'warp_whistle.png'), paintItemIcon());
const icon = paintPackIcon();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote whistle icon and pack icons to', out);
