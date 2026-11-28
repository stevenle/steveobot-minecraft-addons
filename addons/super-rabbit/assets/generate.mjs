// Generates all mob models, textures, client entities, animations, render
// controllers, boss-pad block textures, pack icons, and the 5-floor Boom Boom
// Factory .mcstructure.
//
// Run from the repo root:
//   node addons/super-rabbit/assets/generate.mjs addons/super-rabbit
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

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const grainRand = rng(0x52a8b1);

function fill(c, x0, y0, w, h, color, grain = 0.05) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = grain ? (grainRand() - 0.5) * 2 * grain : 0;
    c.set(x, y, n >= 0 ? mix(color, [255, 255, 255], n) : mix(color, [0, 0, 0], -n));
  }
}

function paintRows(c, rows, legend, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = legend[row[x]];
      if (col) c.set(ox + x, oy + y, col);
    }
  });
}

function framed(base, border, grain = 0.04) {
  return (c, x, y, w, h) => {
    fill(c, x, y, w, h, base, grain);
    fill(c, x, y, w, 1, border, 0);
    fill(c, x, y + h - 1, w, 1, border, 0);
    fill(c, x, y, 1, h, border, 0);
    fill(c, x + w - 1, y, 1, h, border, 0);
  };
}

function hazard(c, x, y, w, h) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    c.set(x + xx, y + yy, ((xx + yy) >> 1) % 2 === 0 ? P.orange : P.charcoal);
  }
}

// ---------- Palette ----------
const P = {
  black: hex('#141418'),
  charcoal: hex('#262830'),
  white: hex('#F7F7F2'),
  cream: hex('#F5E8D0'),
  tan: hex('#C89862'),
  tanDark: hex('#9E7040'),
  pink: hex('#F29AB0'),
  // Robots & steel
  steel: hex('#8B93A0'),
  steelLight: hex('#BAC2CE'),
  steelDark: hex('#565D68'),
  // Accents
  red: hex('#D82828'),
  redDark: hex('#9C1818'),
  orange: hex('#F07818'),
  orangeDark: hex('#B85010'),
  yellow: hex('#F6DC24'),
  yellowDark: hex('#D4B010'),
  gold: hex('#F4C430'),
  green: hex('#38B848'),
  greenDark: hex('#228030'),
  cyan: hex('#28D8E8'),
  blue: hex('#2A6CE0'),
  purple: hex('#7B28B8'),
  purpleDark: hex('#4A1478'),
  magenta: hex('#E838D8'),
  skin: hex('#F2C89C'),
  horn: hex('#F4ECD4'),
  wood: hex('#8A5A2E'),
};

// ---------- Entity model + resource pack generator ----------
function faceSizes([w, h, d]) {
  return { north: [w, h], south: [w, h], east: [d, h], west: [d, h], up: [w, d], down: [w, d] };
}

function buildEntity({ id, bones, cubes, bounds = [2, 2], egg, animKind = 'biped', scale }) {
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
    if (ok && y + shelf <= texW) break;
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

  // Render controller
  write(`resource_pack/render_controllers/${id}.render_controllers.json`, json({
    format_version: '1.10.0',
    render_controllers: {
      [`controller.render.steveo_${id}`]: {
        geometry: 'geometry.default',
        materials: [{ '*': 'material.default' }],
        textures: ['texture.default'],
      },
    },
  }));

  // Animations
  const anims = {};
  const animRefs = {};
  const animateList = [];
  const hasBone = (name) => bones.some((b) => b.name === name);

  if (animKind === 'biped' || animKind === 'boxer') {
    const walkBones = {};
    const legAmp = animKind === 'boxer' ? 42.0 : 34.0;
    const armAmp = animKind === 'boxer' ? 50.0 : 28.0;
    if (hasBone('leg_l')) walkBones.leg_l = { rotation: [`math.cos(query.modified_distance_moved * 38.0) * ${legAmp} * query.modified_move_speed`, 0, 0] };
    if (hasBone('leg_r')) walkBones.leg_r = { rotation: [`-math.cos(query.modified_distance_moved * 38.0) * ${legAmp} * query.modified_move_speed`, 0, 0] };
    if (hasBone('arm_l')) walkBones.arm_l = { rotation: [`-math.cos(query.modified_distance_moved * 38.0) * ${armAmp} * query.modified_move_speed`, 0, 0] };
    if (hasBone('arm_r')) walkBones.arm_r = { rotation: [`math.cos(query.modified_distance_moved * 38.0) * ${armAmp} * query.modified_move_speed`, 0, 0] };
    anims[`animation.steveo_${id}.walk`] = { loop: true, bones: walkBones };
    animRefs.walk = `animation.steveo_${id}.walk`;
    animateList.push('walk');
    if (hasBone('head')) {
      anims[`animation.steveo_${id}.look`] = {
        loop: true,
        bones: { head: { rotation: ['query.target_x_rotation', 'query.target_y_rotation', 0] } },
      };
      animRefs.look = `animation.steveo_${id}.look`;
      animateList.push('look');
    }
  } else if (animKind === 'quadruped') {
    const walkBones = {};
    for (const [b, sign] of [['leg_fl', ''], ['leg_br', ''], ['leg_fr', '-'], ['leg_bl', '-']]) {
      if (hasBone(b)) walkBones[b] = { rotation: [`${sign}math.cos(query.modified_distance_moved * 42.0) * 38.0 * query.modified_move_speed`, 0, 0] };
    }
    anims[`animation.steveo_${id}.walk`] = { loop: true, bones: walkBones };
    animRefs.walk = `animation.steveo_${id}.walk`;
    animateList.push('walk');
    if (hasBone('head')) {
      anims[`animation.steveo_${id}.look`] = {
        loop: true,
        bones: { head: { rotation: ['query.target_x_rotation', 'query.target_y_rotation', 0] } },
      };
      animRefs.look = `animation.steveo_${id}.look`;
      animateList.push('look');
    }
    if (hasBone('tail')) {
      anims[`animation.steveo_${id}.tail`] = {
        loop: true,
        bones: { tail: { rotation: [0, 'math.sin(query.life_time * 240.0) * 22.0', 0] } },
      };
      animRefs.tail = `animation.steveo_${id}.tail`;
      animateList.push('tail');
    }
  } else if (animKind === 'crab') {
    anims[`animation.steveo_${id}.walk`] = {
      loop: true,
      bones: {
        legs_l: { rotation: [0, 0, 'math.sin(query.modified_distance_moved * 50.0) * 18.0 * query.modified_move_speed'] },
        legs_r: { rotation: [0, 0, '-math.sin(query.modified_distance_moved * 50.0) * 18.0 * query.modified_move_speed'] },
        claw_l: { rotation: ['math.sin(query.life_time * 180.0) * 14.0', 0, 0] },
        claw_r: { rotation: ['-math.sin(query.life_time * 180.0) * 14.0', 0, 0] },
      },
    };
    animRefs.walk = `animation.steveo_${id}.walk`;
    animateList.push('walk');
  } else if (animKind === 'hover') {
    anims[`animation.steveo_${id}.hover`] = {
      loop: true,
      bones: {
        body: { position: [0, 'math.sin(query.life_time * 220.0) * 1.5', 0] },
        arm_l: { rotation: ['math.sin(query.life_time * 180.0) * 16.0', 0, 0] },
        arm_r: { rotation: ['-math.sin(query.life_time * 180.0) * 16.0', 0, 0] },
      },
    };
    animRefs.hover = `animation.steveo_${id}.hover`;
    animateList.push('hover');
  } else if (animKind === 'spin') {
    anims[`animation.steveo_${id}.spin`] = {
      loop: true,
      bones: {
        ball: { rotation: ['query.life_time * 360.0', 'query.life_time * 240.0', 0] },
      },
    };
    animRefs.spin = `animation.steveo_${id}.spin`;
    animateList.push('spin');
  }

  write(`resource_pack/animations/${id}.animation.json`, json({
    format_version: '1.8.0',
    animations: anims,
  }));

  // Client entity
  const desc = {
    identifier: `steveo:${id}`,
    materials: { default: 'entity_alphatest' },
    textures: { default: `textures/entity/${id}` },
    geometry: { default: `geometry.steveo_${id}` },
    animations: animRefs,
    scripts: {
      ...(scale ? { scale } : {}),
      animate: animateList,
    },
    render_controllers: [`controller.render.steveo_${id}`],
    ...(egg ? { spawn_egg: { base_color: egg[0], overlay_color: egg[1] } } : {}),
  };
  write(`resource_pack/entity/${id}.entity.json`, json({
    format_version: '1.10.0',
    'minecraft:client_entity': { description: desc },
  }));

  console.log(`entity ${id}: ${cubes.length} cubes, ${texW}x${texH}`);
}

