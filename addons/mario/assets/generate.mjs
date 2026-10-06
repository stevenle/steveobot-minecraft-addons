// Generates the mob models and skins, block and item textures, the suit armor
// layers, the pack icons, and the Bowser's Castle / question-row structures.
// Run from the repo root:  node addons/mario/assets/generate.mjs addons/mario
// It overwrites the generated files under resource_pack/ and behavior_pack/;
// the generated output is what gets committed, this script is for regenerating it.
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
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

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
function shade(col, f) { return col.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))); }

/** Deterministic noise so regenerating gives identical bytes. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const grainRand = rng(0x6a7c);

/** Fills a rectangle with `color`, lightly speckled so it does not look flat. */
function fill(c, x0, y0, w, h, color, grain = 0.06) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = (grainRand() - 0.5) * 2 * grain;
    c.set(x, y, n >= 0 ? mix(color, [255, 255, 255], n) : mix(color, [0, 0, 0], -n));
  }
}

/** Paints character rows onto a canvas at (ox, oy); '.' is left untouched. */
function paintRows(c, rows, legend, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = legend[row[x]];
      if (col) c.set(ox + x, oy + y, col);
    }
  });
}

/** A 16x16 icon from character rows. */
function icon16(rows, legend) {
  if (rows.length !== 16 || rows.some((r) => r.length !== 16)) throw new Error('icon rows must be 16x16');
  const c = canvas(16, 16);
  paintRows(c, rows, legend);
  return c;
}

// ---------- Palette ----------
const P = {
  black: hex('#141414'),
  white: hex('#F6F6F0'),
  // Goomba
  cap: hex('#8E4A1C'),
  capDark: hex('#6A3412'),
  goombaFace: hex('#F0C78E'),
  goombaFeet: hex('#3A2414'),
  // Koopa
  koopaSkin: hex('#F4D23C'),
  koopaSkinDark: hex('#D8B020'),
  shell: hex('#2E9E34'),
  shellDark: hex('#1C7424'),
  shellLight: hex('#5CC85A'),
  belly: hex('#F4E4AA'),
  bellyLine: hex('#D8C07A'),
  shoe: hex('#C0602A'),
  // Bob-omb
  bomb: hex('#24242C'),
  bombLight: hex('#4C4C5A'),
  bombFeet: hex('#F0A020'),
  metal: hex('#B8B8C4'),
  wick: hex('#D2BE90'),
  // Bowser
  bowserSkin: hex('#F0B830'),
  bowserSkinDark: hex('#C88E1C'),
  snout: hex('#F4D88E'),
  hair: hex('#E0401C'),
  horn: hex('#F2E8CC'),
  cuff: hex('#24201C'),
  rim: hex('#F2F0E2'),
  eyeRed: hex('#C81E1E'),
  // Fire
  fireRed: hex('#E0301C'),
  fireOrange: hex('#FF7A1A'),
  fireYellow: hex('#FFD84A'),
  // Blocks
  qYellow: hex('#F6A81C'),
  qLight: hex('#FFD060'),
  qDark: hex('#A85A10'),
  qOutline: hex('#4A2408'),
  sealDark: hex('#2A1414'),
  sealMid: hex('#4A1E1A'),
  // Suits
  squirrel: hex('#B06A2C'),
  squirrelDark: hex('#7E4618'),
  squirrelBelly: hex('#F2D8A8'),
  frog: hex('#3CAE48'),
  frogDark: hex('#23802E'),
  frogBelly: hex('#E8F0A0'),
  frogSpot: hex('#F4D23C'),
};

// ---------- Entity models ----------
// Model space: +Y up, the face toward -Z (north). Units are 1/16 block.
// Every cube face gets its own region of a packed texture atlas, painted by
// `paint` (a color, or a function per face). Faces: north is the front.
//
// cube: { bone, origin, size, paint: color | { all, north, south, east, west, up, down } }
// A face painter is (c, x, y, w, h) => void, drawing into that face's region.

function faceSizes([w, h, d]) {
  return { north: [w, h], south: [w, h], east: [d, h], west: [d, h], up: [w, d], down: [w, d] };
}

function buildModel({ id, bones, cubes, bounds = [2, 2] }) {
  // Shelf-pack every face, tallest first.
  const faces = [];
  cubes.forEach((cube, ci) => {
    for (const [face, [w, h]] of Object.entries(faceSizes(cube.size))) faces.push({ ci, face, w, h });
  });
  const order = [...faces].sort((a, b) => b.h - a.h || b.w - a.w);
  let texW = 32;
  let placed;
  for (;;) {
    placed = new Map();
    let x = 0, y = 0, shelf = 0, ok = true;
    for (const f of order) {
      if (f.w > texW) { ok = false; break; }
      if (x + f.w > texW) { x = 0; y += shelf; shelf = 0; }
      placed.set(f, [x, y]);
      x += f.w;
      shelf = Math.max(shelf, f.h);
    }
    const usedH = y + shelf;
    if (ok && usedH <= texW) break;
    texW *= 2;
  }
  const texH = texW;
  const c = canvas(texW, texH);

  const uvByCube = cubes.map(() => ({}));
  for (const f of faces) {
    const [x, y] = placed.get(f);
    uvByCube[f.ci][f.face] = { uv: [x, y], uv_size: [f.w, f.h] };
    const cube = cubes[f.ci];
    const p = cube.paint;
    const painter = Array.isArray(p) || typeof p === 'function' ? p : (p[f.face] ?? p.all);
    if (typeof painter === 'function') painter(c, x, y, f.w, f.h);
    else fill(c, x, y, f.w, f.h, painter);
  }

  const geo = {
    format_version: '1.16.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: `geometry.steveo_${id}`,
          texture_width: texW,
          texture_height: texH,
          visible_bounds_width: bounds[0],
          visible_bounds_height: bounds[1],
          visible_bounds_offset: [0, bounds[1] / 2, 0],
        },
        bones: bones.map((b) => ({
          name: b.name,
          ...(b.parent ? { parent: b.parent } : {}),
          pivot: b.pivot,
          ...(b.rotation ? { rotation: b.rotation } : {}),
          cubes: cubes
            .map((cube, i) => ({ cube, i }))
            .filter(({ cube }) => cube.bone === b.name)
            .map(({ cube, i }) => ({
              origin: cube.origin,
              size: cube.size,
              ...(cube.inflate ? { inflate: cube.inflate } : {}),
              uv: uvByCube[i],
            })),
        })),
      },
    ],
  };
  write(`resource_pack/models/entity/${id}.geo.json`, json(geo));
  write(`resource_pack/textures/entity/${id}.png`, c.png());
  console.log(`${id}: ${cubes.length} cubes, ${texW}x${texH} texture`);
}

