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
  toxic: hex('#7FA83A'),
  toxicLight: hex('#A8CF5C'),
  toxicDark: hex('#4E6B1F'),
  toxicSpot: hex('#C6F06A'),
  spiderEye: hex('#B0283A'),
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
  green: hex('#3F7A2A'),
  greenDark: hex('#23491A'),
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
// `variant` is 'plain', 'hot' (explosive), or 'poison'.
const SKINS = {
  plain: { base: P.potato, light: P.potatoLight, dark: P.potatoDark, seed: 3 },
  hot: { base: P.hotPotato, light: P.hotLight, dark: P.hotDark, seed: 7 },
  poison: { base: P.toxic, light: P.toxicLight, dark: P.toxicDark, seed: 5 },
};

function paintPotatoTile(variant) {
  const { base, light, dark, seed } = SKINS[variant];
  const c = canvas(16, 16);
  const rand = rng(seed);
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
  if (variant === 'poison') {
    // Sickly spots, like a vanilla poisonous potato.
    for (const [x, y] of [[8, 7], [4, 9], [13, 5], [10, 13]]) c.set(x, y, P.toxicSpot);
  }
  if (variant === 'hot') {
    // Embers glowing through the skin.
    for (const [x, y] of [[8, 7], [4, 9], [13, 5]]) c.set(x, y, P.ember);
  }
  return c;
}

// ---------- Icons ----------
const potatoLegend = { P: P.potato, p: P.potatoLight, d: P.potatoDark, e: P.eye };
const hotLegend = { P: P.hotPotato, p: P.hotLight, d: P.hotDark, e: P.ember };
const poisonLegend = { P: P.toxic, p: P.toxicLight, d: P.toxicDark, e: P.toxicSpot };
const LEGENDS = { plain: potatoLegend, hot: hotLegend, poison: poisonLegend };

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

function paintCrossbow(variant) {
  return paintRows(crossbowRows(), {
    L: P.limb, S: P.string, W: P.wood, I: P.iron,
    ...LEGENDS[variant],
  });
}

function paintLauncher(variant) {
  return paintRows(launcherRows(), {
    s: P.steelLight, S: P.steel, D: P.steelDark, R: P.wood,
    ...LEGENDS[variant],
  });
}

function paintBook(variant) {
  // The explosive book is red with a lit fuse; the poison book green with a spider eye.
  return paintRows(bookRows(), variant === 'poison'
    ? { R: P.greenDark, r: P.green, f: P.toxicDark, e: P.spiderEye, P: P.paper }
    : { R: P.redDark, r: P.red, f: P.fuse, e: P.ember, P: P.paper });
}

// ---------- Pack icon: 128x128 ----------
// A vanilla-style potato item: a 16x16 sprite lit from the top left, drawn
// at 6x with hard pixel edges, plus a lit fuse on its tip for the explosive half.
const PACK_POTATO = [
  '................',
  '................',
  '..........OOO...',
  '........OOLHLO..',
  '......OOLLHLPO..',
  '.....OLLHLPPPO..',
  '....OLLLPPePDO..',
  '...OLHLPPPPPDO..',
  '...OLLPePPPDO...',
  '..OLLPPPPPDDO...',
  '..OLPPPPPeDO....',
  '..OPPePPDDO.....',
  '..ODPPDDDO......',
  '...ODDDOO.......',
  '....OOO.........',
  '................',
];

function paintPackIcon() {
  const S = 128, PX = 6, OFF = 16;
  const c = canvas(S, S);
  const bg = hex('#1B1F27');
  const border = hex('#2C333F');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : bg);
  }
  const cell = (gx, gy, col) => {
    for (let dy = 0; dy < PX; dy++) for (let dx = 0; dx < PX; dx++) c.set(OFF + gx * PX + dx, OFF + gy * PX + dy, col);
  };
  const legend = {
    O: hex('#4A3014'), D: hex('#9A6A2C'), P: hex('#C8963E'),
    L: hex('#DDB25A'), H: hex('#F0D48A'), e: hex('#6E4A1C'),
  };
  PACK_POTATO.forEach((row, gy) => [...row].forEach((ch, gx) => {
    const col = legend[ch];
    if (col) cell(gx, gy, col);
  }));
  // The fuse leaves the tip up and to the right; the spark sits in the margin.
  cell(13, 1, P.fuse);
  cell(14, 0, P.fuse);
  cell(15, -1, P.ember);
  cell(16, -2, mix(P.ember, hex('#FFFFFF'), 0.5));
  return c;
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'entity'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
const items = path.join(rp, 'textures', 'items');
fs.writeFileSync(path.join(items, 'potato_crossbow.png'), paintCrossbow('plain').png());
fs.writeFileSync(path.join(items, 'potato_crossbow_explosive.png'), paintCrossbow('hot').png());
fs.writeFileSync(path.join(items, 'potato_crossbow_poison.png'), paintCrossbow('poison').png());
fs.writeFileSync(path.join(items, 'potato_launcher.png'), paintLauncher('plain').png());
fs.writeFileSync(path.join(items, 'potato_launcher_explosive.png'), paintLauncher('hot').png());
fs.writeFileSync(path.join(items, 'potato_launcher_poison.png'), paintLauncher('poison').png());
fs.writeFileSync(path.join(items, 'explosive_enchantment.png'), paintBook('hot').png());
fs.writeFileSync(path.join(items, 'poison_enchantment.png'), paintBook('poison').png());
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'potato.png'), paintPotatoTile('plain').png());
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'potato_explosive.png'), paintPotatoTile('hot').png());
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'potato_poison.png'), paintPotatoTile('poison').png());
const icon = paintPackIcon().png();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote item icons, potato textures, and pack icons to', out);