// =========================================================================
// 1. SINGING DOG (Friendly Animal Town mob)
// =========================================================================
buildEntity({
  id: 'singing_dog',
  bounds: [2, 2],
  egg: ['#F5E8D0', '#D82828'],
  animKind: 'quadruped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 6, 0] },
    { name: 'head', parent: 'body', pivot: [0, 9, -5] },
    { name: 'tail', parent: 'body', pivot: [0, 8, 6] },
    { name: 'leg_fl', parent: 'root', pivot: [-2.5, 4, -3.5] },
    { name: 'leg_fr', parent: 'root', pivot: [2.5, 4, -3.5] },
    { name: 'leg_bl', parent: 'root', pivot: [-2.5, 4, 3.5] },
    { name: 'leg_br', parent: 'root', pivot: [2.5, 4, 3.5] },
  ],
  cubes: [
    { bone: 'leg_fl', origin: [-3.5, 0, -4.5], size: [2, 5, 2], paint: P.cream },
    { bone: 'leg_fr', origin: [1.5, 0, -4.5], size: [2, 5, 2], paint: P.cream },
    { bone: 'leg_bl', origin: [-3.5, 0, 2.5], size: [2, 5, 2], paint: P.cream },
    { bone: 'leg_br', origin: [1.5, 0, 2.5], size: [2, 5, 2], paint: P.cream },
    {
      bone: 'body', origin: [-4, 4, -5], size: [8, 6, 11],
      paint: { all: P.cream, up: (c, x, y, w, h) => { fill(c, x, y, w, h, P.cream); fill(c, x + 1, y + 3, 4, 4, P.tan); } },
    },
    // Red musical collar with gold note badge
    {
      bone: 'body', origin: [-4.5, 5, -6], size: [9, 2, 2],
      paint: { all: P.red, north: (c, x, y, w, h) => { fill(c, x, y, w, h, P.red); fill(c, x + 3, y, 3, 2, P.gold); } },
    },
    { bone: 'tail', origin: [-1, 8, 6], size: [2, 5, 2], paint: P.tan },
    // Happy dog head + floppy tan ears + snout
    {
      bone: 'head', origin: [-3.5, 7, -11], size: [7, 7, 6],
      paint: {
        all: P.cream,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.cream);
          paintRows(c, [
            '.K...K.',
            '.K...K.',
            '.......',
            '.R...R.',
            '..RRR..',
          ], { K: P.black, R: P.pink }, x, y + 1);
        },
      },
    },
    {
      bone: 'head', origin: [-2, 7.5, -14], size: [4, 3, 3],
      paint: { all: P.white, north: (c, x, y, w, h) => { fill(c, x, y, w, h, P.white); fill(c, x + 1, y, 2, 1, P.black); } },
    },
    { bone: 'head', origin: [-5.5, 7, -9], size: [2, 6, 3], paint: P.tan },
    { bone: 'head', origin: [3.5, 7, -9], size: [2, 6, 3], paint: P.tan },
  ],
});

// =========================================================================
// 2. BILLIP (Super Rabbit All-Stars! — yellow square boxer with red gloves)
// =========================================================================
buildEntity({
  id: 'billip',
  bounds: [2.5, 2.5],
  egg: ['#F6DC24', '#D82828'],
  animKind: 'boxer',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 9, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-6, 14, 0] },
    { name: 'arm_r', parent: 'body', pivot: [6, 14, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-3, 8, 0] },
    { name: 'leg_r', parent: 'root', pivot: [3, 8, 0] },
  ],
  cubes: [
    // Thin gray stick legs + red boots
    { bone: 'leg_l', origin: [-4, 2, -1], size: [2, 7, 2], paint: framed(P.steel, P.black, 0) },
    { bone: 'leg_l', origin: [-4.5, 0, -3], size: [3, 3, 5], paint: framed(P.red, P.black, 0) },
    { bone: 'leg_r', origin: [2, 2, -1], size: [2, 7, 2], paint: framed(P.steel, P.black, 0) },
    { bone: 'leg_r', origin: [1.5, 0, -3], size: [3, 3, 5], paint: framed(P.red, P.black, 0) },
    // Iconic bright yellow square body with bold black border + angry face
    {
      bone: 'body', origin: [-6, 9, -5], size: [12, 12, 10],
      paint: {
        all: framed(P.yellow, P.black, 0.02),
        north: (c, x, y, w, h) => {
          framed(P.yellow, P.black, 0.02)(c, x, y, w, h);
          paintRows(c, [
            '............',
            '.KK......KK.',
            '..KK....KK..',
            '..K..RR..K..',
            '..K..RR..K..',
            '............',
            '..KKKKKKKK..',
            '..KWKWKWKK..',
            '..KWWKWWKK..',
            '...KKKKKK...',
            '............',
          ], { K: P.black, R: P.red, W: P.white }, x, y + 1);
        },
      },
    },
    // Thin gray stick arms + BIG red boxing gloves
    { bone: 'arm_l', origin: [-11, 13, -1], size: [5, 2, 2], paint: framed(P.steel, P.black, 0) },
    { bone: 'arm_l', origin: [-13, 15, -1], size: [2, 5, 2], paint: framed(P.steel, P.black, 0) },
    { bone: 'arm_l', origin: [-15, 19, -3], size: [6, 5, 6], paint: framed(P.red, P.black, 0.03) },
    { bone: 'arm_r', origin: [6, 13, -1], size: [5, 2, 2], paint: framed(P.steel, P.black, 0) },
    { bone: 'arm_r', origin: [11, 15, -1], size: [2, 5, 2], paint: framed(P.steel, P.black, 0) },
    { bone: 'arm_r', origin: [9, 19, -3], size: [6, 5, 6], paint: framed(P.red, P.black, 0.03) },
  ],
});

