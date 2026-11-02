// Generates the crown texture, item icons, and pack icons for this add-on.
// Run from the repo root:  node addons/blub/assets/generate.mjs addons/blub
// It overwrites the generated files under resource_pack/ and behavior_pack/;
// the generated output is what gets committed, this script is for regenerating it.
//
// The axolotl itself uses the game's own coat textures, so none are drawn here.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node addons/blub/assets/generate.mjs <addon dir>');

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

/** Paints rows of palette keys at `scale` pixels each; `.` is transparent. */
function art(rows, palette, scale = 1) {
  const size = rows.length * scale;
  const buf = Buffer.alloc(size * size * 4);
  rows.forEach((row, y) => {
    [...row].forEach((key, x) => {
      const color = palette[key];
      if (!color) return;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((y * scale + sy) * size + x * scale + sx) * 4;
          buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
        }
      }
    });
  });
  return png(size, size, buf);
}

const GOLD = [244, 196, 48];
const GOLD_LIGHT = [255, 228, 120];
const GOLD_DARK = [184, 134, 11];
const GEM = [64, 200, 224];

// ---------- Crown texture ----------
// 32x32, addressed by the box UVs in models/entity/blub.geo.json: the band at
// (0,0), the points at (0,8), the gem at (0,12).
function paintCrown() {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let color = GOLD;
      if (y < 4) color = GOLD_LIGHT; // band, top and bottom faces
      else if (y < 8) color = x % 3 === 0 ? GOLD_DARK : GOLD; // band sides
      else if (y < 12) color = GOLD_LIGHT; // points
      else if (y < 16) color = GEM;
      const i = (y * S + x) * 4;
      buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
    }
  }
  return png(S, S, buf);
}

// ---------- Item icons ----------
const eggIcon = art(
  [
    '................',
    '......pppp......',
    '.....pppppp.....',
    '....ppmpppLp....',
    '....pppppppp....',
    '...pppLppppmp...',
    '...pppppppppp...',
    '..pmpppppLpppp..',
    '..ppppmppppppp..',
    '..pppppppppmpp..',
    '..ppLppppppppd..',
    '...pppppmpppd...',
    '...pppppppppd...',
    '....ppppppdd....',
    '......dddd......',
    '................',
  ],
  { p: [247, 178, 200], m: [232, 86, 127], L: [255, 228, 236], d: [214, 130, 160] },
);

const crownIcon = art(
  [
    '................',
    '................',
    '................',
    '..g....g....g...',
    '..g...ggg...g...',
    '..gg..ggg..gg...',
    '..ggg.ggg.ggg...',
    '..ggggggggggg...',
    '..ggggcggcggg...',
    '..gggccggccgg...',
    '..ggggcggcggg...',
    '..ddddddddddd...',
    '..ddddddddddd...',
    '................',
    '................',
    '................',
  ],
  { g: GOLD, d: GOLD_DARK, c: GEM },
);

// ---------- Pack icon: Blub's face, 128x128 ----------
const packIcon = art(
  [
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbmbbbbbbbbmbbb',
    'bbmmbbbbbbbbmmbb',
    'bmmmppppppppmmmb',
    'bbmppppppppppmbb',
    'bmmppppppppppmmb',
    'bbmppkppppkppmbb',
    'bmmppkppppkppmmb',
    'bbbppppppppppbbb',
    'bbbpppkppkpppbbb',
    'bbbppppkkppppbbb',
    'bbbbppppppppbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
  ],
  { b: [120, 200, 235], p: [247, 178, 200], m: [232, 86, 127], k: [44, 26, 40] },
  8,
);

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'entity', 'blub'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'blub', 'crown.png'), paintCrown());
fs.writeFileSync(path.join(rp, 'textures', 'items', 'blub_egg.png'), eggIcon);
fs.writeFileSync(path.join(rp, 'textures', 'items', 'blub_crown.png'), crownIcon);
fs.writeFileSync(path.join(rp, 'pack_icon.png'), packIcon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), packIcon);
console.log('wrote crown texture, item icons, and pack icons to', out);