/** A face filled with `base` and a 1px band of `edge` along its top and bottom rows. */
const banded = (base, edge) => (c, x, y, w, h) => {
  fill(c, x, y, w, h, base);
  fill(c, x, y, w, 1, edge);
  fill(c, x, y + h - 1, w, 1, edge);
};

/** Turtle-shell plates: a darker grid over the base green. */
const shellPlates = (c, x, y, w, h) => {
  fill(c, x, y, w, h, P.shell);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const onLine = xx % 4 === 0 || (yy + (Math.floor(xx / 4) % 2) * 2) % 4 === 0;
    if (onLine) c.set(x + xx, y + yy, P.shellDark);
    else if (xx % 4 === 1 && yy % 4 === 1) c.set(x + xx, y + yy, P.shellLight);
  }
};

// --- Goomba ---
buildModel({
  id: 'goomba',
  bounds: [2, 2],
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 2, 0] },
    { name: 'head', parent: 'body', pivot: [0, 6, 0] },
    { name: 'foot_l', parent: 'root', pivot: [-3, 2, 0] },
    { name: 'foot_r', parent: 'root', pivot: [3, 2, 0] },
  ],
  cubes: [
    { bone: 'foot_l', origin: [-5, 0, -3], size: [4, 2, 6], paint: P.goombaFeet },
    { bone: 'foot_r', origin: [1, 0, -3], size: [4, 2, 6], paint: P.goombaFeet },
    { bone: 'body', origin: [-3, 2, -3], size: [6, 4, 6], paint: P.goombaFace },
    {
      bone: 'head', origin: [-6, 5, -6], size: [12, 8, 12],
      paint: {
        all: P.cap,
        down: P.goombaFace,
        // The angry face: slanted brows, white eyes with inner pupils, a pale
        // mouth band with two fangs.
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.cap);
          fill(c, x + 1, y + h - 3, w - 2, 3, P.goombaFace);
          paintRows(c, [
            '.KK......KK.',
            '..KKK..KKK..',
            '..WWK..KWW..',
            '..WWK..KWW..',
            '..WWK..KWW..',
            '...W....W...',
            '...W....W...',
          ], { K: P.black, W: P.white }, x, y + 1);
        },
      },
    },
    { bone: 'head', origin: [-5, 13, -5], size: [10, 1, 10], paint: P.capDark },
  ],
});

// --- Koopa Troopa ---
buildModel({
  id: 'koopa_troopa',
  bounds: [2, 2.5],
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-2, 4, 0] },
    { name: 'leg_r', parent: 'root', pivot: [2, 4, 0] },
    { name: 'body', parent: 'root', pivot: [0, 4, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-4, 11, 0] },
    { name: 'arm_r', parent: 'body', pivot: [4, 11, 0] },
    { name: 'head', parent: 'body', pivot: [0, 12, -1] },
    // Shown instead of everything else while the koopa hides in its shell.
    { name: 'shell_only', parent: 'root', pivot: [0, 0, 0] },
  ],
  cubes: [
    { bone: 'leg_l', origin: [-3, 1, -2], size: [2, 3, 3], paint: P.koopaSkin },
    { bone: 'leg_l', origin: [-3.5, 0, -3], size: [3, 2, 4], paint: P.shoe },
    { bone: 'leg_r', origin: [1, 1, -2], size: [2, 3, 3], paint: P.koopaSkin },
    { bone: 'leg_r', origin: [0.5, 0, -3], size: [3, 2, 4], paint: P.shoe },
    {
      bone: 'body', origin: [-3, 4, -2], size: [6, 8, 4],
      paint: {
        all: P.belly,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.belly);
          for (let yy = 2; yy < h; yy += 3) fill(c, x, y + yy, w, 1, P.bellyLine);
        },
      },
    },
    {
      bone: 'body', origin: [-4, 4, 1], size: [8, 9, 5],
      paint: { all: banded(P.shell, P.rim), south: shellPlates, up: shellPlates },
    },
    { bone: 'arm_l', origin: [-5, 6, -1], size: [2, 6, 2], paint: P.koopaSkin },
    { bone: 'arm_r', origin: [3, 6, -1], size: [2, 6, 2], paint: P.koopaSkin },
    {
      bone: 'head', origin: [-2.5, 12, -4], size: [5, 5, 5],
      paint: {
        all: P.koopaSkin,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.koopaSkin);
          paintRows(c, ['WW.WW', 'WK.KW', 'WK.KW'], { W: P.white, K: P.black }, x, y);
        },
      },
    },
    { bone: 'head', origin: [-1.5, 12, -6], size: [3, 2, 2], paint: P.koopaSkinDark },
    {
      bone: 'shell_only', origin: [-4, 0, -5], size: [8, 5, 10],
      paint: { all: banded(P.shell, P.rim), up: shellPlates, down: P.belly },
    },
  ],
});

