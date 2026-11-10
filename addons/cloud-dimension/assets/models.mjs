// Generates the Cloud Dimension's 3D models: block geometry, mob geometry and
// animations, held-item attachables, and the palette textures they all map
// onto. Run from the repo root:
//   node addons/cloud-dimension/assets/models.mjs addons/cloud-dimension
// The generated output is what gets committed; this script is for
// regenerating it.
//
// The models were picked from the mockup page (cloud-dimension-models.html):
//   Cloud Portal   A  Sky Gate            Floatato     A  Angel (no face)
//   Cloud Block    A  Puffy               Charge       C  Spark Orb
//   Gust Pad       A  Fan Vent            Nimbus King  C  Breeze Emperor
//   Storm Altar    B  Cloud Throne Pillar Cloud Staff  C  Wind Orb Staff
//   Storm Crystal  A  Charged Shard
//
// Cubes are written as [x, y, z, w, h, d, paint, glow] in Bedrock pixels
// (16 to a block, y up, the front of a mob faces -z), the same shape the
// mockup uses, so a model can be compared against the page line by line.
//
// Texturing: every model gets its own atlas of 32×32 painted swatches, one
// per (paint, glow) pair it uses, and every cube face maps onto its swatch at
// 1:1 with a hashed offset, so neighbouring faces do not repeat the same
// pixels. Mobs and held items use the `entity_emissive_alpha` material, where
// a lower alpha makes a pixel glow, so glowing swatches are painted with a
// lower alpha (never below about half, so an alpha test cannot drop them).
// Blocks cannot glow that way; their glowing faces use a `glow` material
// instance with face dimming and ambient occlusion turned off instead.
//
// Block parts that spin or hover on the mockup are static here (block
// geometry does not animate); mob parts are driven by animations on
// query.life_time.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node addons/cloud-dimension/assets/models.mjs <addon dir>');

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function writeFile(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${file} (${data.length} bytes)`);
}
const writeJson = (rel, data) => writeFile(rel, JSON.stringify(data, null, 2) + '\n');

// ---------- paint ----------
const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sh = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Flat colour with a little noise. */
const speckle = (color, amount = 0.08, seed = 1) => (x, y) => sh(hex(color), 1 - amount / 2 + hash(x, y, seed) * amount);
/** Soft cloud: white with faint blue puffs. */
const puffy = (light, shade) => (x, y) => {
  const puff = (Math.sin(x * 0.55 + y * 0.3) + Math.cos(y * 0.5 - x * 0.2)) * 0.25 + 0.5;
  return mix(hex(light), hex(shade), Math.min(1, puff * 0.5 + hash(x, y, 2) * 0.3));
};
/** Metal: noisy with the odd bright sparkle. */
const metal = (color, seed = 3) => (x, y) => {
  const n = hash(x, y, seed);
  if (n > 0.96) return sh(hex(color), 1.25);
  return sh(hex(color), 0.86 + n * 0.2);
};
/** Potato skin: mottled, with dark eyes and a few pale scuffs. */
const potato = (skin, spot, shine) => (x, y) => {
  const n = hash(x, y, 7);
  const blob = hash(x >> 2, y >> 2, 8);
  if (blob > 0.9 && n < 0.5) return hex(spot);
  if (n < 0.06) return hex(spot);
  if (n > 0.93) return hex(shine);
  return mix(hex(skin), hex(spot), n * 0.3);
};
/** Wood grain running along y. */
const wood = (color) => (x, y) => sh(hex(color), 0.8 + hash(x, 0, 9) * 0.25 + (hash(x, y, 10) - 0.5) * 0.08);
/** Storm stone: dark, speckled, with darker veins. */
const storm = (color, dark) => (x, y) => {
  const vein = Math.abs(Math.sin(x * 0.8 + y * 1.7)) < 0.08;
  return vein ? hex(dark) : mix(hex(color), hex(dark), hash(x, y, 11) * 0.5);
};

const PAINTS = {
  quartz: speckle('#EEF1F6', 0.06, 1),
  quartzS: speckle('#C9D0DC', 0.08, 2),
  gold: metal('#F4C430', 3),
  goldD: metal('#B8860B', 4),
  sky: speckle('#7EC4F5', 0.1, 5),
  deep: speckle('#408ADE', 0.1, 6),
  cloud: puffy('#FAFCFF', '#D6E4F6'),
  cloudS: puffy('#E4EEF9', '#BFD3EA'),
  storm: storm('#5A6688', '#2C3450'),
  stormD: storm('#2C3450', '#1A2034'),
  bolt: speckle('#FFE65A', 0.08, 12),
  potato: potato('#C4965C', '#8C6438', '#DEBA82'),
  potatoD: speckle('#8C6438', 0.1, 13),
  golden: potato('#F4C430', '#B8860B', '#FFF0A0'),
  goldenD: speckle('#B8860B', 0.1, 14),
  wood: wood('#785A3C'),
  cyan: speckle('#8FF3FF', 0.06, 15),
  white: speckle('#FFFFFF', 0.04, 16),
  purple: speckle('#7E5FD0', 0.1, 17),
  steel: metal('#9AA4B4', 18),
};

const SWATCH = 32;
const COLUMNS = 4;

/**
 * Builds a texture atlas for `model`, assigning every (paint, glow) pair a
 * swatch, and returns the atlas plus a per-face UV function.
 * Glow lowers the alpha for `entity_emissive_alpha`; blocks keep alpha 255.
 */
function atlasFor(bones, { emissiveAlpha }) {
  const keys = [];
  const index = new Map();
  for (const bone of bones) {
    for (const cube of bone.cubes) {
      const key = `${cube[6]}|${cube[7] ?? 0}`;
      if (!index.has(key)) {
        index.set(key, keys.length);
        keys.push(key);
      }
    }
  }
  const rows = Math.ceil(keys.length / COLUMNS);
  const width = SWATCH * Math.min(COLUMNS, keys.length);
  const height = SWATCH * rows;
  const buf = Buffer.alloc(width * height * 4);
  keys.forEach((key, i) => {
    const [paint, glow] = key.split('|');
    const painter = PAINTS[paint];
    if (!painter) throw new Error(`unknown paint ${paint}`);
    const alpha = emissiveAlpha ? 255 - Math.round(Number(glow) * 110) : 255;
    const x0 = (i % COLUMNS) * SWATCH;
    const y0 = Math.floor(i / COLUMNS) * SWATCH;
    for (let y = 0; y < SWATCH; y++) {
      for (let x = 0; x < SWATCH; x++) {
        const [r, g, b] = painter(x, y);
        const o = ((y0 + y) * width + x0 + x) * 4;
        buf[o] = r;
        buf[o + 1] = g;
        buf[o + 2] = b;
        buf[o + 3] = alpha;
      }
    }
  });
  const origin = (key) => {
    const i = index.get(key);
    return [(i % COLUMNS) * SWATCH, Math.floor(i / COLUMNS) * SWATCH];
  };
  return { width, height, png: () => png(width, height, buf), origin };
}

// ---------- geometry ----------
const FACES = {
  north: (w, h, d) => [w, h],
  south: (w, h, d) => [w, h],
  east: (w, h, d) => [d, h],
  west: (w, h, d) => [d, h],
  up: (w, h, d) => [w, d],
  down: (w, h, d) => [w, d],
};

/** One mockup cube -> one Bedrock cube with per-face UVs onto its swatch. */
function toCube(cube, atlas, { blockGlow }, seed) {
  const [x, y, z, w, h, d, paint, glow = 0] = cube;
  const key = `${paint}|${glow}`;
  const [sx, sy] = atlas.origin(key);
  const uv = {};
  Object.entries(FACES).forEach(([face, size], f) => {
    const [fw, fh] = size(w, h, d);
    if (fw > SWATCH || fh > SWATCH) throw new Error(`face ${face} of ${JSON.stringify(cube)} is wider than a swatch`);
    const ox = Math.floor(hash(seed, f, 21) * (SWATCH - Math.ceil(fw) + 1));
    const oy = Math.floor(hash(seed, f, 22) * (SWATCH - Math.ceil(fh) + 1));
    uv[face] = { uv: [sx + ox, sy + oy], uv_size: [fw, fh] };
    if (blockGlow && glow > 0) uv[face].material_instance = 'glow';
  });
  return { origin: [x, y, z], size: [w, h, d], uv };
}

/**
 * bones: [{ name, parent?, pivot, rotation?, cubes, binding? }]
 * Returns a geometry file and the atlas (so the caller can write the PNG).
 */
function geometry(id, bones, opts) {
  const atlas = atlasFor(bones, opts);
  let seed = 0;
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const outBones = bones.map((bone) => {
    const b = { name: bone.name, pivot: bone.pivot ?? [0, 0, 0] };
    if (bone.parent) b.parent = bone.parent;
    if (bone.rotation) b.rotation = bone.rotation;
    if (bone.binding) b.binding = bone.binding;
    if (bone.cubes.length) {
      b.cubes = bone.cubes.map((c) => {
        for (let i = 0; i < 3; i++) {
          bounds.min[i] = Math.min(bounds.min[i], c[i]);
          bounds.max[i] = Math.max(bounds.max[i], c[i] + c[3 + i]);
        }
        return toCube(c, atlas, opts, seed++);
      });
    }
    return b;
  });
  const size = bounds.max.map((v, i) => v - bounds.min[i]);
  const file = {
    format_version: opts.formatVersion ?? '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: id,
          texture_width: atlas.width,
          texture_height: atlas.height,
          visible_bounds_width: Math.ceil(Math.max(size[0], size[2]) / 16) + 1,
          visible_bounds_height: Math.ceil(size[1] / 16) + 1,
          visible_bounds_offset: [0, Math.round(((bounds.min[1] + bounds.max[1]) / 32) * 100) / 100, 0],
        },
        bones: outBones,
      },
    ],
  };
  return { file, atlas, bounds };
}

// ---------- shapes (as on the mockup page) ----------
/** n cubes of size s on a flat ring (xz plane) of radius r at height y. */
function ring(r, y, n, s, paint, glow = 0, h = s) {
  const cubes = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    cubes.push([r2(Math.cos(a) * r - s / 2), y, r2(Math.sin(a) * r - s / 2), s, h, s, paint, glow]);
  }
  return cubes;
}
/** n cubes on an upright ring (xy plane) of radius r centred at (0, cy, z). */
function vring(r, cy, z, n, s, paint, glow = 0) {
  const cubes = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    cubes.push([r2(Math.cos(a) * r - s / 2), r2(cy + Math.sin(a) * r - s / 2), r2(z - s / 2), s, s, s, paint, glow]);
  }
  return cubes;
}
/** A zigzag lightning bolt going up from (x, y, z). */
function bolt(x, y, z, steps, paint = 'bolt', glow = 1, size = 1) {
  const cubes = [];
  let cx = x;
  for (let i = 0; i < steps; i++) {
    cubes.push([cx, y + i * 2 * size, z, size, 2 * size, size, paint, glow]);
    cx += i % 2 === 0 ? size : -size;
  }
  return cubes;
}
/** Four copies of a cube at the corners of a square of half-size h. */
function corners(h, y, w, height, paint, glow = 0) {
  return [[-h, -h], [h - w, -h], [-h, h - w], [h - w, h - w]].map(([x, z]) => [x, y, z, w, height, w, paint, glow]);
}
const r2 = (v) => Math.round(v * 100) / 100;
const deg = (rad) => r2((rad * 180) / Math.PI);

// ---------- animation expressions ----------
const spin = (radPerSec) => `query.life_time * ${deg(radPerSec)}`;
const bob = (amp, radPerSec) => `math.sin(query.life_time * ${deg(radPerSec)}) * ${amp}`;
const flap = (degrees, radPerSec, sign) => `${sign < 0 ? '-' : ''}math.sin(query.life_time * ${deg(radPerSec)}) * ${degrees}`;

// =====================================================================
// Mobs
// =====================================================================

// ---------- Floatato: Angel ----------
// The mockup body without its face (the texture carries the character
// instead), big three-layer feather wings, and a spinning golden halo.
// The golden Floatato is the same model with the gold texture.
function floatatoBones(skin, dark) {
  const bigWing = (sign) => [
    [sign > 0 ? 3 : -8, 6, -0.5, 5, 4, 1, 'cloud'],
    [sign > 0 ? 3 : -10, 8, -0.4, 7, 2, 0.8, 'white'],
    [sign > 0 ? 7 : -11, 9.5, -0.3, 4, 1.5, 0.6, 'cloudS'],
  ];
  return [
    { name: 'root', pivot: [0, 0, 0], cubes: [] },
    {
      name: 'body',
      parent: 'root',
      pivot: [0, 6, 0],
      cubes: [
        [-3, 3, -3, 6, 7, 6, skin],
        [-2.5, 2.5, -2.5, 5, 0.5, 5, dark],
        [-3.3, 5, -1, 0.3, 2, 2, dark],
        [2, 9.2, 1, 1, 0.8, 1, dark],
      ],
    },
    { name: 'wing_left', parent: 'body', pivot: [3, 7.5, 0], cubes: bigWing(1) },
    { name: 'wing_right', parent: 'body', pivot: [-3, 7.5, 0], cubes: bigWing(-1) },
    { name: 'halo', parent: 'root', pivot: [0, 12, 0], cubes: ring(2.6, 12, 12, 0.7, 'gold', 0.8) },
  ];
}
{
  const plain = geometry('geometry.steveo_floatato', floatatoBones('potato', 'potatoD'), { emissiveAlpha: true });
  // The golden texture must have the same layout, so it is painted from the
  // same bones with the gold paints swapped in; the swatch order is unchanged.
  const golden = geometry('geometry.steveo_floatato', floatatoBones('golden', 'goldenD'), { emissiveAlpha: true });
  writeJson('resource_pack/models/entity/floatato.geo.json', plain.file);
  writeFile('resource_pack/textures/entity/floatato/floatato.png', plain.atlas.png());
  writeFile('resource_pack/textures/entity/floatato/floatato_golden.png', golden.atlas.png());
  writeJson('resource_pack/animations/floatato.animation.json', {
    format_version: '1.8.0',
    animations: {
      'animation.steveo_floatato.float': {
        loop: true,
        bones: {
          root: { position: [0, bob(0.6, 2.2), 0] },
          wing_left: { rotation: [0, 0, flap(28, 7, 1)] },
          wing_right: { rotation: [0, 0, flap(28, 7, -1)] },
          halo: { rotation: [0, spin(2), 0] },
        },
      },
    },
  });
}

// ---------- Charge: Spark Orb ----------
// A glowing wind core with eyes, circled by three orbits of sparks. The
// tilted orbits are a static-rotation bone each with the spinning ring as
// its child, so the ring turns about its own tilted axis.
{
  const bones = [
    { name: 'root', pivot: [0, 0, 0], cubes: [] },
    {
      name: 'head',
      parent: 'root',
      pivot: [0, 10, 0],
      cubes: [
        [-3, 7, -3, 6, 6, 6, 'deep', 0.6],
        [-2, 9.5, -3.2, 1.2, 1.2, 0.3, 'white', 1],
        [0.8, 9.5, -3.2, 1.2, 1.2, 0.3, 'white', 1],
      ],
    },
    { name: 'ring_flat', parent: 'root', pivot: [0, 10, 0], cubes: ring(5, 9.5, 5, 1, 'bolt', 1) },
    { name: 'orbit_a', parent: 'root', pivot: [0, 10, 0], rotation: [50, 0, 0], cubes: [] },
    { name: 'ring_a', parent: 'orbit_a', pivot: [0, 10, 0], cubes: ring(5.5, 9.5, 5, 0.8, 'cyan', 1) },
    { name: 'orbit_b', parent: 'root', pivot: [0, 10, 0], rotation: [-50, 0, 0], cubes: [] },
    { name: 'ring_b', parent: 'orbit_b', pivot: [0, 10, 0], cubes: ring(6, 9.5, 5, 0.8, 'white', 1) },
  ];
  const g = geometry('geometry.steveo_charge', bones, { emissiveAlpha: true });
  writeJson('resource_pack/models/entity/charge.geo.json', g.file);
  writeFile('resource_pack/textures/entity/charge.png', g.atlas.png());
  writeJson('resource_pack/animations/charge.animation.json', {
    format_version: '1.8.0',
    animations: {
      'animation.steveo_charge.hover': {
        loop: true,
        bones: {
          head: { position: [0, bob(0.6, 2), 0] },
          ring_flat: { rotation: [0, spin(5), 0] },
          ring_a: { rotation: [0, spin(-4), 0] },
          ring_b: { rotation: [0, spin(3), 0] },
        },
      },
    },
  });
  writeJson('resource_pack/entity/charge.entity.json', clientEntity('steveo:charge', 'charge', 'animation.steveo_charge.hover', '#408ADE', '#FFE65A'));
}

// ---------- Nimbus King: Breeze Emperor ----------
// A cloud head with a gold visor and crown band, three gold rods orbiting
// it, a royal purple cape, and rings of wind below. The game scales it 3.5×.
{
  const bones = [
    { name: 'root', pivot: [0, 0, 0], cubes: [] },
    {
      name: 'body',
      parent: 'root',
      pivot: [0, 18, 0],
      cubes: [
        [-5, 9, 3.5, 10, 12, 0.6, 'purple'],
        [-5.5, 19, 3.2, 11, 1.5, 1, 'gold'],
      ],
    },
    {
      name: 'head',
      parent: 'body',
      pivot: [0, 18, 0],
      cubes: [
        [-4, 18, -4, 8, 8, 8, 'cloud'],
        [-4.2, 21, -4.3, 8.4, 2, 0.4, 'gold'],
        [-3, 21.4, -4.5, 2, 1.2, 0.3, 'cyan', 1],
        [1, 21.4, -4.5, 2, 1.2, 0.3, 'cyan', 1],
        [-4.3, 25, -4.3, 8.6, 1.5, 8.6, 'gold'],
        ...corners(4.3, 26.5, 1.5, 1.5, 'gold'),
      ],
    },
    {
      name: 'rods',
      parent: 'root',
      pivot: [0, 18, 0],
      cubes: [0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return [r2(Math.cos(a) * 8 - 0.75), 12, r2(Math.sin(a) * 8 - 0.75), 1.5, 10, 1.5, 'gold', 0.3];
      }),
    },
    { name: 'ring_top', parent: 'root', pivot: [0, 13, 0], cubes: ring(4, 13, 8, 1.3, 'cyan', 0.5) },
    { name: 'ring_mid', parent: 'root', pivot: [0, 8.5, 0], cubes: ring(2.6, 8.5, 8, 1.3, 'cyan', 0.5) },
    { name: 'ring_low', parent: 'root', pivot: [0, 4.5, 0], cubes: ring(1.4, 4.5, 8, 1.3, 'cyan', 0.5) },
  ];
  const g = geometry('geometry.steveo_nimbus_king', bones, { emissiveAlpha: true });
  writeJson('resource_pack/models/entity/nimbus_king.geo.json', g.file);
  writeFile('resource_pack/textures/entity/nimbus_king.png', g.atlas.png());
  writeJson('resource_pack/animations/nimbus_king.animation.json', {
    format_version: '1.8.0',
    animations: {
      'animation.steveo_nimbus_king.hover': {
        loop: true,
        bones: {
          body: { position: [0, bob(0.6, 1.4), 0] },
          rods: { rotation: [0, spin(1.8), 0] },
          ring_top: { rotation: [0, spin(-2.5), 0] },
          ring_mid: { rotation: [0, spin(3), 0] },
          ring_low: { rotation: [0, spin(-4), 0] },
        },
      },
    },
  });
  writeJson('resource_pack/entity/nimbus_king.entity.json', clientEntity('steveo:nimbus_king', 'nimbus_king', 'animation.steveo_nimbus_king.hover', '#F4F8FF', '#F4C430'));
}

function clientEntity(id, name, hoverAnimation, eggBase, eggOverlay) {
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: id,
        materials: { default: 'entity_emissive_alpha' },
        textures: { default: `textures/entity/${name}` },
        geometry: { default: `geometry.steveo_${name}` },
        animations: { hover: hoverAnimation, look_at_target: 'animation.common.look_at_target' },
        scripts: { animate: ['hover', 'look_at_target'] },
        render_controllers: [`controller.render.steveo_${name}`],
        spawn_egg: { base_color: eggBase, overlay_color: eggOverlay },
      },
    },
  };
}
writeJson('resource_pack/render_controllers/cloud_mobs.render_controllers.json', {
  format_version: '1.8.0',
  render_controllers: Object.fromEntries(
    ['charge', 'nimbus_king'].map((name) => [
      `controller.render.steveo_${name}`,
      { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] },
    ]),
  ),
});

// =====================================================================
// Blocks
// =====================================================================
// Block geometry must stay within 30×30×30 pixels around the block (x and z
// in -15..15, y in -7..23); everything below does. The mockup's spinning and
// hovering parts are placed at one moment of their motion.
const BLOCK = { emissiveAlpha: false, blockGlow: true, formatVersion: '1.16.0' };

function writeBlock(name, bones) {
  const g = geometry(`geometry.steveo_${name}`, bones, BLOCK);
  writeJson(`resource_pack/models/blocks/${name}.geo.json`, g.file);
  writeFile(`resource_pack/textures/blocks/${name}.png`, g.atlas.png());
}

// ---------- Cloud Portal: Sky Gate ----------
// A quartz-and-gold dais with an upright ring of sky above a glowing core.
writeBlock('cloud_portal', [
  {
    name: 'dais',
    pivot: [0, 0, 0],
    cubes: [
      [-8, 0, -8, 16, 4, 16, 'quartz'],
      [-8, 4, -8, 16, 1, 16, 'gold'],
      [-6, 5, -6, 12, 2, 12, 'quartzS'],
      [-4, 7, -4, 8, 0.5, 8, 'deep', 0.8],
      ...corners(8, 5, 2, 3, 'gold'),
    ],
  },
  { name: 'ring', pivot: [0, 14, 0], rotation: [0, 25, 0], cubes: vring(6, 14, 0, 14, 1.6, 'sky', 0.7) },
  { name: 'core', pivot: [0, 14, 0], cubes: [[-1.5, 12.5, -1.5, 3, 3, 3, 'cyan', 1]] },
]);

// ---------- Cloud Block: Puffy ----------
// A cube with soft lumps bulging from every face. Each bulge is its own bone
// so block culling rules can drop it, with the core face behind it, when a
// neighbour covers that side (see block_culling/cloud_block.json).
writeBlock('cloud_block', [
  { name: 'core', pivot: [0, 0, 0], cubes: [[-7, 1, -7, 14, 14, 14, 'cloud']] },
  { name: 'bulge_west', pivot: [0, 0, 0], cubes: [[-8, 3, -5, 1, 10, 10, 'cloud']] },
  { name: 'bulge_east', pivot: [0, 0, 0], cubes: [[7, 4, -6, 1, 9, 9, 'cloudS']] },
  { name: 'bulge_north', pivot: [0, 0, 0], cubes: [[-5, 3, -8, 10, 10, 1, 'cloud']] },
  { name: 'bulge_south', pivot: [0, 0, 0], cubes: [[-6, 4, 7, 9, 9, 1, 'cloudS']] },
  { name: 'bulge_up', pivot: [0, 0, 0], cubes: [[-5, 15, -4, 10, 1, 8, 'cloud'], [-4, 15, -6, 6, 1, 2, 'cloud']] },
  { name: 'bulge_down', pivot: [0, 0, 0], cubes: [[-6, 0, -6, 12, 1, 12, 'cloudS']] },
]);
{
  const DIRECTIONS = ['west', 'east', 'north', 'south', 'up', 'down'];
  const rules = [];
  for (const direction of DIRECTIONS) {
    for (const condition of ['default', 'same_culling_layer']) {
      rules.push({ geometry_part: { bone: `bulge_${direction}` }, direction, condition });
      rules.push({ geometry_part: { bone: 'core', cube: 0, face: direction }, direction, condition });
    }
  }
  writeJson('resource_pack/block_culling/cloud_block.json', {
    format_version: '1.21.90',
    'minecraft:block_culling_rules': {
      description: { identifier: 'steveo:cloud_block_culling' },
      rules,
    },
  });
}

// ---------- Gust Pad: Fan Vent ----------
// A steel frame with a fan and wind streaks rushing up out of it.
writeBlock('gust_pad', [
  {
    name: 'frame',
    pivot: [0, 0, 0],
    cubes: [
      [-8, 0, -8, 16, 3, 16, 'steel'],
      [-8, 3, -8, 16, 1, 2, 'gold'],
      [-8, 3, 6, 16, 1, 2, 'gold'],
      [-8, 3, -6, 2, 1, 12, 'gold'],
      [6, 3, -6, 2, 1, 12, 'gold'],
      [-6, 2.9, -6, 12, 0.3, 12, 'stormD'],
    ],
  },
  {
    name: 'fan',
    pivot: [0, 3.5, 0],
    rotation: [0, 30, 0],
    cubes: [
      [-6, 3.2, -1, 12, 0.5, 2, 'quartz'],
      [-1, 3.2, -6, 2, 0.5, 12, 'quartz'],
      [-1.5, 3.2, -1.5, 3, 1, 3, 'gold'],
    ],
  },
  {
    name: 'streaks',
    pivot: [0, 0, 0],
    cubes: [[-4, 5, -3], [3, 9, 2], [-1, 12, 4], [2, 7, -4]].map(([x, y, z]) => [x, y, z, 0.8, 3, 0.8, 'cyan', 0.8]),
  },
]);

// ---------- Storm Altar: Cloud Throne Pillar ----------
// A quartz pillar with gold bands, and a little storm cloud above that
// crackles lightning down into it.
writeBlock('storm_altar', [
  {
    name: 'pillar',
    pivot: [0, 0, 0],
    cubes: [
      [-4, 0, -4, 8, 11, 8, 'quartz'],
      [-5, 0, -5, 10, 2, 10, 'gold'],
      [-5, 9, -5, 10, 2, 10, 'gold'],
      [-1, 11, -1, 2, 0.5, 2, 'cyan', 1],
    ],
  },
  {
    name: 'cloud',
    pivot: [0, 15, 0],
    cubes: [
      [-6, 13.5, -5, 12, 4, 10, 'storm'],
      [-4, 17, -3, 8, 2, 6, 'storm'],
      [-7, 14, -3, 2, 2.5, 6, 'stormD'],
    ],
  },
  { name: 'bolt', pivot: [0, 0, 0], cubes: bolt(-0.5, 11.2, -0.5, 2, 'bolt', 1, 1) },
]);

// =====================================================================
// Held items (attachables)
// =====================================================================
// The root bone binds to the hand; the model is built with its grip at y 0
// so the hand holds it part-way up. The hold animations position it in the
// hand in first and third person.
//
// The cubes of a bound bone are in the player's model space, so a model built
// around the origin draws at the player's feet (the staff showed up between
// the legs, 2026-11-09). The third-person animation moves the grip to the
// right fist, which is at about [-6, 13, 0], and `hold` adds a tilt: a
// positive x rotation leans the top of the item forward.
const ITEM = { emissiveAlpha: true };
function writeAttachable(name, bones, grip, hold) {
  const shifted = bones.map((b) => ({
    ...b,
    pivot: b.pivot ? [b.pivot[0], r2(b.pivot[1] - grip), b.pivot[2]] : undefined,
    cubes: b.cubes.map((c) => [c[0], r2(c[1] - grip), ...c.slice(2)]),
  }));
  const all = [{ name: 'root', pivot: [0, 0, 0], binding: 'query.item_slot_to_bone_name(context.item_slot)', cubes: [] }, ...shifted.map((b) => ({ ...b, parent: b.parent ?? 'root' }))];
  const g = geometry(`geometry.steveo_${name}`, all, ITEM);
  writeJson(`resource_pack/models/entity/${name}.geo.json`, g.file);
  writeFile(`resource_pack/textures/entity/${name}.png`, g.atlas.png());
  writeJson(`resource_pack/animations/${name}.animation.json`, {
    format_version: '1.8.0',
    animations: {
      [`animation.steveo_${name}.first_person`]: { loop: true, bones: { root: { rotation: [90, 60, -40], position: [4, 1, 2] } } },
      [`animation.steveo_${name}.third_person`]: { loop: true, bones: { root: hold } },
    },
  });
  writeJson(`resource_pack/attachables/${name}.json`, {
    format_version: '1.10.0',
    'minecraft:attachable': {
      description: {
        identifier: `steveo:${name}`,
        materials: { default: 'entity_emissive_alpha', enchanted: 'entity_alphatest_glint' },
        textures: { default: `textures/entity/${name}`, enchanted: 'textures/misc/enchanted_item_glint' },
        geometry: { default: `geometry.steveo_${name}` },
        animations: {
          first_person: `animation.steveo_${name}.first_person`,
          third_person: `animation.steveo_${name}.third_person`,
        },
        scripts: { animate: [{ first_person: 'context.is_first_person' }, { third_person: '!context.is_first_person' }] },
        render_controllers: ['controller.render.item_default'],
      },
    },
  });
}

// ---------- Cloud Staff: Wind Orb Staff ----------
// A wooden staff whose gold claws hold a swirling wind orb, ringed by wind.
writeAttachable(
  'cloud_staff',
  [
    {
      name: 'staff',
      pivot: [0, 0, 0],
      cubes: [
        [-0.75, 0, -0.75, 1.5, 19, 1.5, 'wood'],
        [-1, 6, -1, 2, 1, 2, 'gold'],
        [-1.3, 18, -1.3, 2.6, 1.5, 2.6, 'gold'],
        ...[[-2.5, -0.5], [1.5, -0.5], [-0.5, -2.5], [-0.5, 1.5]].map(([x, z]) => [x, 19, z, 1, 5, 1, 'gold']),
      ],
    },
    {
      name: 'orb',
      pivot: [0, 22, 0],
      cubes: [
        [-2, 20, -2, 4, 4, 4, 'sky', 0.7],
        [-1, 21, -1, 2, 2, 2, 'white', 1],
      ],
    },
    { name: 'wind', pivot: [0, 22, 0], rotation: [0, 18, 0], cubes: ring(3.6, 21.5, 10, 0.6, 'white', 0.8) },
  ],
  8,
  // Upright in the fist like a walking staff, the orb leaning a little forward.
  { rotation: [20, 0, 0], position: [-6, 13, 0] },
);

// ---------- Storm Crystal: Charged Shard ----------
// A tall glowing crystal with a gold band, and sparks around it.
writeAttachable(
  'storm_crystal',
  [
    {
      name: 'crystal',
      pivot: [0, 7, 0],
      cubes: [
        [-1.5, 2, -1.5, 3, 9, 3, 'cyan', 0.6],
        [-1, 11, -1, 2, 2, 2, 'cyan', 0.8],
        [-1, 0.5, -1, 2, 1.5, 2, 'cyan', 0.6],
        [-2, 4, -2, 4, 1, 4, 'gold'],
      ],
    },
    { name: 'sparks', pivot: [0, 7, 0], rotation: [0, 20, 0], cubes: ring(4, 7, 4, 0.6, 'bolt', 1) },
  ],
  6,
  // Upright, just in front of the fist.
  { rotation: [0, 0, 0], position: [-6, 12, -2] },
);
