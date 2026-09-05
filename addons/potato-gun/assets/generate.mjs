// Generates the item icons, the potato entity textures, and the pack icons for this add-on.
// Run from the repo root:  node addons/potato-gun/assets/generate.mjs addons/potato-gun
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
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }

/** Deterministic noise so regenerating gives identical bytes. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------- Palette ----------
const P = {
  potato: hex('#C9A25A'),
  potatoLight: hex('#E0BE77'),
  potatoDark: hex('#9E7A3B'),
  eye: hex('#6E4E22'),
  hotPotato: hex('#D96A2F'),
  hotLight: hex('#F0955A'),
  hotDark: hex('#9C3F16'),
  ember: hex('#FFE066'),
  wood: hex('#7A4E25'),
  woodLight: hex('#A0703A'),
  limb: hex('#4A3520'),
  iron: hex('#9CA3AF'),
  string: hex('#E8E4D8'),
  steel: hex('#5B6470'),
  steelLight: hex('#8B96A5'),
  steelDark: hex('#2F353D'),
  red: hex('#C0392B'),
  redDark: hex('#7B1F17'),
  paper: hex('#EADFC5'),
  fuse: hex('#3B3B3B'),
};

/** Paints a 16x16 icon from character rows and a legend. */
function paintRows(rows, legend) {
  const c = canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = legend[rows[y][x]];
    if (col) c.set(x, y, col);
  }
  return c;
}

// ---------- Potato entity texture: 16x16 tile ----------
function paintPotatoTile(hot) {
  const base = hot ? P.hotPotato : P.potato;
  const light = hot ? P.hotLight : P.potatoLight;
  const dark = hot ? P.hotDark : P.potatoDark;
  const c = canvas(16, 16);
  const rand = rng(hot ? 7 : 3);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = rand();
    let col = base;
    if (n < 0.12) col = light;
    else if (n < 0.24) col = dark;
    c.set(x, y, col);
  }
  // A few "eyes" so it reads as a potato and not a brick.
  for (const [x, y] of [[3, 4], [10, 3], [6, 10], [12, 12], [2, 13]]) {
    c.set(x, y, P.eye);
    c.set(x + 1, y, dark);
  }
  if (hot) {
    // Embers glowing through the skin.
    for (const [x, y] of [[8, 7], [4, 9], [13, 5]]) c.set(x, y, P.ember);
  }
  return c;
}

// ---------- Icons ----------
const potatoLegend = { P: P.potato, p: P.potatoLight, d: P.potatoDark, e: P.eye };
const hotLegend = { P: P.hotPotato, p: P.hotLight, d: P.hotDark, e: P.ember };

function crossbowRows() {
  return [
    '................',
    '.LL..........LL.',
    '.LLL........LLL.',
    '..LLL......LLL..',
    '...LLL.pP.LLL...',
    '....LLLPPPLLL...',
    '.....SSePdSS....',
    '......WWdW......',
    '......WWWW......',
    '.....WIWWW......',
    '.....WWWWWW.....',
    '.....WWWWWW.....',
    '......WWWW......',
    '......WWW.......',
    '......WW........',
    '................',
  ];
}

function launcherRows() {
  return [
    '..............ss',
    '............sSSS',
    '...........sSSSD',
    '..........sSSSD.',
    '.........sSSSD..',
    '........sSSSD...',
    '.......sSSSD....',
    '......sSSSD.....',
    '.....sSSSD.R....',
    '....sSSSD..R....',
    '...sSSSD..RR....',
    '..pPPSD.........',
    '.pPPPP..........',
    '.PPeP...........',
    '..dd............',
    '................',
  ];
}

function bookRows() {
  return [
    '................',
    '..RRRRRRRRRRR...',
    '.RRRRRRRRRRRRR..',
    '.RrrrrrrrrrrRR..',
    '.RrrrrrrrrrrRR..',
    '.RrrffffffrrRR..',
    '.RrrfeffefrrRR..',
    '.RrrffffffrrRR..',
    '.RrrfffeffrrRR..',
    '.RrrffffffrrRR..',
    '.RrrrrrrrrrrRR..',
    '.RrrrrrrrrrrRR..',
    '.RRRRRRRRRRRRR..',
    '..PPPPPPPPPPP...',
    '..PPPPPPPPPPP...',
    '................',
  ];
}

function paintCrossbow(hot) {
  return paintRows(crossbowRows(), {
    L: P.limb, S: P.string, W: P.wood, I: P.iron,
    ...(hot ? hotLegend : potatoLegend),
  });
}

function paintLauncher(hot) {
  return paintRows(launcherRows(), {
    s: P.steelLight, S: P.steel, D: P.steelDark, R: P.wood,
    ...(hot ? hotLegend : potatoLegend),
  });
}

function paintBook() {
  return paintRows(bookRows(), {
    R: P.redDark, r: P.red, f: P.fuse, e: P.ember, P: P.paper,
  });
}

// ---------- Pack icon: 128x128 ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const bg = hex('#1B1F27');
  const border = hex('#2C333F');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : bg);
  }
  // A big lumpy potato in the middle.
  const rand = rng(11);
  const cx = 64, cy = 66, rx = 44, ry = 30;
  const noise = Array.from({ length: S }, () => Array.from({ length: S }, () => rand()));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    // Two bumps make the ellipse lumpy.
    const bump = 0.12 * Math.sin(dx * 5) * Math.cos(dy * 3);
    const r = Math.sqrt(dx * dx + dy * dy) + bump;
    if (r > 1) continue;
    const n = noise[y][x];
    let col = P.potato;
    if (n < 0.1) col = P.potatoLight;
    else if (n < 0.2) col = P.potatoDark;
    if (r > 0.92) col = mix(col, P.potatoDark, 0.6);
    c.set(x, y, col);
  }
  for (const [x, y] of [[40, 56], [78, 50], [60, 80], [92, 74], [48, 78]]) {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) c.set(x + dx, y + dy, P.eye);
  }
  // A lit fuse on top, for the explosive half of the add-on.
  for (let i = 0; i < 14; i++) c.set(70 + Math.round(i * 0.6), 36 - i, P.fuse);
  for (let i = 0; i < 14; i++) c.set(71 + Math.round(i * 0.6), 36 - i, P.fuse);
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 0], [0, -1], [1, -1], [0, 2], [1, 2]]) {
    c.set(79 + dx, 21 + dy, P.ember);
  }
  return c;
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'entity'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
const items = path.join(rp, 'textures', 'items');
fs.writeFileSync(path.join(items, 'potato_crossbow.png'), paintCrossbow(false).png());
fs.writeFileSync(path.join(items, 'potato_crossbow_explosive.png'), paintCrossbow(true).png());
fs.writeFileSync(path.join(items, 'potato_launcher.png'), paintLauncher(false).png());
fs.writeFileSync(path.join(items, 'potato_launcher_explosive.png'), paintLauncher(true).png());
fs.writeFileSync(path.join(items, 'explosive_enchantment.png'), paintBook().png());
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'potato.png'), paintPotatoTile(false).png());
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'potato_explosive.png'), paintPotatoTile(true).png());
const icon = paintPackIcon().png();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote item icons, potato textures, and pack icons to', out);