// --- Bob-omb ---
const bombBody = (c, x, y, w, h) => {
  fill(c, x, y, w, h, P.bomb);
  fill(c, x + 1, y + 1, 2, 2, P.bombLight);
};
buildModel({
  id: 'bomb_guy',
  bounds: [2, 2],
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 2, 0] },
    { name: 'key', parent: 'body', pivot: [0, 7, 7] },
    { name: 'foot_l', parent: 'root', pivot: [-2.5, 2, 0] },
    { name: 'foot_r', parent: 'root', pivot: [2.5, 2, 0] },
  ],
  cubes: [
    { bone: 'body', origin: [-5, 2, -5], size: [10, 10, 10], paint: bombBody },
    { bone: 'body', origin: [-6, 3, -4], size: [12, 8, 8], paint: bombBody },
    {
      bone: 'body', origin: [-4, 3, -6], size: [8, 8, 12],
      paint: {
        all: bombBody,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.bomb);
          paintRows(c, ['.WW..WW.', '.WK..KW.', '.WK..KW.', '.WW..WW.'], { W: P.white, K: P.black }, x, y + 1);
        },
      },
    },
    { bone: 'body', origin: [-4, 12, -4], size: [8, 1, 8], paint: P.bomb },
    { bone: 'body', origin: [-1.5, 13, -1.5], size: [3, 1, 3], paint: P.metal },
    { bone: 'body', origin: [-0.5, 14, -0.5], size: [1, 2, 1], paint: P.wick },
    { bone: 'key', origin: [-0.5, 6.5, 6], size: [1, 1, 2], paint: P.metal },
    { bone: 'key', origin: [-3, 6.5, 8], size: [6, 1, 1], paint: P.metal },
    { bone: 'key', origin: [-5, 4.5, 8], size: [2, 5, 1], paint: P.metal },
    { bone: 'key', origin: [3, 4.5, 8], size: [2, 5, 1], paint: P.metal },
    { bone: 'foot_l', origin: [-4.5, 0, -3], size: [4, 2, 5], paint: P.bombFeet },
    { bone: 'foot_r', origin: [0.5, 0, -3], size: [4, 2, 5], paint: P.bombFeet },
  ],
});