// =========================================================================
// 3. VIKING-BOT (Standard Robot Minion)
// =========================================================================
buildEntity({
  id: 'viking_bot',
  bounds: [2, 2.5],
  egg: ['#8B93A0', '#F07818'],
  animKind: 'biped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-2.5, 8, 0] },
    { name: 'leg_r', parent: 'root', pivot: [2.5, 8, 0] },
    { name: 'body', parent: 'root', pivot: [0, 8, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-5.5, 16, 0] },
    { name: 'arm_r', parent: 'body', pivot: [5.5, 16, 0] },
    { name: 'head', parent: 'body', pivot: [0, 18, 0] },
  ],
  cubes: [
    { bone: 'leg_l', origin: [-4, 0, -2], size: [3, 8, 4], paint: framed(P.steelDark, P.black) },
    { bone: 'leg_r', origin: [1, 0, -2], size: [3, 8, 4], paint: framed(P.steelDark, P.black) },
    {
      bone: 'body', origin: [-4.5, 8, -3], size: [9, 10, 6],
      paint: {
        all: framed(P.steel, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steel, P.steelDark)(c, x, y, w, h);
          fill(c, x + 1, y + 2, w - 2, 2, P.orange, 0);
          fill(c, x + 3, y + 5, 3, 2, P.red, 0);
        },
      },
    },
    { bone: 'arm_l', origin: [-7.5, 9, -2], size: [3, 9, 4], paint: framed(P.steel, P.steelDark) },
    { bone: 'arm_r', origin: [4.5, 9, -2], size: [3, 9, 4], paint: framed(P.steel, P.steelDark) },
    {
      bone: 'head', origin: [-4, 18, -4], size: [8, 7, 8],
      paint: {
        all: framed(P.steelLight, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steelLight, P.steelDark)(c, x, y, w, h);
          fill(c, x + 1, y + 2, 6, 2, P.black, 0);
          fill(c, x + 2, y + 2, 1, 2, P.red, 0);
          fill(c, x + 5, y + 2, 1, 2, P.red, 0);
        },
      },
    },
    // Little Viking helmet cap + horns
    { bone: 'head', origin: [-4.5, 24, -4.5], size: [9, 2, 9], paint: P.orange },
    { bone: 'head', origin: [-6.5, 25, -1], size: [2, 3, 2], paint: P.horn },
    { bone: 'head', origin: [4.5, 25, -1], size: [2, 3, 2], paint: P.horn },
  ],
});

// =========================================================================
// 4. ROBO-CRAB (Robot Minion)
// =========================================================================
buildEntity({
  id: 'robo_crab',
  bounds: [2.5, 1.5],
  egg: ['#D82828', '#8B93A0'],
  animKind: 'crab',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 4, 0] },
    { name: 'claw_l', parent: 'body', pivot: [-7, 5, -5] },
    { name: 'claw_r', parent: 'body', pivot: [7, 5, -5] },
    { name: 'legs_l', parent: 'body', pivot: [-7, 4, 0] },
    { name: 'legs_r', parent: 'body', pivot: [7, 4, 0] },
  ],
  cubes: [
    {
      bone: 'body', origin: [-7, 3, -5], size: [14, 6, 10],
      paint: {
        all: framed(P.red, P.redDark),
        north: (c, x, y, w, h) => {
          framed(P.red, P.redDark)(c, x, y, w, h);
          fill(c, x + 2, y + 1, 10, 2, P.charcoal, 0);
          fill(c, x + 3, y + 1, 2, 2, P.yellow, 0);
          fill(c, x + 9, y + 1, 2, 2, P.yellow, 0);
        },
      },
    },
    { bone: 'body', origin: [-5, 9, -3], size: [10, 2, 6], paint: P.steel },
    { bone: 'claw_l', origin: [-10, 3, -11], size: [4, 4, 7], paint: framed(P.steelLight, P.steelDark) },
    { bone: 'claw_r', origin: [6, 3, -11], size: [4, 4, 7], paint: framed(P.steelLight, P.steelDark) },
    { bone: 'legs_l', origin: [-10, 0, -4], size: [3, 4, 2], paint: P.steelDark },
    { bone: 'legs_l', origin: [-10, 0, -1], size: [3, 4, 2], paint: P.steelDark },
    { bone: 'legs_l', origin: [-10, 0, 2], size: [3, 4, 2], paint: P.steelDark },
    { bone: 'legs_r', origin: [7, 0, -4], size: [3, 4, 2], paint: P.steelDark },
    { bone: 'legs_r', origin: [7, 0, -1], size: [3, 4, 2], paint: P.steelDark },
    { bone: 'legs_r', origin: [7, 0, 2], size: [3, 4, 2], paint: P.steelDark },
  ],
});

