// Generates the snitch entity texture, the item icon, and the pack icons for this add-on.
// Run from the repo root:  node addons/golden-snitch/assets/generate.mjs addons/golden-snitch
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

const GOLD = {
  shadow: hex('#8A5A0A'),
  dark: hex('#C08A14'),
  mid: hex('#E8B92A'),
  light: hex('#FFD84A'),
  glint: hex('#FFF6B0'),
};
const WING = {
  edge: hex('#B9BCCB'),
  body: hex('#E9EBF4'),
  vein: hex('#D0D3E0'),
};

// A shaded gold ball of radius `r` centered at (cx, cy), lit from the upper left.
function paintBall(c, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / r;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) continue;
      // Distance from the highlight, which sits up and to the left of center.
      const hx = dx + 0.4, hy = dy + 0.4;
      const h = Math.sqrt(hx * hx + hy * hy);
      let color;
      if (d > 0.88) color = GOLD.shadow;
      else if (h < 0.22) color = GOLD.glint;
      else if (h < 0.55) color = mix(GOLD.light, GOLD.mid, (h - 0.22) / 0.33);
      else color = mix(GOLD.mid, GOLD.dark, Math.min(1, (h - 0.55) / 0.5));
      c.set(x, y, color);
    }
  }
}

// ---------- Entity atlas: 32×16 ----------
// [0,0] 4×4 ball side, [4,0] 4×4 ball top, [0,4] 4×4 ball bottom,
// [8,0] 7×4 left wing (tip on the left), [16,0] 7×4 right wing (tip on the right).
const WING_MASK = [
  '.######',
  '#######',
  '######.',
  '.####..',
];
function paintWing(c, ox, oy, tipOnLeft) {
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 7; x++) {
      // Mask is written with the root on the left; flip for a wing whose tip is on the left.
      const mx = tipOnLeft ? 6 - x : x;
      if (WING_MASK[y][mx] !== '#') continue;
      const edge =
        y === 0 || y === 3 || WING_MASK[y - 1]?.[mx] !== '#' || WING_MASK[y + 1]?.[mx] !== '#' ||
        WING_MASK[y][mx - 1] !== '#' || WING_MASK[y][mx + 1] !== '#';
      const vein = !edge && (mx + y) % 2 === 0;
      c.set(ox + x, oy + y, edge ? WING.edge : vein ? WING.vein : WING.body);
    }
  }
}
function paintEntityAtlas() {
  const c = canvas(32, 16);
  const side = [
    [GOLD.dark, GOLD.mid, GOLD.mid, GOLD.dark],
    [GOLD.mid, GOLD.glint, GOLD.light, GOLD.mid],
    [GOLD.mid, GOLD.light, GOLD.mid, GOLD.dark],
    [GOLD.dark, GOLD.mid, GOLD.dark, GOLD.shadow],
  ];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      c.set(x, y, side[y][x]);
      c.set(4 + x, y, mix(side[y][x], GOLD.glint, 0.35));
      c.set(x, 4 + y, mix(side[y][x], GOLD.shadow, 0.45));
    }
  }
  paintWing(c, 8, 0, true);
  paintWing(c, 16, 0, false);
  return c.png();
}

// ---------- Item icon: 16×16 ----------
function paintItemIcon() {
  const c = canvas(16, 16);
  // Wings: a 5-wide feather either side of the ball, on rows 5-9.
  const wing = [
    '.####',
    '#####',
    '####.',
    '.###.',
    '..#..',
  ];
  for (let y = 0; y < wing.length; y++) {
    for (let x = 0; x < 5; x++) {
      if (wing[y][x] !== '#') continue;
      const edge = y === 0 || y === wing.length - 1 || wing[y - 1]?.[x] !== '#' || wing[y + 1]?.[x] !== '#' || x === 0 || wing[y][x - 1] !== '#';
      const color = edge ? WING.edge : (x + y) % 2 ? WING.vein : WING.body;
      c.set(5 - x, 5 + y, color); // left wing, tip outward
      c.set(10 + x, 5 + y, color); // right wing
    }
  }
  paintBall(c, 8, 8, 3.2);
  return c.png();
}

// ---------- Pack icon: 128×128 ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const top = hex('#3B0D0D'), bottom = hex('#160404');
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) c.set(x, y, mix(top, bottom, y / S));
  }
  // A trail of embers curling up from the lower left toward the snitch.
  const ember = hex('#FF7A1A'), emberHot = hex('#FFD02A');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const x = 14 + t * 48 + Math.sin(t * 9) * 8;
    const y = 112 - t * 44 + Math.cos(t * 7) * 6;
    const r = 1.5 + (1 - t) * 3;
    const color = mix(ember, emberHot, rnd());
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) c.set(Math.round(x + dx), Math.round(y + dy), color);
      }
    }
  }
  // Wings: two tapered feathers spread either side of the ball.
  const cx = 74, cy = 60, r = 20;
  for (let side of [-1, 1]) {
    for (let i = 0; i < 44; i++) {
      const t = i / 44;
      const half = Math.round(9 * (1 - t * t) + 1);
      const x = cx + side * (r - 2 + i);
      const yc = cy - 6 - t * 10;
      for (let dy = -half; dy <= half; dy++) {
        const edge = Math.abs(dy) >= half - 1;
        const vein = !edge && (i + dy) % 4 === 0;
        c.set(Math.round(x), Math.round(yc + dy), edge ? WING.edge : vein ? WING.vein : WING.body);
      }
    }
  }
  paintBall(c, cx, cy, r);
  return c.png();
}

const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'entity'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'snitch.png'), paintEntityAtlas());
fs.writeFileSync(path.join(rp, 'textures', 'items', 'golden_snitch.png'), paintItemIcon());
const icon = paintPackIcon();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote snitch texture, item icon, and pack icons to', out);