// --- Bowser ---
const belly = (c, x, y, w, h) => {
  fill(c, x, y, w, h, P.snout);
  for (let yy = 3; yy < h; yy += 4) fill(c, x, y + yy, w, 1, P.bowserSkinDark);
};
const cuff = (c, x, y, w, h) => {
  fill(c, x, y, w, h, P.cuff);
  for (let xx = 1; xx < w; xx += 3) c.set(x + xx, y + 1, P.rim);
};
const spikes = [];
for (const sx of [-7, -1.5, 4]) for (const sy of [14, 20, 25]) {
  spikes.push({ bone: 'body', origin: [sx, sy, 12], size: [3, 3, 3], paint: P.rim });
  spikes.push({ bone: 'body', origin: [sx + 1, sy + 1, 15], size: [1, 1, 2], paint: P.horn });
}
buildModel({
  id: 'bowser',
  bounds: [5, 4],
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-5, 12, 0] },
    { name: 'leg_r', parent: 'root', pivot: [5, 12, 0] },
    { name: 'body', parent: 'root', pivot: [0, 12, 0] },
    { name: 'tail', parent: 'body', pivot: [0, 14, 10] },
    { name: 'arm_l', parent: 'body', pivot: [-11, 25, -1] },
    { name: 'arm_r', parent: 'body', pivot: [11, 25, -1] },
    { name: 'head', parent: 'body', pivot: [0, 30, -4] },
  ],
  cubes: [
    // Legs and clawed feet.
    { bone: 'leg_l', origin: [-9, 4, -4], size: [7, 9, 8], paint: P.bowserSkin },
    { bone: 'leg_l', origin: [-9.5, 0, -6], size: [8, 4, 10], paint: P.bowserSkinDark },
    { bone: 'leg_l', origin: [-9, 0, -7], size: [2, 2, 1], paint: P.rim },
    { bone: 'leg_l', origin: [-5, 0, -7], size: [2, 2, 1], paint: P.rim },
    { bone: 'leg_r', origin: [2, 4, -4], size: [7, 9, 8], paint: P.bowserSkin },
    { bone: 'leg_r', origin: [1.5, 0, -6], size: [8, 4, 10], paint: P.bowserSkinDark },
    { bone: 'leg_r', origin: [3, 0, -7], size: [2, 2, 1], paint: P.rim },
    { bone: 'leg_r', origin: [7, 0, -7], size: [2, 2, 1], paint: P.rim },
    // Belly and spiked shell.
    { bone: 'body', origin: [-8, 12, -6], size: [16, 16, 10], paint: { all: P.bowserSkin, north: belly } },
    {
      bone: 'body', origin: [-10, 11, 2], size: [20, 18, 10],
      paint: { all: banded(P.shell, P.rim), south: shellPlates, up: shellPlates },
    },
    { bone: 'body', origin: [-11, 11, 1], size: [22, 2, 12], paint: P.rim },
    ...spikes,
    { bone: 'tail', origin: [-2.5, 12, 10], size: [5, 5, 9], paint: P.bowserSkin },
    { bone: 'tail', origin: [-1, 17, 14], size: [2, 2, 2], paint: P.rim },
    // Arms with spiked black cuffs.
    { bone: 'arm_l', origin: [-15, 14, -4], size: [5, 12, 6], paint: P.bowserSkin },
    { bone: 'arm_l', origin: [-15.5, 21, -4.5], size: [6, 3, 7], paint: cuff },
    { bone: 'arm_l', origin: [-16.5, 22, -1.5], size: [1, 1, 1], paint: P.rim },
    { bone: 'arm_l', origin: [-15, 12, -4], size: [5, 2, 6], paint: P.bowserSkinDark },
    { bone: 'arm_r', origin: [10, 14, -4], size: [5, 12, 6], paint: P.bowserSkin },
    { bone: 'arm_r', origin: [9.5, 21, -4.5], size: [6, 3, 7], paint: cuff },
    { bone: 'arm_r', origin: [15.5, 22, -1.5], size: [1, 1, 1], paint: P.rim },
    { bone: 'arm_r', origin: [10, 12, -4], size: [5, 2, 6], paint: P.bowserSkinDark },
    // Head: skull with brows and eyes, snout with nostrils and fangs, horns, red hair.
    {
      bone: 'head', origin: [-7, 28, -11], size: [14, 12, 13],
      paint: {
        all: P.bowserSkin,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.bowserSkin);
          paintRows(c, [
            '.RRRR....RRRR.',
            '..RRRR..RRRR..',
            '..WWWW..WWWW..',
            '..WWRK..KRWW..',
            '..WWRK..KRWW..',
          ], { R: P.hair, W: P.white, K: P.black }, x, y + 1);
        },
      },
    },
    {
      bone: 'head', origin: [-6, 28, -17], size: [12, 6, 6],
      paint: {
        all: P.snout,
        up: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.snout);
          fill(c, x + 3, y + 1, 2, 1, P.bowserSkinDark);
          fill(c, x + w - 5, y + 1, 2, 1, P.bowserSkinDark);
        },
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.snout);
          fill(c, x + 1, y + h - 2, w - 2, 1, P.eyeRed);
        },
      },
    },
    { bone: 'head', origin: [-5, 26, -16], size: [1, 2, 1], paint: P.white },
    { bone: 'head', origin: [4, 26, -16], size: [1, 2, 1], paint: P.white },
    { bone: 'head', origin: [-7, 40, -6], size: [2, 5, 2], paint: P.horn },
    { bone: 'head', origin: [5, 40, -6], size: [2, 5, 2], paint: P.horn },
    { bone: 'head', origin: [-4, 40, -4], size: [8, 3, 8], paint: P.hair },
    { bone: 'head', origin: [-6, 30, 2], size: [12, 9, 2], paint: P.hair },
  ],
});

// --- Fireball ---
buildModel({
  id: 'fireball',
  bounds: [1, 1],
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'ball', parent: 'root', pivot: [0, 2, 0] },
  ],
  cubes: [
    {
      bone: 'ball', origin: [-2, 0, -2], size: [4, 4, 4],
      paint: (c, x, y, w, h) => {
        fill(c, x, y, w, h, P.fireOrange, 0.15);
        fill(c, x + 1, y + 1, w - 2, h - 2, P.fireYellow, 0.1);
        c.set(x, y, P.fireRed); c.set(x + w - 1, y + h - 1, P.fireRed);
      },
    },
    { bone: 'ball', origin: [-1, 1, -3], size: [2, 2, 6], paint: P.fireRed },
    { bone: 'ball', origin: [-3, 1, -1], size: [6, 2, 2], paint: P.fireRed },
  ],
});

// ---------- Block textures (16x16) ----------
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

function paintQuestionBlock(c, scale = 1) {
  const px = (x, y, col) => fill(c, x * scale, y * scale, scale, scale, col, 0.03);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let col = P.qYellow;
    if (x === 0 || y === 0) col = P.qLight;
    if (x === 15 || y === 15) col = P.qDark;
    px(x, y, col);
  }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(x, y, P.qDark);
  QUESTION_GLYPH.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== 'W') continue;
      px(5 + x + 1, 3 + y + 1, P.qDark);
    }
  });
  QUESTION_GLYPH.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'W') px(5 + x, 3 + y, P.white);
  });
}
{
  const c = canvas(16, 16);
  paintQuestionBlock(c);
  write('resource_pack/textures/blocks/question_block.png', c.png());
}
{
  // Bowser Seal: dark nether stone with a spiked orange ring and a glowing core.
  const c = canvas(16, 16);
  fill(c, 0, 0, 16, 16, P.sealDark, 0.12);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const a = Math.atan2(y - 7.5, x - 7.5);
    const spike = 5.2 + Math.max(0, Math.cos(a * 6)) * 1.8;
    if (d < 2) c.set(x, y, P.fireYellow);
    else if (d < 3.2) c.set(x, y, P.fireOrange);
    else if (d >= 4.2 && d < spike) c.set(x, y, d < 5 ? P.fireRed : P.fireOrange);
    else if (x === 0 || y === 0 || x === 15 || y === 15) c.set(x, y, P.sealMid);
  }
  write('resource_pack/textures/blocks/bowser_seal.png', c.png());
}

