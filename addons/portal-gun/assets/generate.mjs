// Generates the portal textures, the gun icon, and the pack icons for this add-on.
// Run from the repo root:  node addons/portal-gun/assets/generate.mjs addons/portal-gun
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

const PALETTES = {
  blue: { edge: hex('#8FE3FF'), ring: hex('#1FA8FF'), inner: hex('#0B4C9C'), core: hex('#050B1A') },
  orange: { edge: hex('#FFD48A'), ring: hex('#FF8A1F'), inner: hex('#A23E05'), core: hex('#1A0902') },
};

// ---------- Portal ovals ----------
// Each portal texture is 32×32: the wall oval (16×32) at [0,0] and the round
// floor/ceiling disc (16×16) at [16,0]. Alpha stays above ~140 on every
// visible texel so an alpha-test fallback still draws the whole shape.
function paintOval(c, ox, oy, w, h, pal, seed) {
  const rx = w / 2, ry = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - rx) / rx;
      const dy = (y + 0.5 - ry) / ry;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 1) continue;
      const angle = Math.atan2(dy, dx);
      // A faint spiral so the interior reads as swirling rather than flat.
      const swirl = Math.sin(angle * 2 + r * 9 + seed) > 0.75;
      let color, alpha;
      if (r > 0.82) { color = mix(pal.ring, pal.edge, (r - 0.82) / 0.18); alpha = 255; }
      else if (r > 0.6) { color = mix(pal.inner, pal.ring, (r - 0.6) / 0.22); alpha = 230; }
      else { color = swirl ? mix(pal.core, pal.inner, 0.6) : pal.core; alpha = swirl ? 210 : 185; }
      c.set(ox + x, oy + y, color, alpha);
    }
  }
}

function paintPortal(name) {
  const pal = PALETTES[name];
  const c = canvas(32, 32);
  paintOval(c, 0, 0, 16, 32, pal, name === 'blue' ? 0 : 1.7);
  paintOval(c, 16, 0, 16, 16, pal, name === 'blue' ? 0.4 : 2.1);
  return c.png();
}

// ---------- Gun icon: 16×16 ----------
function paintGunIcon() {
  const rows = [
    '................',
    '................',
    '......WWWWWWW...',
    '....WWWWWWWWWWB.',
    '...WWWWGGGWWWWBB',
    '..WWWWGGGGGWWWWB',
    '..WWWWWGGGWWWWW.',
    '...WWWWWWWWWWWO.',
    '....DDDDWWWWWOO.',
    '.....DDDDDWWWO..',
    '......DDDDD.....',
    '......DDDD......',
    '.......DDD......',
    '.......DD.......',
    '................',
    '................',
  ];
  const colors = {
    W: hex('#E9EDF2'), D: hex('#3B4048'), G: hex('#8C97A6'),
    B: PALETTES.blue.ring, O: PALETTES.orange.ring,
  };
  const c = canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = colors[rows[y][x]];
    if (col) c.set(x, y, col);
  }
  return c.png();
}

// ---------- Pack icon: 128×128 ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  const bg = hex('#1B1F27');
  const border = hex('#2C333F');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const edge = x < 4 || y < 4 || x >= S - 4 || y >= S - 4;
    c.set(x, y, edge ? border : bg);
  }
  paintOval(c, 18, 24, 36, 80, PALETTES.blue, 0);
  paintOval(c, 74, 24, 36, 80, PALETTES.orange, 1.7);
  return c.png();
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
fs.mkdirSync(path.join(rp, 'textures', 'entity'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'portal_blue.png'), paintPortal('blue'));
fs.writeFileSync(path.join(rp, 'textures', 'entity', 'portal_orange.png'), paintPortal('orange'));
fs.writeFileSync(path.join(rp, 'textures', 'items', 'portal_gun.png'), paintGunIcon());
const icon = paintPackIcon();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(out, 'behavior_pack', 'pack_icon.png'), icon);
console.log('wrote portal textures, gun icon, and pack icons to', out);
