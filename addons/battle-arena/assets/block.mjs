// Generates the Battle Arena block's model and textures: the Altar of Blades.
// Run from the repo root:
//   node addons/battle-arena/assets/block.mjs addons/battle-arena
//
// A stepped stone dais with a gold trim, a cracked slab on top, and three
// swords driven point-first into it. Two looks, switched by the block's
// `steveo:active` state while a battle runs:
//   idle  geometry.steveo_battle_arena      + battle_arena.png (dull cracks)
//   lit   geometry.steveo_battle_arena_lit  + battle_arena_lit.png (glowing
//         cracks, red-hot blade edges) + a ring of flame tongues along the
//         gold trim, an animated flipbook (battle_arena_flame.png).
// Both geometries come from the same cube list below, so they cannot drift.
// It also renders the pack icon from the lit model.
// The generated output is what gets committed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node block.mjs <addon dir>');

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
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
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
function canvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  return {
    w, h, buf,
    set(x, y, [r, g, b], a = 255) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    },
    /** Fills a w×h region at (x0, y0) from painter(x, y, w, h) -> [r, g, b]. */
    region(x0, y0, rw, rh, painter) {
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) this.set(x0 + x, y0 + y, painter(x, y, rw, rh));
    },
    png: () => png(w, h, buf),
  };
}
function write(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${file} (${data.length} bytes)`);
}

// ---------- pixel art ----------
const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sh = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const paint = {
  stoneBrick(x, y) {
    const off = (Math.floor(y / 4) % 2) * 4;
    if (y % 4 === 3 || (x + off) % 8 === 7) return sh(hex('#55545c'), 0.9 + hash(x, y, 1) * 0.15);
    return sh(hex('#8a8992'), 0.85 + hash(x, y, 2) * 0.25);
  },
  gold(x, y, w, h) {
    const f = y === 0 ? 1.18 : y === h - 1 ? 0.72 : 0.92 + hash(x, y, 5) * 0.16;
    return sh(hex('#e3ae2f'), f);
  },
  darkBrick(x, y) {
    const off = (Math.floor(y / 4) % 2) * 4;
    if (y % 4 === 3 || (x + off) % 8 === 7) return hex('#1e1b22');
    return sh(hex('#423c48'), 0.85 + hash(x, y, 4) * 0.25);
  },
  darkStone(x, y) { return sh(hex('#3b3640'), 0.8 + hash(x, y, 3) * 0.35); },
  crackedSlab(lit) {
    return (x, y, w, h) => {
      const d1 = Math.abs(x - y), d2 = Math.abs(x + y - (w - 1));
      const crack = (d1 === 0 && hash(x, 0, 16) > 0.25) || (d2 === 0 && hash(0, y, 17) > 0.3)
        || (y === (h >> 1) && x > 1 && x < w - 2 && hash(x, 9, 18) > 0.5);
      if (crack) return lit ? mix(hex('#ff5a1f'), hex('#ffc04a'), hash(x, y, 40)) : hex('#a3301a');
      return paint.darkStone(x, y);
    };
  },
  blade(lit) {
    return (x, y) => (lit && x === 0 ? hex('#ff6a3a') : sh(hex('#c9ced6'), 0.9 + hash(x, y, 30) * 0.15));
  },
  wood(x, y) { return sh(hex('#4f321d'), 0.82 + hash(x, 0, 7) * 0.22); },
};

// ---------- atlas (64×64) ----------
// Regions, in pixels. Each cube face maps onto one of these at 1:1.
const R = {
  stone: [0, 0],      // 16×16
  gold: [16, 0],      // 16×16
  darkBrick: [32, 0], // 16×16
  darkStone: [48, 0], // 16×16
  slabTop: [0, 16],   // 10×10
  blade: [16, 16],    // 2×11 faces, 1×11 edges at [18,16], 2×1 ends at [16,27]
  bladeEdge: [18, 16],
  bladeEnd: [16, 27],
  wood: [32, 16],     // 16×16
};
function atlas(lit) {
  const c = canvas(64, 64);
  c.region(...R.stone, 16, 16, paint.stoneBrick);
  c.region(...R.gold, 16, 16, paint.gold);
  c.region(...R.darkBrick, 16, 16, paint.darkBrick);
  c.region(...R.darkStone, 16, 16, paint.darkStone);
  c.region(...R.slabTop, 10, 10, paint.crackedSlab(lit));
  c.region(...R.blade, 2, 11, paint.blade(lit));
  c.region(...R.bladeEdge, 1, 11, paint.blade(lit));
  c.region(...R.bladeEnd, 2, 1, paint.blade(false));
  c.region(...R.wood, 16, 16, paint.wood);
  return c;
}

// ---------- flame flipbook ----------
// Frames are 64×64 (flipbook frames are square, the width of the texture),
// stacked vertically. Only the bottom 8 rows hold flames: a row of tapered
// tongues about 4 pixels apart, yellow at the root to red at the tips.
const FRAMES = 8;
const FLAME_ROWS = 8;
function flames() {
  const c = canvas(64, 64 * FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    for (let x = 0; x < 64; x++) {
      const seg = Math.floor(x / 4);
      const cx = Math.abs((x % 4) + 0.5 - 2) / 2;
      const n = hash(seg, f, 33);
      const height = FLAME_ROWS * (0.5 + 0.5 * n) * Math.sqrt(Math.max(0, 1 - cx * cx * 0.85));
      for (let fromBottom = 0; fromBottom < FLAME_ROWS; fromBottom++) {
        if (fromBottom > height) continue;
        const k = fromBottom / Math.max(1, height);
        const col = k < 0.4 ? mix(hex('#fff2a0'), hex('#ffb12a'), k / 0.4) : mix(hex('#ffb12a'), hex('#e0381c'), (k - 0.4) / 0.6);
        c.set(x, f * 64 + 63 - fromBottom, col);
      }
    }
  }
  return c;
}

// ---------- geometry ----------
/** A cube with every face mapped 1:1 onto atlas regions: { all, side, up, down, north, ... }. */
function cube(origin, size, regions, extra = {}) {
  const [sx, sy, sz] = size;
  const dims = { north: [sx, sy], south: [sx, sy], east: [sz, sy], west: [sz, sy], up: [sx, sz], down: [sx, sz] };
  const uv = {};
  for (const face of Object.keys(dims)) {
    const at = regions[face] ?? (face === 'up' || face === 'down' ? regions.top ?? regions.all : regions.side ?? regions.all);
    if (!at) continue; // no region: the face is not drawn
    uv[face] = { uv: at, uv_size: dims[face], ...(regions.material ? { material_instance: regions.material } : {}) };
  }
  return { origin, size, uv, ...extra };
}

const SWORDS = [
  // pivot where the blade enters the dais, yaw about Y, tilt outward about X
  { at: [0, 6, -2], yaw: 0, tilt: -12 },
  { at: [1.8, 6, 1.2], yaw: 125, tilt: -14 },
  { at: [-1.8, 6, 1.2], yaw: 235, tilt: -10 },
];

function bones(lit) {
  const dais = {
    name: 'dais',
    pivot: [0, 0, 0],
    cubes: [
      cube([-8, 0, -8], [16, 3, 16], { all: R.stone }),
      cube([-8, 3, -8], [16, 1, 16], { all: R.gold }),
      cube([-6, 4, -6], [12, 3, 12], { all: R.darkBrick }),
      cube([-5, 7, -5], [10, 2, 10], { side: R.darkStone, down: R.darkStone, up: R.slabTop }),
    ],
  };
  const list = [dais];
  SWORDS.forEach(({ at: [px, py, pz], yaw, tilt }, i) => {
    // Yaw on the outer bone, tilt on the inner one, so the tilt leans the
    // sword away from the centre in its own facing.
    list.push({ name: `sword${i}_yaw`, parent: 'dais', pivot: [px, py, pz], rotation: [0, yaw, 0] });
    list.push({
      name: `sword${i}`,
      parent: `sword${i}_yaw`,
      pivot: [px, py, pz],
      rotation: [tilt, 0, 0],
      cubes: [
        cube([px - 1, py, pz - 0.5], [2, 11, 1], { north: R.blade, south: R.blade, east: R.bladeEdge, west: R.bladeEdge, top: R.bladeEnd }),
        cube([px - 3, py + 11, pz - 1], [6, 1, 2], { all: R.gold }),
        cube([px - 0.5, py + 12, pz - 0.5], [1, 4, 1], { all: R.wood }),
        cube([px - 1, py + 16, pz - 1], [2, 1.5, 2], { all: R.gold }),
      ],
    });
  });
  if (lit) {
    // Flame tongues on the gold trim's exposed ledge, all four sides. Only
    // the side faces are drawn: a drawn top face would show as a flat strip.
    const strip = (w) => ({ uv: [0, 64 - FLAME_ROWS], size: [w, FLAME_ROWS] });
    const flame = (origin, size) => {
      const [sx, , sz] = size;
      const face = (w) => ({ uv: strip(w).uv, uv_size: [w, FLAME_ROWS], material_instance: 'flame' });
      return { origin, size, uv: { north: face(sx), south: face(sx), east: face(sz), west: face(sz) } };
    };
    list.push({
      name: 'flames',
      parent: 'dais',
      pivot: [0, 0, 0],
      cubes: [
        flame([-8, 4, -8], [16, FLAME_ROWS, 2]),
        flame([-8, 4, 6], [16, FLAME_ROWS, 2]),
        flame([-8, 4, -6], [2, FLAME_ROWS, 12]),
        flame([6, 4, -6], [2, FLAME_ROWS, 12]),
      ],
    });
  }
  return list;
}

function geometry(id, lit) {
  return {
    format_version: '1.16.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: id,
          texture_width: 64,
          texture_height: 64,
          visible_bounds_width: 2,
          visible_bounds_height: 2.5,
          visible_bounds_offset: [0, 0.75, 0],
        },
        bones: bones(lit),
      },
    ],
  };
}

// ---------- pack icon: the lit model, rendered ----------
// A small orthographic rasteriser over the same geometry the game draws,
// from above the north-west corner. Rotation conventions are this script's
// own (yaw about Y, then tilt about X), so the sword lean is indicative.
function rot([rx, ry, rz], p) {
  const r = (d) => (d * Math.PI) / 180;
  let [x, y, z] = p;
  // tilt (X) first, then yaw (Y): the bones here only ever use one axis each
  if (rx) { const c = Math.cos(r(rx)), s = Math.sin(r(rx)); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (ry) { const c = Math.cos(r(ry)), s = Math.sin(r(ry)); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (rz) { const c = Math.cos(r(rz)), s = Math.sin(r(rz)); [x, y] = [x * c - y * s, x * s + y * c]; }
  return [x, y, z];
}
function icon(geo, textures) {
  const byName = Object.fromEntries(geo.bones.map((b) => [b.name, b]));
  const toModel = (bone, p) => {
    for (let b = bone; b; b = b.parent ? byName[b.parent] : undefined) {
      if (!b.rotation) continue;
      const q = rot(b.rotation, [p[0] - b.pivot[0], p[1] - b.pivot[1], p[2] - b.pivot[2]]);
      p = [q[0] + b.pivot[0], q[1] + b.pivot[1], q[2] + b.pivot[2]];
    }
    return p;
  };
  const f = [1, -0.9, 1].map((v) => v / Math.hypot(1, 0.9, 1));        // view direction
  const right = [-f[2], 0, f[0]].map((v) => v / Math.hypot(f[2], f[0]));
  const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const light = [-0.4, 0.85, -0.35];
  const tris = [];
  for (const bone of geo.bones) {
    for (const c of bone.cubes ?? []) {
      const [x0, y0, z0] = c.origin, [x1, y1, z1] = c.origin.map((v, i) => v + c.size[i]);
      const corners = {
        north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
        south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
        east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
        west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
        up: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
        down: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
      };
      for (const [face, m] of Object.entries(c.uv)) {
        const pts = corners[face].map((p) => toModel(bone, p));
        const [u, v] = m.uv, [w, h] = m.uv_size;
        const uvs = [[u, v], [u + w, v], [u + w, v + h], [u, v + h]];
        const e1 = pts[1].map((a, i) => a - pts[0][i]), e2 = pts[3].map((a, i) => a - pts[0][i]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nl = Math.hypot(...n) || 1;
        const shade = 0.55 + 0.45 * Math.abs(dot(n, light) / nl / Math.hypot(...light));
        const tex = textures[m.material_instance ?? '*'];
        tris.push([pts[0], pts[1], pts[2], uvs[0], uvs[1], uvs[2], tex, shade]);
        tris.push([pts[0], pts[2], pts[3], uvs[0], uvs[2], uvs[3], tex, shade]);
      }
    }
  }
  const S = 128, scale = 3.3, cy = 74;
  const proj = (p) => [S / 2 + dot(p, right) * scale, cy - dot(p, up) * scale, dot(p, f)];
  const c = canvas(S, S);
  const depth = new Float32Array(S * S).fill(Infinity);
  for (const [a, b, d, ua, ub, ud, tex, shade] of tris) {
    const A = proj(a), B = proj(b), D = proj(d);
    const area = (B[0] - A[0]) * (D[1] - A[1]) - (D[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(area) < 1e-6) continue;
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], D[0]))), maxX = Math.min(S - 1, Math.ceil(Math.max(A[0], B[0], D[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], D[1]))), maxY = Math.min(S - 1, Math.ceil(Math.max(A[1], B[1], D[1])));
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const X = px + 0.5, Y = py + 0.5;
      const w1 = ((X - A[0]) * (D[1] - A[1]) - (D[0] - A[0]) * (Y - A[1])) / area;
      const w2 = ((B[0] - A[0]) * (Y - A[1]) - (X - A[0]) * (B[1] - A[1])) / area;
      const w0 = 1 - w1 - w2;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * A[2] + w1 * B[2] + w2 * D[2];
      const i = py * S + px;
      if (z >= depth[i]) continue;
      const tu = Math.min(tex.w - 1, Math.max(0, Math.floor(w0 * ua[0] + w1 * ub[0] + w2 * ud[0] - 1e-4)));
      const tv = Math.min(tex.h - 1, Math.max(0, Math.floor(w0 * ua[1] + w1 * ub[1] + w2 * ud[1] - 1e-4)));
      const ti = (tv * tex.w + tu) * 4;
      if (tex.buf[ti + 3] < 128) continue;
      depth[i] = z;
      const lit = tex.glow ? 1 : shade;
      c.set(px, py, [tex.buf[ti] * lit, tex.buf[ti + 1] * lit, tex.buf[ti + 2] * lit].map(Math.round));
    }
  }
  return c;
}

const litAtlas = atlas(true);
const flameStrip = flames();
write('resource_pack/textures/blocks/battle_arena.png', atlas(false).png());
write('resource_pack/textures/blocks/battle_arena_lit.png', litAtlas.png());
write('resource_pack/textures/blocks/battle_arena_flame.png', flameStrip.png());
const json = (o) => Buffer.from(JSON.stringify(o, null, 2) + '\n');
write('resource_pack/models/blocks/battle_arena.geo.json', json(geometry('geometry.steveo_battle_arena', false)));
write('resource_pack/models/blocks/battle_arena_lit.geo.json', json(geometry('geometry.steveo_battle_arena_lit', true)));
const firstFrame = { w: 64, h: 64, buf: flameStrip.buf.subarray(0, 64 * 64 * 4), glow: true };
const packIcon = icon(geometry('', true)['minecraft:geometry'][0], { '*': litAtlas, flame: firstFrame }).png();
write('behavior_pack/pack_icon.png', packIcon);
write('resource_pack/pack_icon.png', packIcon);