// ---------- Item icons (16x16) ----------
write('resource_pack/textures/items/fire_flower.png', icon16([
  '................',
  '.....DDDDDD.....',
  '...DDRRRRRRDD...',
  '..DRROOOOOORRD..',
  '..DROYYYYYYORD..',
  '.DROYWWWWWWYORD.',
  '.DROYWKWWKWYORD.',
  '.DROYWKWWKWYORD.',
  '..DROYWWWWYORD..',
  '..DRROYYYYORRD..',
  '...DDRRRRRRDD...',
  '.....DDGGDD.....',
  '..gg...GG...gg..',
  '.gGGg..GG..gGGg.',
  '..gGGGgGGgGGGg..',
  '....ggGGGGgg....',
], {
  D: shade(P.fireRed, 0.6), R: P.fireRed, O: P.fireOrange, Y: P.fireYellow,
  W: P.white, K: P.black, G: hex('#3CB44A'), g: hex('#1E7A2A'),
}).png());

write('resource_pack/textures/items/squirrel_suit.png', icon16([
  '................',
  '................',
  '..XXXX....XXXX..',
  '.XAAAAX..XAAAAX.',
  'XAAAAAAXXAAAAAAX',
  'XAAAAAAAAAAAAAAX',
  'XWAAAABBBBAAAAWX',
  'XWWAAABBBBAAAWWX',
  '.XWWAABBBBAAWWX.',
  '..XWWABBBBAWWX..',
  '...XWABBBBAWX...',
  '....XABBBBAX....',
  '....XAABBAAX....',
  '....XAAAAAAX....',
  '....XXXXXXXX....',
  '................',
], { X: shade(P.squirrelDark, 0.6), A: P.squirrel, B: P.squirrelBelly, W: P.squirrelDark }).png());

write('resource_pack/textures/items/frog_suit.png', icon16([
  '................',
  '................',
  '..XXXX....XXXX..',
  '.XAAAAX..XAAAAX.',
  '.XAASAAXXAASAAX.',
  '.XAAAAAAAAAAAAX.',
  '..XXAABBBBAAXX..',
  '....XABBBBAX....',
  '....XSBBBBAX....',
  '....XABBBBSX....',
  '....XABBBBAX....',
  '....XAABBAAX....',
  '....XASAAAAX....',
  '....XAAAASAX....',
  '....XXXXXXXX....',
  '................',
], { X: shade(P.frogDark, 0.6), A: P.frog, B: P.frogBelly, S: P.frogSpot }).png());

// ---------- Suit armor layers (64x32, the vanilla humanoid armor layout) ----------
// Regions: body at (16,16) 8x12x4; arm at (40,16) 4x12x4. Each box's faces
// are laid out [side][front][side][back] under [top][bottom].
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

function paintSuit({ main, dark, bellyCol, spots, flaps }) {
  const c = canvas(64, 32);
  const body = box(16, 16, 8, 12, 4);
  for (const r of Object.values(body)) fill(c, ...r, main);
  {
    const [x, y] = body.front;
    fill(c, x + 2, y + 1, 4, 10, bellyCol);
    fill(c, x, y + 11, 8, 1, dark);
  }
  const arm = box(40, 16, 4, 12, 4);
  for (const r of Object.values(arm)) fill(c, ...r, main);
  for (const face of ['front', 'left', 'right', 'back']) {
    const [x, y, w] = arm[face];
    fill(c, x, y + 10, w, 2, dark);
  }
  if (flaps) {
    // The gliding membrane: darker panels under the arms and down the body sides.
    for (const face of ['left', 'right']) {
      const [x, y, w, h] = body[face];
      fill(c, x, y + 1, w, h - 2, dark);
    }
    for (const face of ['left', 'right']) {
      const [x, y, w, h] = arm[face];
      fill(c, x, y + 2, w, h - 4, dark);
    }
  }
  if (spots) {
    const [bx, by] = body.back;
    for (const [sx, sy] of [[1, 2], [5, 4], [2, 8], [6, 9]]) fill(c, bx + sx, by + sy, 2, 2, spots);
    for (const face of ['front', 'back']) {
      const [x, y] = arm[face];
      fill(c, x + 1, y + 3, 2, 2, spots);
    }
  }
  return c;
}
write('resource_pack/textures/models/armor/squirrel_suit_1.png', paintSuit({
  main: P.squirrel, dark: P.squirrelDark, bellyCol: P.squirrelBelly, flaps: true,
}).png());
write('resource_pack/textures/models/armor/frog_suit_1.png', paintSuit({
  main: P.frog, dark: P.frogDark, bellyCol: P.frogBelly, spots: P.frogSpot,
}).png());

// ---------- Pack icons (128x128): a question block, centered with a margin ----------
// The game rounds and crops icon corners, so the block keeps a 24px margin.
const ICON_SCALE = 5;
function packIcon(label) {
  const c = canvas(128, 128);
  for (let y = 0; y < 128; y++) {
    const col = mix(hex('#5C94FC'), hex('#A4C8FF'), y / 127);
    for (let x = 0; x < 128; x++) c.set(x, y, col);
  }
  const q = canvas(16, 16);
  paintQuestionBlock(q);
  const size = 16 * ICON_SCALE;
  const offset = (128 - size) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (Math.floor(y / ICON_SCALE) * 16 + Math.floor(x / ICON_SCALE)) * 4;
    c.set(offset + x, offset + y, [q.buf[i], q.buf[i + 1], q.buf[i + 2]]);
  }
  const tag = label === 'BP' ? hex('#F2C14E') : hex('#5BE8C7');
  for (let y = 118; y < 122; y++) for (let x = 6; x < (label === 'BP' ? 14 : 22); x++) c.set(x, y, tag);
  return c.png();
}
write('behavior_pack/pack_icon.png', packIcon('BP'));
write('resource_pack/pack_icon.png', packIcon('RP'));