// =========================================================================
// 5. ROBO-LIZARD (Fast Ambush Robot Minion)
// =========================================================================
buildEntity({
  id: 'robo_lizard',
  bounds: [2.5, 1.5],
  egg: ['#38B848', '#565D68'],
  animKind: 'quadruped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 4, 0] },
    { name: 'head', parent: 'body', pivot: [0, 5, -6] },
    { name: 'tail', parent: 'body', pivot: [0, 4, 6] },
    { name: 'leg_fl', parent: 'root', pivot: [-3.5, 3, -4] },
    { name: 'leg_fr', parent: 'root', pivot: [3.5, 3, -4] },
    { name: 'leg_bl', parent: 'root', pivot: [-3.5, 3, 4] },
    { name: 'leg_br', parent: 'root', pivot: [3.5, 3, 4] },
  ],
  cubes: [
    { bone: 'leg_fl', origin: [-5, 0, -5], size: [2, 4, 2], paint: P.steelDark },
    { bone: 'leg_fr', origin: [3, 0, -5], size: [2, 4, 2], paint: P.steelDark },
    { bone: 'leg_bl', origin: [-5, 0, 3], size: [2, 4, 2], paint: P.steelDark },
    { bone: 'leg_br', origin: [3, 0, 3], size: [2, 4, 2], paint: P.steelDark },
    { bone: 'body', origin: [-3.5, 3, -6], size: [7, 4, 12], paint: framed(P.green, P.greenDark) },
    { bone: 'body', origin: [-1, 7, -4], size: [2, 2, 8], paint: P.steelLight },
    { bone: 'tail', origin: [-1.5, 3, 6], size: [3, 3, 9], paint: framed(P.greenDark, P.steelDark) },
    {
      bone: 'head', origin: [-3, 3.5, -12], size: [6, 5, 6],
      paint: {
        all: framed(P.green, P.greenDark),
        north: (c, x, y, w, h) => {
          framed(P.green, P.greenDark)(c, x, y, w, h);
          fill(c, x + 1, y + 1, 1, 2, P.red, 0);
          fill(c, x + 4, y + 1, 1, 2, P.red, 0);
        },
      },
    },
  ],
});

// =========================================================================
// 6. ROCKET-ROBO (Hovering Jetpack Robot Minion)
// =========================================================================
buildEntity({
  id: 'rocket_robo',
  bounds: [2, 2.5],
  egg: ['#BAC2CE', '#28D8E8'],
  animKind: 'hover',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 8, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-5.5, 13, 0] },
    { name: 'arm_r', parent: 'body', pivot: [5.5, 13, 0] },
  ],
  cubes: [
    {
      bone: 'body', origin: [-4.5, 6, -3.5], size: [9, 10, 7],
      paint: {
        all: framed(P.steelLight, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steelLight, P.steelDark)(c, x, y, w, h);
          fill(c, x + 1, y + 2, 7, 3, P.charcoal, 0);
          fill(c, x + 2, y + 3, 5, 1, P.cyan, 0);
          fill(c, x + 2, y + 7, 5, 2, P.orange, 0);
        },
      },
    },
    // Pointed rocket nose cone on top
    { bone: 'body', origin: [-3, 16, -2.5], size: [6, 3, 5], paint: P.orange },
    { bone: 'body', origin: [-1.5, 19, -1.5], size: [3, 2, 3], paint: P.red },
    // Bottom thruster nozzle + back jetpacks
    { bone: 'body', origin: [-2.5, 3, -2], size: [5, 3, 4], paint: P.charcoal },
    { bone: 'body', origin: [-4, 6, 3.5], size: [3, 8, 3], paint: P.orange },
    { bone: 'body', origin: [1, 6, 3.5], size: [3, 8, 3], paint: P.orange },
    { bone: 'arm_l', origin: [-7.5, 8, -1.5], size: [3, 6, 3], paint: P.steel },
    { bone: 'arm_r', origin: [4.5, 8, -1.5], size: [3, 6, 3], paint: P.steel },
  ],
});

// =========================================================================
// 7. KING VIKING (Main Villain — regular spawning mob + Floor 5 Boss!)
// =========================================================================
buildEntity({
  id: 'king_viking',
  bounds: [3, 3],
  egg: ['#F07818', '#7B28B8'],
  animKind: 'biped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-3, 10, 0] },
    { name: 'leg_r', parent: 'root', pivot: [3, 10, 0] },
    { name: 'body', parent: 'root', pivot: [0, 10, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-7, 20, 0] },
    { name: 'arm_r', parent: 'body', pivot: [7, 20, 0] },
    { name: 'head', parent: 'body', pivot: [0, 22, 0] },
  ],
  cubes: [
    { bone: 'leg_l', origin: [-5, 0, -2.5], size: [4, 10, 5], paint: P.purpleDark },
    { bone: 'leg_r', origin: [1, 0, -2.5], size: [4, 10, 5], paint: P.purpleDark },
    // Orange & purple royal tunic + gold belt
    {
      bone: 'body', origin: [-6, 10, -4], size: [12, 12, 8],
      paint: {
        all: P.purple,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.purple);
          fill(c, x, y, w, 3, P.orange);
          fill(c, x, y + h - 3, w, 2, P.charcoal);
          fill(c, x + 4, y + h - 3, 4, 2, P.gold);
        },
      },
    },
    // Purple royal cape
    { bone: 'body', origin: [-6, 8, 4], size: [12, 14, 1], paint: P.purpleDark },
    { bone: 'arm_l', origin: [-10, 11, -2.5], size: [4, 11, 5], paint: P.orange },
    { bone: 'arm_r', origin: [6, 11, -2.5], size: [4, 11, 5], paint: P.orange },
    // Big Viking Hammer in right hand!
    { bone: 'arm_r', origin: [7.5, 9, -11], size: [2, 2, 12], paint: P.wood },
    { bone: 'arm_r', origin: [5.5, 6, -15], size: [6, 7, 5], paint: framed(P.steel, P.gold) },
    // Head + big black beard + orange horned Viking helmet
    {
      bone: 'head', origin: [-4.5, 22, -4.5], size: [9, 8, 9],
      paint: {
        all: P.skin,
        north: (c, x, y, w, h) => {
          fill(c, x, y, w, h, P.skin);
          paintRows(c, [
            '.KK...KK.',
            '..K...K..',
            '.WK...KW.',
            '.........',
            'KKKKKKKKK',
            'KKKKKKKKK',
          ], { K: P.black, W: P.white }, x, y + 2);
        },
      },
    },
    // Big bushy black beard extending down the chest
    { bone: 'head', origin: [-5, 16, -5.5], size: [10, 6, 2], paint: P.black },
    // Orange Viking helmet + white horns
    { bone: 'head', origin: [-5.5, 28, -5.5], size: [11, 4, 11], paint: framed(P.orange, P.gold) },
    { bone: 'head', origin: [-8.5, 29, -1.5], size: [3, 2, 3], paint: P.horn },
    { bone: 'head', origin: [-9.5, 31, -1.5], size: [2, 4, 2], paint: P.horn },
    { bone: 'head', origin: [5.5, 29, -1.5], size: [3, 2, 3], paint: P.horn },
    { bone: 'head', origin: [7.5, 31, -1.5], size: [2, 4, 2], paint: P.horn },
  ],
});

