// Generates the Uncrafting Table textures (16×16 top/side/bottom, after the
// Twilight Forest table) and the 128×128 pack icons, an isometric render of
// the block. Run from the repo root:
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
// The Twilight Forest look: a red cloth with a 3×3 grid laid over a purple
// table, draping down each side to a point, on grey stone legs.
const PALETTE = {
  K: hex('#1b0d17'), // outline
  P: hex('#4b2575'), // purple
  p: hex('#331650'), // purple, shadowed
  Q: hex('#5e3290'), // purple, lit
  R: hex('#b32222'), // cloth
  r: hex('#8a1818'), // cloth, shadowed
  H: hex('#c93434'), // cloth, lit
  D: hex('#3a0c18'), // cloth hem
  S: hex('#2a1236'), // centre post
  G: hex('#c6c6c6'), // stone
  g: hex('#a2a2a2'), // stone, shadowed
  h: hex('#7c7c7c'), // stone seam
};

/** A 16×16 texture from 16 strings of palette letters. */
function sprite(rows) {
  if (rows.length !== 16 || rows.some((row) => row.length !== 16)) throw new Error('sprites are 16×16');
  const c = canvas(16, 16);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const col = PALETTE[ch];
    if (!col) throw new Error(`unknown palette letter ${ch}`);
    c.set(x, y, col);
  }));
  return c;
}

// ---------- top: the cloth and its grid ----------
function top() {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      // Distance into the nearest corner, for the purple corner triangles.
      const cx = Math.min(x, 15 - x);
      const cy = Math.min(y, 15 - y);
      const inGrid = x >= 3 && x <= 12 && y >= 3 && y <= 12;
      const gridLine = inGrid && ((x - 3) % 3 === 0 || (y - 3) % 3 === 0);
      if (cx + cy <= 2) row += cx + cy === 0 ? 'K' : cx + cy === 1 ? 'Q' : 'P';
      else if (cx + cy === 3) row += 'K';
      else if (gridLine) row += 'K';
      else if (inGrid) row += 'H';
      else if (cx === 0 || cy === 0) row += 'r';
      else if (cx === 2 || cy === 2) row += 'r';
      else row += 'R';
    }
    rows.push(row);
  }
  return sprite(rows);
}

// ---------- side: purple, the cloth draping to a point, stone below ----------
function side() {
  return sprite([
    'KRRRRRRRRRRRRRRK',
    'KPRRRRRRRRRRRRPK',
    'KPQDRRRRRRRRDQPK',
    'KPPPDRRRRRRDPPPK',
    'KPQPPDRRRRDPPQPK',
    'KPPPPPDRRDPPPPPK',
    'KpPPPPKDDKPPPPpK',
    'KpPPPKGSSGKPPPpK',
    'KpPPKGGSSGGKPPpK',
    'KpPKGGGSSGGGKPpK',
    'KpKGGGGSSGGGGKpK',
    'KpGGGGgSSgGGGGpK',
    'KphhhhhSShhhhhpK',
    'KpGGGGGSSGGGGGpK',
    'KpgggggSSgggggpK',
    'KKKKKKKKKKKKKKKK',
  ]);
}

// ---------- bottom: shadowed purple boards ----------
function bottom() {
  return sprite([
    'KKKKKKKKKKKKKKKK',
    'KppppppppppppppK',
    'KPPPPPPPPPPPPPPK',
    'KKKKKKKKKKKKKKKK',
    'KppppppppppppppK',
    'KPPPPPPPPPPPPPPK',
    'KppppppppppppppK',
    'KKKKKKKKKKKKKKKK',
    'KPPPPPPPPPPPPPPK',
    'KppppppppppppppK',
    'KPPPPPPPPPPPPPPK',
    'KKKKKKKKKKKKKKKK',
    'KppppppppppppppK',
    'KPPPPPPPPPPPPPPK',
    'KppppppppppppppK',
    'KKKKKKKKKKKKKKKK',
  ]);
}

// ---------- pack icon: the block drawn as an isometric cube ----------
function icon(topTex, sideTex) {
  const c = canvas(128, 128);
  // Each face is an affine map from texture space [0,1)² onto the icon:
  // origin, the u axis (texture x) and the v axis (texture y), plus a shade.
  const faces = [
    { tex: topTex, o: [64, 8], u: [56, 28], v: [-56, 28], light: 1 },
    { tex: sideTex, o: [8, 36], u: [56, 28], v: [0, 56], light: 0.8 },
    { tex: sideTex, o: [64, 64], u: [56, -28], v: [0, 56], light: 0.62 },
  ];
  for (let py = 0; py < 128; py++) {
    for (let px = 0; px < 128; px++) {
      for (const f of faces) {
        const dx = px + 0.5 - f.o[0];
        const dy = py + 0.5 - f.o[1];
        const det = f.u[0] * f.v[1] - f.u[1] * f.v[0];
        const a = (dx * f.v[1] - dy * f.v[0]) / det;
        const b = (f.u[0] * dy - f.u[1] * dx) / det;
        if (a < 0 || a >= 1 || b < 0 || b >= 1) continue;
        const i = (Math.floor(b * 16) * 16 + Math.floor(a * 16)) * 4;
        const col = [f.tex.buf[i], f.tex.buf[i + 1], f.tex.buf[i + 2]];
        c.set(px, py, shade(col, f.light));
        break;
      }
    }
  }
  return c;
}

const topTex = top();
const sideTex = side();
write('resource_pack/textures/blocks/uncrafting_table_top.png', topTex.png());
write('resource_pack/textures/blocks/uncrafting_table_side.png', sideTex.png());
write('resource_pack/textures/blocks/uncrafting_table_bottom.png', bottom().png());
const packIcon = icon(topTex, sideTex).png();
write('behavior_pack/pack_icon.png', packIcon);
write('resource_pack/pack_icon.png', packIcon);