// ---------- NBT (Bedrock: little-endian, uncompressed) ----------
const T = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10 };
const tag = {
  byte: (v) => ({ t: T.byte, v }),
  int: (v) => ({ t: T.int, v }),
  string: (v) => ({ t: T.string, v }),
  list: (of, v) => ({ t: T.list, of, v }),
  compound: (v) => ({ t: T.compound, v }),
};

function nbtWriter() {
  const parts = [];
  const w = {
    u8: (v) => { const b = Buffer.alloc(1); b.writeUInt8(v); parts.push(b); },
    i16: (v) => { const b = Buffer.alloc(2); b.writeInt16LE(v); parts.push(b); },
    i32: (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); },
    str: (s) => { const d = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16LE(d.length); parts.push(l, d); },
    payload(node) {
      switch (node.t) {
        case T.byte: w.u8(node.v & 0xff); break;
        case T.short: w.i16(node.v); break;
        case T.int: w.i32(node.v); break;
        case T.string: w.str(node.v); break;
        case T.list:
          w.u8(node.of);
          w.i32(node.v.length);
          for (const item of node.v) w.payload(item);
          break;
        case T.compound:
          for (const [name, child] of Object.entries(node.v)) w.named(name, child);
          w.u8(T.end);
          break;
        default: throw new Error(`unsupported tag ${node.t}`);
      }
    },
    named(name, node) { w.u8(node.t); w.str(name); w.payload(node); },
    bytes: () => Buffer.concat(parts),
  };
  return w;
}

const BLOCK_VERSION = 18168865;
const AIR = 'minecraft:air';
const withStates = (name, states) => ({ name, states });

/** Serializes a [x][y][z] grid of block names (or {name, states}) to an .mcstructure. */
function writeStructure(rel, grid) {
  const SX = grid.length, SY = grid[0].length, SZ = grid[0][0].length;
  const paletteKeys = new Map();
  const palette = [];
  const indices = [];
  // Index order is x, then y, then z (z fastest).
  for (let x = 0; x < SX; x++) for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) {
    const block = grid[x][y][z];
    const entry = typeof block === 'string' ? { name: block, states: {} } : block;
    const key = JSON.stringify(entry);
    let index = paletteKeys.get(key);
    if (index === undefined) {
      index = palette.length;
      paletteKeys.set(key, index);
      palette.push(entry);
    }
    indices.push(tag.int(index));
  }
  const root = tag.compound({
    format_version: tag.int(1),
    size: tag.list(T.int, [tag.int(SX), tag.int(SY), tag.int(SZ)]),
    structure: tag.compound({
      block_indices: tag.list(T.list, [tag.list(T.int, indices), tag.list(T.int, indices.map(() => tag.int(-1)))]),
      entities: tag.list(T.compound, []),
      palette: tag.compound({
        default: tag.compound({
          block_palette: tag.list(
            T.compound,
            palette.map((p) => tag.compound({ name: tag.string(p.name), states: tag.compound(p.states), version: tag.int(BLOCK_VERSION) })),
          ),
          block_position_data: tag.compound({}),
        }),
      }),
    }),
    structure_world_origin: tag.list(T.int, [tag.int(0), tag.int(0), tag.int(0)]),
  });
  const nbt = nbtWriter();
  nbt.named('', root);
  write(rel, nbt.bytes());
  console.log(`${rel}: ${SX}x${SY}x${SZ}, ${palette.length} palette entries`);
}

function makeGrid(SX, SY, SZ) {
  return Array.from({ length: SX }, () => Array.from({ length: SY }, () => new Array(SZ).fill(AIR)));
}