// =========================================================================
// 8. ROBO-RABBIT BOY (Floor 1 Boss — Speedy Metallic Double)
// =========================================================================
buildEntity({
  id: 'robo_rabbit_boy',
  bounds: [2.5, 3],
  egg: ['#BAC2CE', '#D82828'],
  animKind: 'biped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-2.5, 9, 0] },
    { name: 'leg_r', parent: 'root', pivot: [2.5, 9, 0] },
    { name: 'body', parent: 'root', pivot: [0, 9, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-5.5, 18, 0] },
    { name: 'arm_r', parent: 'body', pivot: [5.5, 18, 0] },
    { name: 'head', parent: 'body', pivot: [0, 20, 0] },
  ],
  cubes: [
    { bone: 'leg_l', origin: [-4, 3, -2], size: [3, 6, 4], paint: P.steel },
    { bone: 'leg_l', origin: [-4.5, 0, -3], size: [4, 3, 5], paint: P.red },
    { bone: 'leg_r', origin: [1, 3, -2], size: [3, 6, 4], paint: P.steel },
    { bone: 'leg_r', origin: [0.5, 0, -3], size: [4, 3, 5], paint: P.red },
    {
      bone: 'body', origin: [-4.5, 9, -3], size: [9, 11, 6],
      paint: {
        all: framed(P.steelLight, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steelLight, P.steelDark)(c, x, y, w, h);
          fill(c, x + 3, y + 3, 3, 3, P.red, 0);
          fill(c, x + 4, y + 4, 1, 1, P.cyan, 0);
        },
      },
    },
    { bone: 'arm_l', origin: [-7.5, 10, -2], size: [3, 9, 4], paint: P.steel },
    { bone: 'arm_r', origin: [4.5, 10, -2], size: [3, 9, 4], paint: P.steel },
    {
      bone: 'head', origin: [-4.5, 20, -4.5], size: [9, 8, 9],
      paint: {
        all: framed(P.steelLight, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steelLight, P.steelDark)(c, x, y, w, h);
          fill(c, x + 1, y + 2, 7, 2, P.black, 0);
          fill(c, x + 2, y + 2, 2, 2, P.cyan, 0);
          fill(c, x + 5, y + 2, 2, 2, P.cyan, 0);
        },
      },
    },
    // Tall metallic rabbit ears
    { bone: 'head', origin: [-4, 28, -1.5], size: [3, 8, 2], paint: { all: P.steelLight, north: P.cyan } },
    { bone: 'head', origin: [1, 28, -1.5], size: [3, 8, 2], paint: { all: P.steelLight, north: P.cyan } },
  ],
});

// =========================================================================
// 9. SUPER RABBIT BOSS (Floor 3 Boss — Giant Dark Corrupted Rabbit)
// =========================================================================
buildEntity({
  id: 'super_rabbit_boss',
  bounds: [3.5, 4],
  egg: ['#4A1478', '#E838D8'],
  animKind: 'biped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-4, 12, 0] },
    { name: 'leg_r', parent: 'root', pivot: [4, 12, 0] },
    { name: 'body', parent: 'root', pivot: [0, 12, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-9, 25, 0] },
    { name: 'arm_r', parent: 'body', pivot: [9, 25, 0] },
    { name: 'head', parent: 'body', pivot: [0, 27, 0] },
  ],
  cubes: [
    { bone: 'leg_l', origin: [-6.5, 0, -3.5], size: [5, 12, 7], paint: P.charcoal },
    { bone: 'leg_r', origin: [1.5, 0, -3.5], size: [5, 12, 7], paint: P.charcoal },
    {
      bone: 'body', origin: [-7.5, 12, -5], size: [15, 15, 10],
      paint: {
        all: framed(P.purpleDark, P.black),
        north: (c, x, y, w, h) => {
          framed(P.purpleDark, P.black)(c, x, y, w, h);
          fill(c, x + 5, y + 4, 5, 5, P.magenta, 0);
          fill(c, x + 6, y + 5, 3, 3, P.black, 0);
        },
      },
    },
    { bone: 'arm_l', origin: [-12.5, 13, -3.5], size: [5, 14, 7], paint: P.charcoal },
    { bone: 'arm_r', origin: [7.5, 13, -3.5], size: [5, 14, 7], paint: P.charcoal },
    {
      bone: 'head', origin: [-6, 27, -6], size: [12, 11, 12],
      paint: {
        all: framed(P.charcoal, P.black),
        north: (c, x, y, w, h) => {
          framed(P.charcoal, P.black)(c, x, y, w, h);
          paintRows(c, [
            '.MM......MM.',
            '..MMM..MMM..',
            '..MKK..KKM..',
            '............',
            '..WWWWWWWW..',
            '..WKWKWKWK..',
          ], { M: P.magenta, K: P.black, W: P.white }, x, y + 2);
        },
      },
    },
    // Tall menacing dark rabbit ears
    { bone: 'head', origin: [-5.5, 38, -2], size: [4, 11, 3], paint: { all: P.charcoal, north: P.magenta } },
    { bone: 'head', origin: [1.5, 38, -2], size: [4, 11, 3], paint: { all: P.charcoal, north: P.magenta } },
  ],
});

