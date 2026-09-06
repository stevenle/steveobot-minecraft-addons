// Generates the item icon, the frost particle texture, and the pack icons for this add-on.
// Run from the repo root:  node addons/freezeray-gun/assets/generate.mjs addons/freezeray-gun
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

// ---------- Palette ----------
const P = {
  steel: hex('#5B6470'),
  steelLight: hex('#8B96A5'),
  steelDark: hex('#2F353D'),
  ice: hex('#7FD8F5'),
  iceLight: hex('#D6F6FF'),
  iceDark: hex('#2E8FB8'),
  grip: hex('#3A2F2A'),
  gripLight: hex('#5A4A40'),
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

// ---------- Item icon: a ray gun with a glowing ice tank on top ----------
function gunRows() {
  return [
    '................',
    '......iII.......',
    '.....iIIIi......',
    '.....IiIII......',
    '.....dIIId......',
    '..sSSSdddSSSSSl.',
    '.sSSSSSSSSSSSSSL',
    '.sSDDDDDDDSSSSSl',
    '..DDDDDDDDDDDD..',
    '......DGGD......',
    '......gGGg......',
    '......gGGg......',
    '.....gGGGg......',
    '.....gGGg.......',
    '.....gGg........',
    '................',
  ];
}

function paintGun() {
  return paintRows(gunRows(), {
    s: P.steelLight, S: P.steel, D: P.steelDark, l: P.iceLight, L: P.ice,
    i: P.iceLight, I: P.ice, d: P.iceDark, G: P.grip, g: P.gripLight,
  });
}

// ---------- Particle: 8x8 soft frost mote ----------
function paintFrost() {
  const c = canvas(8, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const dx = x + 0.5 - 4;
    const dy = y + 0.5 - 4;
    const r = Math.sqrt(dx * dx + dy * dy) / 4;
    if (r > 1) continue;
    const col = mix(P.iceLight, P.ice, Math.min(1, r * 1.2));
    // Keep alpha above ~128 so an alpha-test fallback still shows the mote.
    const alpha = r < 0.5 ? 255 : Math.round(255 - (r - 0.5) * 2 * 110);
    c.set(x, y, col, alpha);
  }
  return c;
}

// ---------- Pack icon: 128x128 snowflake on a dark ground ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const bg = hex('#101B2A');
  const border = hex('#1E3247');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : bg);
  }
  const cx = 64, cy = 64;
  // Soft glow behind the flake.
  for (let y = 4; y < S - 4; y++) for (let x = 4; x < S - 4; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < 46) c.set(x, y, mix(bg, P.iceDark, (1 - d / 46) * 0.45));
  }
  const dot = (px, py, radius, color) => {
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      if (ox * ox + oy * oy <= radius * radius) c.set(Math.round(px + ox), Math.round(py + oy), color);
    }
  };
  const line = (x0, y0, angle, len, radius, color) => {
    for (let t = 0; t <= len; t += 0.5) dot(x0 + Math.cos(angle) * t, y0 + Math.sin(angle) * t, radius, color);
  };
  // Six arms, each with two pairs of branches.
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    line(cx, cy, a, 44, 2, P.ice);
    for (const [at, blen] of [[18, 14], [30, 10]]) {
      const bx = cx + Math.cos(a) * at;
      const by = cy + Math.sin(a) * at;
      for (const side of [-1, 1]) line(bx, by, a + side * (Math.PI / 3), blen, 1, P.ice);
    }
    line(cx, cy, a, 44, 0, P.iceLight);
  }
  dot(cx, cy, 4, P.iceLight);
  return c;
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'particle'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'items', 'freezeray_gun.png'), paintGun().png());
fs.writeFileSync(path.join(rp, 'textures', 'particle', 'frost.png'), paintFrost().png());
const icon = paintPackIcon().png();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote item icon, frost texture, and pack icons to', out);