// ---------- Bowser's Castle ----------
// Structure-local coordinates: x 0..22 across, z 0..30 front (gate) to back
// (throne), y 0..19 up. Layers 0-4 are a buried foundation; the feature rule
// plants the structure four blocks below the surface so the floor (y 4) sits
// at the terrain. Walls run y 5..13, the roof is y 14, crenellations y 15,
// corner towers rise to y 18 with crenellations at y 19.
//
// Inside: an entrance hall with lava pools either side of a nether-brick path
// and a row of question blocks overhead, then an inner wall, then the throne
// room with lava channels down both sides, the Bowser Seal in the middle of
// the floor, and a blackstone-and-gold throne at the back. Bowser rises from
// the seal when a player comes near (src/bowser.ts).
{
  const SX = 23, SY = 20, SZ = 31;
  const FLOOR = 4, WALL_TOP = 13, ROOF = 14;
  const CX = 11;
  const grid = makeGrid(SX, SY, SZ);
  const rnd = rng(0xb0505e);
  const at = (x, y, z, block) => { grid[x][y][z] = block; };
  const brick = () => {
    const n = rnd();
    return n < 0.1 ? 'minecraft:cracked_stone_bricks' : n < 0.18 ? 'minecraft:mossy_stone_bricks' : 'minecraft:stone_bricks';
  };
  const isEdge = (x, z) => x === 0 || x === SX - 1 || z === 0 || z === SZ - 1;
  const inTower = (x, z) => (x <= 4 || x >= SX - 5) && (z <= 4 || z >= SZ - 5);
  const lava = withStates('minecraft:lava', { liquid_depth: tag.int(0) });

  // Foundation and floor.
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    for (let y = 0; y < FLOOR; y++) at(x, y, z, 'minecraft:cobblestone');
    at(x, FLOOR, z, 'minecraft:polished_blackstone_bricks');
  }
  // Outer walls and solid corner towers.
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    if (!isEdge(x, z) && !inTower(x, z)) continue;
    const top = inTower(x, z) ? ROOF + 4 : WALL_TOP;
    for (let y = FLOOR + 1; y <= top; y++) at(x, y, z, brick());
  }
  // Roof over the whole keep, lit from below with shroomlights.
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    at(x, ROOF, z, inTower(x, z) ? brick() : (x % 5 === 1 && z % 5 === 2) ? 'minecraft:shroomlight' : brick());
  }
  // Crenellations on the roof edge and on top of each tower.
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    if (isEdge(x, z) && !inTower(x, z) && (x + z) % 2 === 0) at(x, ROOF + 1, z, brick());
    if (inTower(x, z)) {
      const tx = x <= 4 ? x : x - (SX - 5);
      const tz = z <= 4 ? z : z - (SZ - 5);
      const towerEdge = tx === 0 || tx === 4 || tz === 0 || tz === 4;
      if (towerEdge && (tx + tz) % 2 === 0) at(x, ROOF + 5, z, brick());
    }
  }
  // Red nether-brick trim band around the outside.
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    if (isEdge(x, z) && !inTower(x, z)) at(x, WALL_TOP - 1, z, 'minecraft:red_nether_brick');
  }
  // Barred windows down both long sides.
  for (const z of [8, 12, 18, 22]) for (const y of [8, 9]) {
    at(0, y, z, 'minecraft:iron_bars');
    at(SX - 1, y, z, 'minecraft:iron_bars');
  }

  // The gate: a 5-wide, 5-tall opening in the front wall, with a chiseled frame.
  for (let x = CX - 2; x <= CX + 2; x++) for (let y = FLOOR + 1; y <= FLOOR + 5; y++) at(x, y, 0, AIR);
  for (let y = FLOOR + 1; y <= FLOOR + 6; y++) { at(CX - 3, y, 0, 'minecraft:chiseled_stone_bricks'); at(CX + 3, y, 0, 'minecraft:chiseled_stone_bricks'); }
  for (let x = CX - 3; x <= CX + 3; x++) at(x, FLOOR + 6, 0, 'minecraft:chiseled_stone_bricks');

  // Entrance hall: a nether-brick path between two lava pools.
  for (let z = 1; z <= 12; z++) for (let x = CX - 2; x <= CX + 2; x++) at(x, FLOOR, z, 'minecraft:nether_brick');
  for (let z = 4; z <= 10; z++) {
    for (let x = 2; x <= 6; x++) at(x, FLOOR, z, lava);
    for (let x = SX - 7; x <= SX - 3; x++) at(x, FLOOR, z, lava);
  }
  // A row of question blocks and bricks over the path.
  for (const [i, x] of [CX - 2, CX - 1, CX, CX + 1, CX + 2].entries()) {
    at(x, FLOOR + 4, 7, i % 2 === 1 ? 'steveo:question_block' : 'minecraft:brick_block');
  }

  // Inner wall between the hall and the throne room, with a doorway.
  for (let x = 1; x < SX - 1; x++) for (let y = FLOOR + 1; y < ROOF; y++) at(x, y, 13, brick());
  for (let x = CX - 1; x <= CX + 1; x++) for (let y = FLOOR + 1; y <= FLOOR + 4; y++) at(x, y, 13, AIR);
  at(CX - 2, FLOOR + 3, 13, 'minecraft:shroomlight');
  at(CX + 2, FLOOR + 3, 13, 'minecraft:shroomlight');

  // Throne room: red carpet of red nether brick, lava channels along the walls.
  for (let z = 14; z <= SZ - 2; z++) {
    for (let x = CX - 1; x <= CX + 1; x++) at(x, FLOOR, z, 'minecraft:red_nether_brick');
    if (z <= SZ - 6) {
      for (const x of [2, 3]) at(x, FLOOR, z, lava);
      for (const x of [SX - 4, SX - 3]) at(x, FLOOR, z, lava);
    }
  }
  // The seal Bowser rises from.
  at(CX, FLOOR, 20, 'steveo:bowser_seal');
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) at(CX + dx, FLOOR, 20 + dz, 'minecraft:magma');
  // Throne: blackstone seat, gold armrests and a tall gold-topped back.
  const throneZ = SZ - 3;
  for (let x = CX - 2; x <= CX + 2; x++) at(x, FLOOR + 1, throneZ, 'minecraft:polished_blackstone_bricks');
  for (let x = CX - 2; x <= CX + 2; x++) for (let y = FLOOR + 1; y <= FLOOR + 6; y++) at(x, y, throneZ + 1, 'minecraft:polished_blackstone_bricks');
  for (let x = CX - 2; x <= CX + 2; x++) at(x, FLOOR + 7, throneZ + 1, 'minecraft:gold_block');
  at(CX - 2, FLOOR + 2, throneZ, 'minecraft:gold_block');
  at(CX + 2, FLOOR + 2, throneZ, 'minecraft:gold_block');
  // Torches of fire: shroomlights on pillars in the throne room.
  for (const z of [16, 24]) for (const x of [5, SX - 6]) {
    for (let y = FLOOR + 1; y <= FLOOR + 3; y++) at(x, y, z, 'minecraft:polished_blackstone_bricks');
    at(x, FLOOR + 4, z, 'minecraft:shroomlight');
  }

  writeStructure('behavior_pack/structures/steveo/bowser_castle.mcstructure', grid);
}

