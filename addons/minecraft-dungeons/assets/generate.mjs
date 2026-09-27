// Generates the item icons, the Ender Armor layers, Tim's skin, the particle
// texture, and the pack icons for this add-on.
// Run from the repo root:  node addons/minecraft-dungeons/assets/generate.mjs addons/minecraft-dungeons
// It overwrites the generated files under resource_pack/ and behavior_pack/;
// the generated output is what gets committed, this script is for regenerating it.
// The designs follow the Minecraft Dungeons Arcade trading cards.
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
    clear(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      buf.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
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

/** Fills a rectangle with `color`, lightly speckled so it does not look flat. */
function fill(c, x0, y0, w, h, color, rand, grain = 0.08) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = rand ? (rand() - 0.5) * 2 * grain : 0;
    c.set(x, y, n >= 0 ? mix(color, [255, 255, 255], n) : mix(color, [0, 0, 0], -n));
  }
}

/** Paints a 16x16 icon from character rows and a legend. */
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
  // Firebrand
  flame: hex('#FFB23A'),
  flameLight: hex('#FFE7A0'),
  flameDark: hex('#E0661C'),
  ember: hex('#B23A12'),
  haft: hex('#6B3A22'),
  haftLight: hex('#8C5233'),
  haftDark: hex('#3E2216'),
  // Ender Armor
  plate: hex('#5E5E66'),
  plateLight: hex('#9A9AA3'),
  plateDark: hex('#3A3A42'),
  obsidian: hex('#1E1B26'),
  obsidianLight: hex('#2E2A38'),
  magenta: hex('#E14ACB'),
  magentaDark: hex('#9C2B8C'),
  white: hex('#EDEDED'),
  // Corrupted Beacon
  frame: hex('#F4ECF8'),
  frameShade: hex('#C9B7D6'),
  core: hex('#C04FB6'),
  coreDark: hex('#6D2C86'),
  cyan: hex('#3CC8F0'),
  cyanDark: hex('#1C7FB0'),
  base: hex('#3B3F6B'),
  black: hex('#141018'),
  // Tim
  skin: hex('#4A2C1E'),
  skinLight: hex('#5C3826'),
  hair: hex('#24160F'),
  red: hex('#C8202A'),
  redDark: hex('#8E1620'),
  redLight: hex('#E0404A'),
  blue: hex('#2F86D6'),
  blueDark: hex('#1C4F9C'),
  eye: hex('#1A1A1A'),
  paper: hex('#EADFC5'),
  paperDark: hex('#C9B893'),
  gold: hex('#E8B92E'),
};

// ---------- Firebrand: a flaming double axe on a dark haft ----------
function paintFirebrand() {
  return paintRows([
    '........lL......',
    '......lLFFL..L..',
    '.....lFFFFFL.Fl.',
    '....LFFfFFFFLFF.',
    '....FFffDFFFFFL.',
    '....FfDDhDFFFF..',
    '.....FDhHDDFfF..',
    '......LhHDFFFF..',
    '......hHdLFFf...',
    '.....hHd...LF...',
    '....hHd.........',
    '...hHd..........',
    '..hHd...........',
    '.eed............',
    'eEe.............',
    '.e..............',
  ], {
    l: P.flameLight, L: P.flameLight, F: P.flame, f: P.flameDark, D: P.ember,
    h: P.haftLight, H: P.haft, d: P.haftDark, e: P.flameDark, E: P.ember,
  });
}

// ---------- Corrupted Beacon: a white cage around a pink core with cyan eyes ----------
function paintBeacon() {
  return paintRows([
    '................',
    '.....WWWWWWWW...',
    '....W......WW...',
    '...WWWWWWWWW.W..',
    '...W.pcccp.W.W..',
    '...W.cCkCc.W.W..',
    '...WpcKKKcpW.W..',
    '...WpcCkCcpW.W..',
    '...W.cpCpc.W.W..',
    '...W.ppppp.W.W..',
    '...W.bbbbb.W.W..',
    '...WbbbbbbbWW...',
    '...WWWWWWWWWW...',
    '................',
    '................',
    '................',
  ], {
    W: P.frame, p: P.core, c: P.cyan, C: P.cyanDark, k: P.black, K: P.black, b: P.base,
  });
}

// ---------- Ender Armor icons ----------
const ARMOR_LEGEND = {
  g: P.plateLight, G: P.plate, d: P.plateDark, o: P.obsidian, O: P.obsidianLight, m: P.magenta, M: P.magentaDark,
};

