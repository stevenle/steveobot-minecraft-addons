// Generates the Uncrafting Table textures (16×16 top/side/bottom) and the
// 128×128 pack icons. Run from the repo root:
//   node addons/uncrafting/assets/generate.mjs addons/uncrafting
// The generated output is what gets committed; this script is for regenerating it.
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
    fill(x0, y0, w0, h0, col, a = 255) {
      for (let y = y0; y < y0 + h0; y++) for (let x = x0; x < x0 + w0; x++) this.set(x, y, col, a);
    },
    png: () => png(w, h, buf),
  };
}
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(a, b, t) { return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)); }
function shade(col, f) { return col.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))); }

function write(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${file} (${data.length} bytes)`);
}

// ---------- palette ----------
// Dark oak planks with an amethyst-purple work surface: a crafting table run
// in reverse.
const PLANK = hex('#5a3a22');
const PLANK_DARK = hex('#3e2716');
const PLANK_LIGHT = hex('#71492b');
const PURPLE = hex('#8a4fb8');
const PURPLE_DARK = hex('#5b2f80');
const PURPLE_LIGHT = hex('#c08ae6');
const IRON = hex('#d8d8d8');
const IRON_DARK = hex('#8f8f8f');
const HANDLE = hex('#8a6237');

/** Horizontal planks with seams every 4 rows and a little grain. */
function planks(c) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const seam = y % 4 === 3;
      const grain = (x * 7 + y * 3) % 11 === 0;
      const end = (y >> 2) % 2 === 0 ? x === 5 : x === 12;
      c.set(x, y, seam || end ? PLANK_DARK : grain ? PLANK_LIGHT : PLANK);
    }
  }
}

/** A frame of iron around the edge, like the crafting table's rim. */
function rim(c) {
  for (let i = 0; i < 16; i++) {
    c.set(i, 0, IRON_DARK); c.set(i, 15, IRON_DARK);
    c.set(0, i, IRON_DARK); c.set(15, i, IRON_DARK);
  }
}

// ---------- top: a 3×3 grid with an arrow curling back ----------
function top() {
  const c = canvas(16, 16);
  planks(c);
  c.fill(2, 2, 12, 12, PURPLE_DARK);
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) c.fill(3 + gx * 4, 3 + gy * 4, 3, 3, PURPLE);
  }
  // Counter-clockwise arrow around the centre cell: down the left, along the
  // bottom, up the right, with the head pointing left along the top.
  const arrow = [
    [5, 5], [5, 6], [5, 7], [5, 8], [5, 9], [5, 10],
    [6, 10], [7, 10], [8, 10], [9, 10], [10, 10],
    [10, 9], [10, 8], [10, 7], [10, 6], [10, 5],
    [9, 5], [8, 5], [7, 5],
    [8, 4], [8, 6],
  ];
  for (const [x, y] of arrow) c.set(x, y, PURPLE_LIGHT);
  rim(c);
  return c;
}

// ---------- side: a pickaxe taken apart, head and handle split ----------
function side() {
  const c = canvas(16, 16);
  planks(c);
  c.fill(1, 1, 14, 14, PLANK);
  for (let y = 1; y < 15; y++) if (y % 4 === 3) c.fill(1, y, 14, 1, PLANK_DARK);
  // Pickaxe head, lifted away from the handle.
  const head = [[3, 3], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 3]];
  for (const [x, y] of head) c.set(x, y, IRON);
  for (const [x, y] of [[4, 3], [11, 3], [7, 3], [8, 3]]) c.set(x, y, IRON_DARK);
  // Handle, standing on its own below the gap.
  for (let y = 6; y < 14; y++) { c.set(7, y, HANDLE); c.set(8, y, shade(HANDLE, 0.75)); }
  // Purple sparks in the gap: the uncrafting.
  for (const [x, y] of [[6, 4], [9, 4], [7, 5], [8, 4], [5, 5], [10, 5]]) c.set(x, y, PURPLE_LIGHT);
  rim(c);
  return c;
}

// ---------- bottom: plain planks ----------
function bottom() {
  const c = canvas(16, 16);
  planks(c);
  return c;
}

/** Nearest-neighbour upscale for the pack icon, on a purple backdrop. */
function icon(src) {
  const c = canvas(128, 128);
  c.fill(0, 0, 128, 128, PURPLE_DARK);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const col = [src.buf[i], src.buf[i + 1], src.buf[i + 2]];
      c.fill(8 + x * 7, 8 + y * 7, 7, 7, col);
    }
  }
  return c;
}

const topTex = top();
write('resource_pack/textures/blocks/uncrafting_table_top.png', topTex.png());
write('resource_pack/textures/blocks/uncrafting_table_side.png', side().png());
write('resource_pack/textures/blocks/uncrafting_table_bottom.png', bottom().png());
const packIcon = icon(topTex).png();
write('behavior_pack/pack_icon.png', packIcon);
write('resource_pack/pack_icon.png', packIcon);