// =========================================================================
// 10. MEGA-ROBO (Floor 4 Boss — Towering Boom Boom Factory Mech)
// =========================================================================
buildEntity({
  id: 'mega_robo',
  bounds: [4, 4.5],
  egg: ['#565D68', '#F07818'],
  animKind: 'biped',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'leg_l', parent: 'root', pivot: [-5, 14, 0] },
    { name: 'leg_r', parent: 'root', pivot: [5, 14, 0] },
    { name: 'body', parent: 'root', pivot: [0, 14, 0] },
    { name: 'arm_l', parent: 'body', pivot: [-11, 29, 0] },
    { name: 'arm_r', parent: 'body', pivot: [11, 29, 0] },
    { name: 'head', parent: 'body', pivot: [0, 32, 0] },
  ],
  cubes: [
    { bone: 'leg_l', origin: [-8, 0, -4], size: [6, 14, 8], paint: framed(P.steelDark, P.black) },
    { bone: 'leg_r', origin: [2, 0, -4], size: [6, 14, 8], paint: framed(P.steelDark, P.black) },
    // Heavy torso with hazard stripes & glowing furnace core
    {
      bone: 'body', origin: [-9, 14, -6], size: [18, 18, 12],
      paint: {
        all: framed(P.steel, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steel, P.steelDark)(c, x, y, w, h);
          hazard(c, x + 1, y + h - 4, w - 2, 3);
          fill(c, x + 5, y + 4, 8, 7, P.charcoal, 0);
          fill(c, x + 6, y + 5, 6, 5, P.orange, 0);
          fill(c, x + 7, y + 6, 4, 3, P.yellow, 0);
        },
      },
    },
    // Twin shoulder rocket pods
    { bone: 'body', origin: [-11, 32, -3], size: [5, 6, 6], paint: { all: P.orange, north: P.red } },
    { bone: 'body', origin: [6, 32, -3], size: [5, 6, 6], paint: { all: P.orange, north: P.red } },
    // Heavy cannon arms
    { bone: 'arm_l', origin: [-15, 15, -4], size: [6, 16, 8], paint: framed(P.steelDark, P.orange) },
    { bone: 'arm_r', origin: [9, 15, -4], size: [6, 16, 8], paint: framed(P.steelDark, P.orange) },
    // Armored mech head
    {
      bone: 'head', origin: [-5, 32, -5], size: [10, 9, 10],
      paint: {
        all: framed(P.steelLight, P.steelDark),
        north: (c, x, y, w, h) => {
          framed(P.steelLight, P.steelDark)(c, x, y, w, h);
          fill(c, x + 1, y + 3, 8, 3, P.black, 0);
          fill(c, x + 2, y + 4, 6, 1, P.red, 0);
        },
      },
    },
  ],
});

// =========================================================================
// 11. BOOM BOLT (Energy projectile)
// =========================================================================
buildEntity({
  id: 'boom_bolt',
  bounds: [1, 1],
  animKind: 'spin',
  bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'ball', parent: 'root', pivot: [0, 2, 0] },
  ],
  cubes: [
    {
      bone: 'ball', origin: [-2, 0, -2], size: [4, 4, 4],
      paint: (c, x, y, w, h) => {
        fill(c, x, y, w, h, P.orange, 0.1);
        fill(c, x + 1, y + 1, w - 2, h - 2, P.yellow, 0.05);
      },
    },
  ],
});

// =========================================================================
// Boss Pad Block Textures (16x16)
// =========================================================================
const PAD_COLORS = [
  ['boss_pad_1', P.cyan, P.steelLight],
  ['boss_pad_2', P.yellow, P.red],
  ['boss_pad_3', P.magenta, P.purple],
  ['boss_pad_4', P.orange, P.red],
  ['boss_pad_5', P.gold, P.orange],
];
for (const [name, primary, accent] of PAD_COLORS) {
  const c = canvas(16, 16);
  fill(c, 0, 0, 16, 16, P.charcoal, 0.04);
  fill(c, 0, 0, 16, 2, accent, 0);
  fill(c, 0, 14, 16, 2, accent, 0);
  fill(c, 0, 0, 2, 16, accent, 0);
  fill(c, 14, 0, 2, 16, accent, 0);
  fill(c, 4, 4, 8, 8, primary, 0.05);
  fill(c, 6, 6, 4, 4, P.white, 0);
  write(`resource_pack/textures/blocks/${name}.png`, c.png());
}

// =========================================================================
// Pack Icon (64x64)
// =========================================================================
{
  const c = canvas(64, 64);
  fill(c, 0, 0, 64, 64, P.purpleDark, 0.04);
  // Orange hazard border
  for (let i = 0; i < 64; i += 8) {
    fill(c, i, 0, 4, 4, P.orange, 0);
    fill(c, i, 60, 4, 4, P.orange, 0);
    fill(c, 0, i, 4, 4, P.orange, 0);
    fill(c, 60, i, 4, 4, P.orange, 0);
  }
  // Cute pixel Super Rabbit Boy head silhouette in center
  fill(c, 18, 8, 8, 20, P.white, 0.02);
  fill(c, 38, 8, 8, 20, P.white, 0.02);
  fill(c, 20, 12, 4, 14, P.pink, 0);
  fill(c, 40, 12, 4, 14, P.pink, 0);
  fill(c, 14, 26, 36, 26, P.white, 0.02);
  fill(c, 22, 34, 4, 6, P.black, 0);
  fill(c, 38, 34, 4, 6, P.black, 0);
  fill(c, 29, 41, 6, 3, P.pink, 0);
  fill(c, 20, 52, 24, 6, P.red, 0);
  const data = c.png();
  write('behavior_pack/pack_icon.png', data);
  write('resource_pack/pack_icon.png', data);
}

// =========================================================================
// Minimal Little-Endian NBT Writer for .mcstructure
// =========================================================================
const T = { end: 0, byte: 1, short: 2, int: 3, string: 8, list: 9, compound: 10 };
const tag = {
  byte: (v) => ({ t: T.byte, v }),
  short: (v) => ({ t: T.short, v }),
  int: (v) => ({ t: T.int, v }),
  string: (v) => ({ t: T.string, v }),
  list: (of, v) => ({ t: T.list, of, v }),
  compound: (v) => ({ t: T.compound, v }),
};