function paintHelmet() {
  return paintRows([
    '................',
    '................',
    '....GGGGGGGG....',
    '...GgggggggGd...',
    '..GgGGGGGGGGGd..',
    '..GooooooooooG..',
    '..GooooooooooG..',
    '..dGmmGGGGmmGd..',
    '..dG........Gd..',
    '..dG........Gd..',
    '..dd........dd..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

function paintChestplate() {
  return paintRows([
    '................',
    '..ggg......ggg..',
    '.gGGGo....oGGGg.',
    '.gGGGoommooGGGg.',
    '.dGGOoooooOoGGd.',
    '.ddGOGGGGGGOGdd.',
    '...dOGggggGOd...',
    '....OGGGGGGO....',
    '....OGGGGGGO....',
    '....OoooooOO....',
    '....OOmmmmOO....',
    '....OOmOOmOO....',
    '....OOmmmmOO....',
    '....dddddddd....',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

function paintLeggings() {
  return paintRows([
    '................',
    '...OOmmmmmmOO...',
    '...OOmoooomOO...',
    '...OOmmmmmmOO...',
    '...OOOOOOOOOO...',
    '...GGGO..OGGG...',
    '...GgGO..OGgG...',
    '...GgGO..OGgG...',
    '...GGGO..OGGG...',
    '...OOOO..OOOO...',
    '...GGGO..OGGG...',
    '...GgGO..OGgG...',
    '...dddd..dddd...',
    '................',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

function paintBoots() {
  return paintRows([
    '................',
    '................',
    '................',
    '................',
    '................',
    '...OOOO..OOOO...',
    '...GGGO..OGGG...',
    '...GgGO..OGgG...',
    '...GgGO..OGgG...',
    '...mmmO..Ommm...',
    '..gGGGO..OGGGg..',
    '..GGGGO..OGGGG..',
    '..dddd....dddd..',
    '................',
    '................',
    '................',
  ], ARMOR_LEGEND);
}

// ---------- Tim's card: a little trading card with Tim's red mask ----------
function paintTimCard() {
  return paintRows([
    '................',
    '...YYYYYYYYYY...',
    '...YppppppppY...',
    '...YpHHHHHHpY...',
    '...YpSSSSSSpY...',
    '...YpRRRRRRpY...',
    '...YpRWRRWRpY...',
    '...YpSSSSSSpY...',
    '...YpSSwwSSpY...',
    '...YpRRRRRRpY...',
    '...YpRrWWrRpY...',
    '...YpRRRRRRpY...',
    '...YppppppppY...',
    '...YPPPPPPPPY...',
    '...YYYYYYYYYY...',
    '................',
  ], {
    Y: P.gold, p: P.paper, P: P.paperDark, H: P.hair, S: P.skin, R: P.red, r: P.redDark,
    W: P.white, w: P.white,
  });
}

// ---------- Ender Armor layers (64x32, the vanilla humanoid armor layout) ----------
// Regions: head box at (0,0) 8x8x8; body at (16,16) 8x12x4; arm at (40,16)
// 4x12x4; leg at (0,16) 4x12x4. Each box's faces are laid out
// [side][front][side][back] under [top][bottom].
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

function paintArmorLayer1() {
  const c = canvas(64, 32);
  const rand = rng(11);
  // Helmet: plate, a black visor band, magenta ender eyes, open face below.
  const head = box(0, 0, 8, 8, 8);
  fillBox(c, head, P.plate, rand);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = head[face];
    fill(c, x, y, w, 1, P.plateLight, rand);
    fill(c, x, y + 3, w, 2, P.obsidian, rand);
  }
  {
    const [x, y] = head.front;
    for (const ex of [1, 2, 5, 6]) c.set(x + ex, y + 5, P.magenta);
    // Open face under the eye line, cheek guards at the edges.
    for (let yy = y + 6; yy < y + 8; yy++) for (let xx = x + 1; xx < x + 7; xx++) c.clear(xx, yy);
  }
  fill(c, ...head.top, P.plateDark, rand);

  // Chestplate: black cuirass, grey chest plate, magenta collar; grey pauldrons.
  const body = box(16, 16, 8, 12, 4);
  fillBox(c, body, P.obsidian, rand);
  {
    const [x, y] = body.front;
    fill(c, x + 1, y + 2, 6, 5, P.plate, rand);
    fill(c, x + 2, y + 3, 4, 1, P.plateLight, rand);
    fill(c, x + 2, y, 4, 1, P.magenta, rand, 0.04);
    fill(c, x, y + 11, 8, 1, P.plateDark, rand);
  }
  {
    const [x, y] = body.back;
    fill(c, x + 1, y + 1, 6, 6, P.plateDark, rand);
  }
  const arm = box(40, 16, 4, 12, 4);
  fillBox(c, arm, P.obsidianLight, rand);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = arm[face];
    fill(c, x, y, w, 4, P.plateLight, rand);
    fill(c, x, y + 4, w, 1, P.plateDark, rand);
    fill(c, x, y + 9, w, 3, P.plate, rand);
  }
  fill(c, ...arm.top, P.plateLight, rand);

  // Boots: the leg box, lower part only (the boots model uses rows 6..12).
  const leg = box(0, 16, 4, 12, 4);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = leg[face];
    fill(c, x, y + 6, w, 6, P.plate, rand);
    fill(c, x, y + 6, w, 1, P.magenta, rand, 0.04);
    fill(c, x, y + 11, w, 1, P.plateDark, rand);
  }
  fill(c, ...leg.bottom, P.plateDark, rand);
  return c;
}

function paintArmorLayer2() {
  const c = canvas(64, 32);
  const rand = rng(13);
  // Leggings: belt with a magenta buckle on the body, grey greaves on the legs.
  const body = box(16, 16, 8, 12, 4);
  fillBox(c, body, P.obsidian, rand);
  {
    const [x, y] = body.front;
    fill(c, x + 2, y + 7, 4, 4, P.magenta, rand, 0.04);
    fill(c, x + 3, y + 8, 2, 2, P.obsidian);
  }
  const leg = box(0, 16, 4, 12, 4);
  fillBox(c, leg, P.plate, rand);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = leg[face];
    fill(c, x, y, w, 2, P.obsidianLight, rand);
    fill(c, x, y + 5, w, 1, P.obsidian, rand);
    fill(c, x, y + 11, w, 1, P.plateDark, rand);
  }
  {
    const [x, y] = leg.front;
    fill(c, x + 1, y + 2, 2, 3, P.plateLight, rand);
  }
  return c;
}

// ---------- Tim's skin (64x64, the standard player skin layout) ----------
function paintTim() {
  const c = canvas(64, 64);
  const rand = rng(21);
  // Head: dark skin, short dark hair, the red mask across the eyes.
  const head = box(0, 0, 8, 8, 8);
  fillBox(c, head, P.skin, rand);
  fill(c, ...head.top, P.hair, rand);
  for (const face of ['left', 'right', 'back']) {
    const [x, y, w] = head[face];
    fill(c, x, y, w, 2, P.hair, rand);
    fill(c, x, y + 2, w, 2, P.red, rand, 0.04);
  }
  {
    const [x, y] = head.back;
    fill(c, x, y + 2, 8, 3, P.hair, rand);
    fill(c, x, y + 2, 8, 2, P.red, rand, 0.04);
  }
  {
    const [x, y] = head.front;
    fill(c, x, y, 8, 1, P.hair, rand);
    fill(c, x, y + 2, 8, 2, P.red, rand, 0.04);
    fill(c, x + 1, y + 4, 1, 1, P.red);
    fill(c, x + 6, y + 4, 1, 1, P.red);
    // Eyes: white with a dark pupil toward the middle.
    c.set(x + 1, y + 3, P.white); c.set(x + 2, y + 3, P.eye);
    c.set(x + 5, y + 3, P.eye); c.set(x + 6, y + 3, P.white);
    // A grin.
    c.set(x + 3, y + 6, P.white); c.set(x + 4, y + 6, P.white);
  }

  // Body: red top with a white stripe belt and a V collar.
  const body = box(16, 16, 8, 12, 4);
  fillBox(c, body, P.red, rand);
  {
    const [x, y] = body.front;
    fill(c, x + 3, y, 2, 2, P.skin, rand);
    c.set(x + 2, y, P.skin); c.set(x + 5, y, P.skin);
    fill(c, x, y + 1, 1, 6, P.redDark, rand);
    fill(c, x + 7, y + 1, 1, 6, P.redDark, rand);
    fill(c, x, y + 7, 8, 2, P.white, rand, 0.03);
    c.set(x + 2, y + 8, P.redDark); c.set(x + 5, y + 8, P.redDark);
    fill(c, x, y + 9, 8, 3, P.redDark, rand);
  }
  {
    const [x, y] = body.back;
    fill(c, x, y + 7, 8, 2, P.white, rand, 0.03);
    fill(c, x, y + 9, 8, 3, P.redDark, rand);
  }
  for (const face of ['left', 'right']) {
    const [x, y, w] = body[face];
    fill(c, x, y + 7, w, 2, P.white, rand, 0.03);
  }

  // Right arm (40,16): red sleeve, bare upper arm, blue gauntlet.
  const rightArm = box(40, 16, 4, 12, 4);
  fillBox(c, rightArm, P.skin, rand);
  fill(c, ...rightArm.top, P.red, rand);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = rightArm[face];
    fill(c, x, y, w, 3, P.red, rand);
    fill(c, x, y + 6, w, 6, P.blue, rand);
    fill(c, x, y + 6, w, 1, P.blueDark, rand);
    c.set(x + 1, y + 9, P.blueDark);
  }
  fill(c, ...rightArm.bottom, P.blue, rand);

  // Left arm (32,48): red sleeve, white bandage wrap, red wristband.
  const leftArm = box(32, 48, 4, 12, 4);
  fillBox(c, leftArm, P.skin, rand);
  fill(c, ...leftArm.top, P.red, rand);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = leftArm[face];
    fill(c, x, y, w, 3, P.red, rand);
    fill(c, x, y + 4, w, 2, P.white, rand, 0.03);
    c.set(x + 1, y + 6, P.white);
    fill(c, x, y + 9, w, 2, P.red, rand);
  }

  // Legs (0,16) and (16,48): red trousers with white trim, dark red shoes.
  for (const [u, v] of [[0, 16], [16, 48]]) {
    const leg = box(u, v, 4, 12, 4);
    fillBox(c, leg, P.red, rand);
    for (const face of ['front', 'left', 'right', 'back']) {
      const [x, y, w] = leg[face];
      fill(c, x, y + 5, w, 1, P.white, rand, 0.03);
      fill(c, x, y + 8, w, 1, P.redDark, rand);
      fill(c, x, y + 10, w, 2, P.redDark, rand);
      fill(c, x, y + 10, w, 1, P.white, rand, 0.03);
    }
    fill(c, ...leg.bottom, P.redDark, rand);
  }
  return c;
}

// ---------- Particle: 8x8 soft white spark, tinted per effect ----------
function paintSpark() {
  const c = canvas(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const dx = x + 0.5 - 4;
    const dy = y + 0.5 - 4;
    const r = Math.sqrt(dx * dx + dy * dy) / 4;
    if (r > 1) continue;
    // Keep alpha above ~128 so an alpha-test fallback still shows the mote.
    const alpha = r < 0.5 ? 255 : Math.round(255 - (r - 0.5) * 2 * 110);
    c.set(x, y, [255, 255, 255], alpha);
  }
  return c;
}

// ---------- Pack icon: 128x128, the Dungeons gold on purple with the beacon cage ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const bgTop = hex('#3A1450');
  const bgBottom = hex('#8A1E3C');
  const border = hex('#E8B92E');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : mix(bgTop, bgBottom, y / S));
  }
  // Glow behind the cube.
  for (let y = 4; y < S - 4; y++) for (let x = 4; x < S - 4; x++) {
    const d = Math.hypot(x - 64, y - 64);
    if (d < 50) c.set(x, y, mix(mix(bgTop, bgBottom, y / S), P.magenta, (1 - d / 50) * 0.5));
  }
  // Scale the 16x16 beacon icon up 6x into the middle.
  const icon = paintBeacon();
  const scale = 6;
  const off = (S - 16 * scale) / 2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4;
    if (icon.buf[i + 3] === 0) continue;
    const col = [icon.buf[i], icon.buf[i + 1], icon.buf[i + 2]];
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      c.set(off + x * scale + sx, off + 12 + y * scale + sy, col);
    }
  }
  return c;
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
const write = (rel, canvasOrBuffer) => {
  const file = path.join(rp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canvasOrBuffer.png());
};
write('textures/items/firebrand.png', paintFirebrand());
write('textures/items/corrupted_beacon.png', paintBeacon());
write('textures/items/ender_helmet.png', paintHelmet());
write('textures/items/ender_chestplate.png', paintChestplate());
write('textures/items/ender_leggings.png', paintLeggings());
write('textures/items/ender_boots.png', paintBoots());
write('textures/items/tim_card.png', paintTimCard());
write('textures/models/armor/ender_1.png', paintArmorLayer1());
write('textures/models/armor/ender_2.png', paintArmorLayer2());
write('textures/entity/tim.png', paintTim());
write('textures/particle/spark.png', paintSpark());
const icon = paintPackIcon().png();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote item icons, armor layers, Tim skin, spark texture, and pack icons to', out);