// ---------- Question-block row ----------
// Brick, ?, brick, ?, brick, floating in the air. The feature rule places it
// four blocks above the terrain.
{
  const grid = makeGrid(5, 1, 1);
  ['minecraft:brick_block', 'steveo:question_block', 'minecraft:brick_block', 'steveo:question_block', 'minecraft:brick_block']
    .forEach((b, x) => { grid[x][0][0] = b; });
  writeStructure('behavior_pack/structures/steveo/question_row.mcstructure', grid);
}

// ---------- Mario Kart ----------
// Appended last so its draws from the shared grain RNG do not shift the bytes
// of anything generated above.
{
  const kartRed = hex('#D8201C');
  const kartRedDark = hex('#9E1410');
  const tire = hex('#1C1C1C');
  const hub = hex('#D8D8DC');
  const seat = hex('#2A3A8E');
  const engine = hex('#7C7C86');

  /** Tire tread on the rolling faces, a white hub on the outer and inner faces. */
  const wheelSide = (c, x, y, w, h) => {
    fill(c, x, y, w, h, tire, 0.04);
    fill(c, x + 1, y + 1, w - 2, h - 2, hub, 0.03);
    c.set(x + Math.floor(w / 2), y + Math.floor(h / 2), tire);
  };
  const tread = (c, x, y, w, h) => {
    fill(c, x, y, w, h, tire, 0.04);
    for (let yy = 0; yy < h; yy += 2) fill(c, x, y + yy, w, 1, shade(tire, 1.8), 0);
  };
  const wheel = { all: tread, east: wheelSide, west: wheelSide };
  /** The Mario emblem: a white disc with a red M, on the nose. */
  const emblem = (c, x, y, w, h) => {
    fill(c, x, y, w, h, kartRed);
    const cx = x + Math.floor(w / 2) - 3, cy = y + Math.floor(h / 2) - 3;
    paintRows(c, [
      '.WWWW.',
      'WRWWRW',
      'WRRRRW',
      'WRWWRW',
      'WRWWRW',
      '.WWWW.',
    ], { W: P.white, R: kartRed }, cx, cy);
  };

  buildModel({
    id: 'kart',
    bounds: [3, 2],
    bones: [
      { name: 'root', pivot: [0, 0, 0] },
      { name: 'body', parent: 'root', pivot: [0, 3, 0] },
      { name: 'steering', parent: 'body', pivot: [0, 8, -6], rotation: [-30, 0, 0] },
      { name: 'wheel_fl', parent: 'root', pivot: [-7.5, 2.5, -7.5] },
      { name: 'wheel_fr', parent: 'root', pivot: [7.5, 2.5, -7.5] },
      { name: 'wheel_bl', parent: 'root', pivot: [-7.5, 3, 6] },
      { name: 'wheel_br', parent: 'root', pivot: [7.5, 3, 6] },
    ],
    cubes: [
      // Chassis and bumpers.
      { bone: 'body', origin: [-6, 2, -10], size: [12, 4, 19], paint: { all: banded(kartRed, kartRedDark), down: tire } },
      { bone: 'body', origin: [-7, 2, -12], size: [14, 2, 2], paint: tire },
      { bone: 'body', origin: [-5, 6, -10], size: [10, 2, 6], paint: { all: kartRed, up: emblem, north: emblem } },
      // Seat.
      { bone: 'body', origin: [-4, 6, -1], size: [8, 2, 5], paint: seat },
      { bone: 'body', origin: [-4, 6, 4], size: [8, 8, 2], paint: { all: seat, south: kartRed } },
      // Engine and twin exhausts.
      { bone: 'body', origin: [-5, 4, 6], size: [10, 5, 4], paint: engine },
      { bone: 'body', origin: [-4, 6, 10], size: [2, 2, 2], paint: hub },
      { bone: 'body', origin: [2, 6, 10], size: [2, 2, 2], paint: hub },
      // Steering column and wheel.
      { bone: 'steering', origin: [-0.5, 6, -6.5], size: [1, 4, 1], paint: tire },
      { bone: 'steering', origin: [-3, 10, -7], size: [6, 1, 2], paint: tire },
      { bone: 'steering', origin: [-0.5, 9.5, -6.5], size: [1, 1, 1], paint: P.fireYellow },
      // Wheels: small in front, big in back.
      { bone: 'wheel_fl', origin: [-9, 0, -10], size: [3, 5, 5], paint: wheel },
      { bone: 'wheel_fr', origin: [6, 0, -10], size: [3, 5, 5], paint: wheel },
      { bone: 'wheel_bl', origin: [-9.5, 0, 3], size: [3.5, 6, 6], paint: wheel },
      { bone: 'wheel_br', origin: [6, 0, 3], size: [3.5, 6, 6], paint: wheel },
    ],
  });

  write('resource_pack/textures/items/kart.png', icon16([
    '................',
    '................',
    '................',
    '..........BB....',
    '..........BB....',
    '....K.....BB....',
    '.....K....BB....',
    '..RRRRRRRRRRGG..',
    '.RRWWRRRRRRRGGG.',
    '.RRWMRRRRRRRRRR.',
    '.DDDDDDDDDDDDDD.',
    '..TTT......TTTT.',
    '.TTHTT....TTHHTT',
    '.TTHTT....TTHHTT',
    '..TTT......TTTT.',
    '................',
  ], {
    R: kartRed, D: kartRedDark, W: P.white, M: kartRed, B: seat, K: tire,
    G: engine, T: tire, H: hub,
  }).png());
}