function nbtWriter() {
  const parts = [];
  const w = {
    u8: (v) => parts.push(Buffer.from([v & 0xff])),
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

function writeStructure(rel, grid) {
  const SX = grid.length, SY = grid[0].length, SZ = grid[0][0].length;
  const paletteKeys = new Map();
  const palette = [];
  const indices = [];
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

// =========================================================================
// BOOM BOOM FACTORY — 5-Floor Decorated Boss Tower (19 x 43 x 19)
// =========================================================================
// y = 0..3   : buried deepslate foundation
// Floor 1    : y = 4..10  — Assembly Line (Robo-Rabbit Boy)
// Floor 2    : y = 11..17 — All-Stars Boxing Arena (Billip)
// Floor 3    : y = 18..24 — Upside-Down Shadow Lab (Super Rabbit Boss)
// Floor 4    : y = 25..31 — Rocket Forge (Mega-Robo)
// Floor 5    : y = 32..38 — King Viking's Throne Room (King Viking)
// Roof       : y = 39..42 — Crenellations & twin factory smokestacks
{
  const SX = 19, SY = 43, SZ = 19;
  const CX = 9, CZ = 9;
  const FLOOR_H = 7;
  const BASE_Y = 4;
  const ROOF_Y = BASE_Y + 5 * FLOOR_H; // 39
  const grid = makeGrid(SX, SY, SZ);
  const at = (x, y, z, b) => {
    if (x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ) grid[x][y][z] = b;
  };
  const isEdge = (x, z) => x === 0 || x === SX - 1 || z === 0 || z === SZ - 1;
  const isCorner = (x, z) => (x <= 1 || x >= SX - 2) && (z <= 1 || z >= SZ - 2);
  const lava = withStates('minecraft:lava', { liquid_depth: tag.int(0) });

  // 1. Buried foundation (y = 0..3)
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    for (let y = 0; y < BASE_Y; y++) at(x, y, z, 'minecraft:cobbled_deepslate');
  }

  // 2. Outer shell for all 5 floors + roof slab
  const floorWallBlock = [
    'minecraft:deepslate_bricks',
    'minecraft:stone_bricks',
    'minecraft:deepslate_tiles',
    'minecraft:polished_blackstone_bricks',
    'minecraft:polished_blackstone_bricks',
  ];
  const floorSlabBlock = [
    'minecraft:polished_deepslate',
    'minecraft:smooth_stone',
    'minecraft:deepslate_tiles',
    'minecraft:polished_blackstone',
    'minecraft:polished_blackstone_bricks',
  ];

  for (let f = 0; f < 5; f++) {
    const fy = BASE_Y + f * FLOOR_H;
    // Floor slab
    for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
      at(x, fy, z, floorSlabBlock[f]);
    }
    // Outer walls
    for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
      if (!isEdge(x, z)) continue;
      for (let dy = 1; dy < FLOOR_H; dy++) {
        const y = fy + dy;
        if (isCorner(x, z)) {
          at(x, y, z, 'minecraft:polished_blackstone_bricks');
        } else if (dy === 1) {
          // Bold orange & black hazard band along the outside of every floor
          at(x, y, z, (x + z) % 2 === 0 ? 'minecraft:orange_concrete' : 'minecraft:black_concrete');
        } else {
          at(x, y, z, floorWallBlock[f]);
        }
      }
    }
    // Industrial iron-bar windows on all 4 sides
    for (const pos of [5, 9, 13]) {
      for (const dy of [3, 4]) {
        if (!(f === 0 && pos === 9)) at(pos, fy + dy, 0, 'minecraft:iron_bars');
        at(pos, fy + dy, SZ - 1, 'minecraft:iron_bars');
        at(0, fy + dy, pos, 'minecraft:iron_bars');
        at(SX - 1, fy + dy, pos, 'minecraft:iron_bars');
      }
    }
    // Ceiling corner lights on every floor
    for (const lx of [3, SX - 4]) for (const lz of [3, SZ - 4]) {
      at(lx, fy + FLOOR_H - 1, lz, f === 2 ? 'minecraft:sea_lantern' : 'minecraft:shroomlight');
    }
  }

  // Roof slab, crenellations, and twin smokestacks
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    at(x, ROOF_Y, z, 'minecraft:polished_blackstone_bricks');
    if (isEdge(x, z) && (x + z) % 2 === 0) {
      at(x, ROOF_Y + 1, z, (x === 0 || x === SX - 1) ? 'minecraft:orange_concrete' : 'minecraft:polished_blackstone_bricks');
    }
  }
  // Twin factory smokestacks at back corners
  for (const sx0 of [2, SX - 5]) {
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
      const edge = dx === 0 || dx === 2 || dz === 0 || dz === 2;
      for (let y = ROOF_Y + 1; y <= ROOF_Y + 3; y++) {
        at(sx0 + dx, y, SZ - 5 + dz, edge ? (y === ROOF_Y + 3 ? 'minecraft:orange_concrete' : 'minecraft:deepslate_bricks') : AIR);
      }
    }
    at(sx0 + 1, ROOF_Y + 1, SZ - 4, 'minecraft:campfire');
  }

  // Grand entrance archway on Floor 1 front wall (z = 0)
  for (let x = CX - 2; x <= CX + 2; x++) for (let y = BASE_Y + 1; y <= BASE_Y + 4; y++) at(x, y, 0, AIR);
  for (let y = BASE_Y + 1; y <= BASE_Y + 5; y++) {
    at(CX - 3, y, 0, 'minecraft:orange_concrete');
    at(CX + 3, y, 0, 'minecraft:orange_concrete');
  }
  for (let x = CX - 3; x <= CX + 3; x++) at(x, BASE_Y + 5, 0, 'minecraft:orange_concrete');
  at(CX - 2, BASE_Y + 4, 0, 'minecraft:shroomlight');
  at(CX + 2, BASE_Y + 4, 0, 'minecraft:shroomlight');

  // 3. Staircases connecting Floor 1 -> 2 -> 3 -> 4 -> 5
  // Placed cleanly along x = SX - 3..SX - 2, climbing along z = 11..5 (7 steps, 1 up per z).
  for (let f = 0; f < 4; f++) {
    const fy = BASE_Y + f * FLOOR_H;
    const nextFy = fy + FLOOR_H;
    // Open ceiling hatch above the staircase so the player walks right out onto the next floor
    for (let z = 4; z <= 12; z++) {
      for (const x of [SX - 3, SX - 2]) at(x, nextFy, z, AIR);
    }
    // Steps rising from z = 11 (y = fy + 1) up to z = 5 (y = fy + 7 = nextFy)
    for (let step = 0; step < FLOOR_H; step++) {
      const z = 11 - step;
      const y = fy + 1 + step;
      for (const x of [SX - 3, SX - 2]) {
        at(x, y, z, 'minecraft:polished_deepslate');
        // Keep headroom clear above every step
        for (let h = 1; h <= 3; h++) {
          if (y + h < nextFy + 3) at(x, y + h, z, AIR);
        }
      }
    }
    // Safety railing along the inner side of the stairwell opening on the upper floor
    for (let z = 5; z <= 12; z++) at(SX - 4, nextFy + 1, z, 'minecraft:iron_bars');
  }

  // ---------- FLOOR 1 (y = 4): ASSEMBLY LINE (Robo-Rabbit Boy) ----------
  {
    const fy = BASE_Y;
    // Hazard walkway from entrance to center pad
    for (let z = 1; z <= 14; z++) {
      at(CX - 1, fy, z, 'minecraft:black_concrete');
      at(CX, fy, z, z % 2 === 0 ? 'minecraft:orange_concrete' : 'minecraft:yellow_concrete');
      at(CX + 1, fy, z, 'minecraft:black_concrete');
    }
    // Left conveyor belt with iron blocks & smelters
    for (let z = 3; z <= 14; z++) {
      at(3, fy + 1, z, 'minecraft:polished_basalt');
      at(4, fy + 1, z, 'minecraft:polished_basalt');
      if (z % 3 === 0) at(3, fy + 2, z, 'minecraft:iron_block');
    }
    for (const z of [4, 8, 12]) {
      at(1, fy + 1, z, 'minecraft:blast_furnace');
      at(1, fy + 2, z, 'minecraft:redstone_lamp');
      at(1, fy + 3, z, 'minecraft:redstone_block');
    }
    // Center Floor 1 Boss Pad
    at(CX, fy, CZ, 'steveo:boss_pad_1');
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) at(CX + dx, fy, CZ + dz, 'minecraft:cyan_concrete');
  }

  // ---------- FLOOR 2 (y = 11): ALL-STARS BOXING ARENA (Billip) ----------
  {
    const fy = BASE_Y + FLOOR_H;
    // Raised boxing ring (x: 4..12, z: 5..13) — leaves staircase side totally clear!
    for (let x = 4; x <= 12; x++) for (let z = 5; z <= 13; z++) {
      const border = x === 4 || x === 12 || z === 5 || z === 13;
      at(x, fy + 1, z, border ? 'minecraft:red_wool' : 'minecraft:white_wool');
      if (border) {
        const corner = (x === 4 || x === 12) && (z === 5 || z === 13);
        if (corner) {
          at(x, fy + 2, z, 'minecraft:yellow_concrete');
          at(x, fy + 3, z, 'minecraft:glowstone');
        } else if (x !== 8 && z !== 9) {
          // Ring ropes with entry gaps on each side
          at(x, fy + 2, z, 'minecraft:crimson_fence');
        }
      }
    }
    // Yellow-and-red spectator benches on the left & back walls
    for (let z = 4; z <= 14; z += 2) at(1, fy + 1, z, 'minecraft:yellow_concrete');
    for (let x = 3; x <= 13; x += 2) at(x, fy + 1, SZ - 2, 'minecraft:red_concrete');
    // Center Floor 2 Boss Pad on the ring canvas
    at(8, fy + 1, 9, 'steveo:boss_pad_2');
  }

  // ---------- FLOOR 3 (y = 18): UPSIDE-DOWN SHADOW LAB (Super Rabbit Boss) ----------
  {
    const fy = BASE_Y + 2 * FLOOR_H;
    // Purple & magenta floor cross
    for (let i = 2; i <= 14; i++) {
      at(i, fy, CZ, 'minecraft:purple_concrete');
      at(CX, fy, i, 'minecraft:purple_concrete');
    }
    // Glowing amethyst & crying obsidian pillars
    for (const [px, pz] of [[3, 3], [3, 15], [13, 3], [13, 15]]) {
      at(px, fy + 1, pz, 'minecraft:crying_obsidian');
      at(px, fy + 2, pz, 'minecraft:amethyst_block');
      at(px, fy + 3, pz, 'minecraft:amethyst_block');
      at(px, fy + 4, pz, 'minecraft:crying_obsidian');
      at(px, fy + 5, pz, 'minecraft:sea_lantern');
    }
    // Lab consoles along the back wall
    for (const x of [5, 8, 11]) {
      at(x, fy + 1, SZ - 2, 'minecraft:obsidian');
      at(x, fy + 2, SZ - 2, 'minecraft:magenta_stained_glass');
    }
    at(CX, fy, CZ, 'steveo:boss_pad_3');
  }

  // ---------- FLOOR 4 (y = 25): ROCKET FORGE (Mega-Robo) ----------
  {
    const fy = BASE_Y + 3 * FLOOR_H;
    // Copper pipe columns & glass-enclosed lava vats along left and back walls
    for (const z of [4, 9, 14]) {
      at(1, fy + 1, z, 'minecraft:copper_block');
      at(1, fy + 2, z, lava);
      at(1, fy + 3, z, lava);
      at(1, fy + 4, z, 'minecraft:copper_block');
      at(2, fy + 1, z, 'minecraft:orange_stained_glass');
      at(2, fy + 2, z, 'minecraft:orange_stained_glass');
      at(2, fy + 3, z, 'minecraft:orange_stained_glass');
      at(2, fy + 4, z, 'minecraft:oxidized_copper');
    }
    // Forge anvils & blast furnaces at back wall
    for (const x of [5, 7, 9, 11]) {
      at(x, fy + 1, SZ - 2, x % 4 === 1 ? 'minecraft:blast_furnace' : 'minecraft:copper_block');
      at(x, fy + 2, SZ - 2, 'minecraft:iron_bars');
    }
    // Warning floor ring around the center pad
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
        at(CX + dx, fy, CZ + dz, (dx + dz) % 2 === 0 ? 'minecraft:orange_concrete' : 'minecraft:black_concrete');
      }
    }
    at(CX, fy, CZ, 'steveo:boss_pad_4');
  }

  // ---------- FLOOR 5 (y = 32): KING VIKING'S THRONE ROOM (King Viking) ----------
  {
    const fy = BASE_Y + 4 * FLOOR_H;
    // Royal orange & purple carpet leading to the throne
    for (let z = 3; z <= 14; z++) {
      at(CX - 1, fy, z, 'minecraft:purple_concrete');
      at(CX, fy, z, 'minecraft:orange_concrete');
      at(CX + 1, fy, z, 'minecraft:purple_concrete');
    }
    // Grand Viking Throne at back wall (z = SZ - 3..SZ - 2)
    for (let x = CX - 2; x <= CX + 2; x++) {
      at(x, fy + 1, SZ - 3, 'minecraft:polished_blackstone_bricks');
      for (let dy = 1; dy <= 5; dy++) at(x, fy + dy, SZ - 2, 'minecraft:polished_blackstone_bricks');
      at(x, fy + 5, SZ - 2, 'minecraft:gold_block');
    }
    // Armrests & giant white-quartz Viking horn sculptures flanking the throne!
    at(CX - 2, fy + 2, SZ - 3, 'minecraft:gold_block');
    at(CX + 2, fy + 2, SZ - 3, 'minecraft:gold_block');
    for (const side of [-1, 1]) {
      at(CX + side * 3, fy + 3, SZ - 2, 'minecraft:quartz_block');
      at(CX + side * 4, fy + 4, SZ - 2, 'minecraft:quartz_block');
      at(CX + side * 4, fy + 5, SZ - 2, 'minecraft:quartz_block');
    }
    // Shroomlight braziers flanking the throne room
    for (const [bx, bz] of [[3, 4], [3, 13], [14, 4], [14, 13]]) {
      at(bx, fy + 1, bz, 'minecraft:polished_blackstone_bricks');
      at(bx, fy + 2, bz, 'minecraft:gold_block');
      at(bx, fy + 3, bz, 'minecraft:shroomlight');
    }
    at(CX, fy, CZ, 'steveo:boss_pad_5');
  }

  writeStructure('behavior_pack/structures/steveo/boom_boom_factory.mcstructure', grid);
}
