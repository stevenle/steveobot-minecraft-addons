// Generates everything derived for this add-on:
//   - the Heart Fragment / Heart Container item icons (16×16)
//   - the Heart Ore block texture (16×16)
//   - the pack icons (128×128)
//   - behavior_pack/entities/player.json: the vanilla player entity from
//     assets/vanilla/player.json (Mojang/bedrock-samples v1.26.50.4) plus one
//     component group per heart count so the script can raise max health.
// Run from the repo root:  node addons/extra-hearts/assets/generate.mjs addons/extra-hearts
// The generated output is what gets committed; this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

// Keep these in step with src/main.ts.
const BASE_HEARTS = 10;
const MAX_HEARTS = 30;

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

/** Paints a pixel-art string map at (ox, oy), each cell `scale` pixels. */
function paint(c, art, colors, ox, oy, scale) {
  for (let y = 0; y < art.length; y++) for (let x = 0; x < art[y].length; x++) {
    const col = colors[art[y][x]];
    if (!col) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      c.set(ox + x * scale + dx, oy + y * scale + dy, col);
    }
  }
}

// ---------- Palette ----------
const RED = {
  R: hex('#D7263D'), // heart red
  h: hex('#FF7A8A'), // highlight
  d: hex('#8E1024'), // shade
  o: hex('#3A0510'), // outline
  G: hex('#F2C14E'), // gold rim
};

// ---------- Heart Container: a full heart with a gold rim ----------
const CONTAINER = [
  '................',
  '...ooo...ooo....',
  '..oGGGo.oGGGo...',
  '.oGhhRGoGRRRGo..',
  '.oGhRRRGRRRRGo..',
  '.oGRRRRRRRRRGo..',
  '.oGRRRRRRRRRGo..',
  '.oGRRRRRRRRRGo..',
  '..oGRRRRRRRGo...',
  '...oGRRRRRGo....',
  '....oGRRRGo.....',
  '.....oGRGo......',
  '......oGo.......',
  '.......o........',
  '................',
  '................',
];

// ---------- Heart Fragment: a broken quarter of a heart ----------
const FRAGMENT = [
  '................',
  '................',
  '....ooo.........',
  '...ohhRo........',
  '..ohRRRRo.......',
  '..oRRRRRRo......',
  '..oRRRRRdo......',
  '..oRRRRdo.......',
  '...oRRRdo.......',
  '...oRRdo........',
  '....oRdo........',
  '.....odo........',
  '......o.........',
  '................',
  '................',
  '................',
];

// ---------- Heart Ore: stone with heart-red specks ----------
function paintOre() {
  const c = canvas(16, 16);
  // Deterministic stone noise so the texture is stable between runs.
  let seed = 0x5eed;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const stone = [hex('#7F7F7F'), hex('#868686'), hex('#737373'), hex('#8C8C8C'), hex('#6E6E6E')];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, stone[Math.floor(rand() * stone.length)]);
  const specks = [
    [2, 2], [3, 2], [2, 3], [3, 3],
    [10, 1], [11, 1], [10, 2],
    [6, 7], [7, 7], [6, 8], [7, 8], [8, 8],
    [12, 9], [13, 9], [13, 10],
    [3, 12], [4, 12], [4, 13],
    [9, 13], [10, 13], [9, 14],
  ];
  for (const [x, y] of specks) c.set(x, y, RED.R);
  for (const [x, y] of [[2, 2], [10, 1], [6, 7], [12, 9], [3, 12], [9, 13]]) c.set(x, y, RED.h);
  for (const [x, y] of [[3, 3], [10, 2], [8, 8], [13, 10], [4, 13], [9, 14]]) c.set(x, y, RED.d);
  return c.png();
}

function paintIcon(art) {
  const c = canvas(16, 16);
  paint(c, art, RED, 0, 0, 1);
  return c.png();
}

// ---------- Pack icon: 128×128, a big heart container on stone ----------
function paintPackIcon() {
  const S = 128;
  const c = canvas(S, S);
  let seed = 0xbeef;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const stone = [hex('#5E5E62'), hex('#66666A'), hex('#56565A'), hex('#6C6C70')];
  for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x += 4) {
    const col = stone[Math.floor(rand() * stone.length)];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) c.set(x + dx, y + dy, col);
  }
  const border = hex('#3A3A3E');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (x < 4 || y < 4 || x >= S - 4 || y >= S - 4) c.set(x, y, border);
  }
  paint(c, CONTAINER, RED, 8, 16, 7);
  return c.png();
}

// ---------- player.json ----------
function buildPlayer() {
  const vanilla = JSON.parse(fs.readFileSync(path.join(out, 'assets', 'vanilla', 'player.json'), 'utf8'));
  const entity = vanilla['minecraft:entity'];
  const groups = entity.component_groups ?? {};
  const events = entity.events ?? {};
  const names = [];
  for (let hearts = BASE_HEARTS + 1; hearts <= MAX_HEARTS; hearts++) {
    const name = `steveo:hearts_${hearts}`;
    names.push(name);
    groups[name] = { 'minecraft:health': { value: hearts * 2, max: hearts * 2 } };
  }
  for (let hearts = BASE_HEARTS + 1; hearts <= MAX_HEARTS; hearts++) {
    events[`steveo:hearts_${hearts}`] = {
      sequence: [
        { remove: { component_groups: names } },
        { add: { component_groups: [`steveo:hearts_${hearts}`] } },
      ],
    };
  }
  events['steveo:hearts_reset'] = { remove: { component_groups: names } };
  entity.component_groups = groups;
  entity.events = events;
  return `${JSON.stringify(vanilla, null, 2)}\n`;
}

// ---------- Write ----------
const rp = path.join(out, 'resource_pack');
const bp = path.join(out, 'behavior_pack');
fs.mkdirSync(path.join(rp, 'textures', 'items'), { recursive: true });
fs.mkdirSync(path.join(rp, 'textures', 'blocks'), { recursive: true });
fs.mkdirSync(path.join(bp, 'entities'), { recursive: true });
fs.writeFileSync(path.join(rp, 'textures', 'items', 'heart_fragment.png'), paintIcon(FRAGMENT));
fs.writeFileSync(path.join(rp, 'textures', 'items', 'heart_container.png'), paintIcon(CONTAINER));
fs.writeFileSync(path.join(rp, 'textures', 'blocks', 'heart_ore.png'), paintOre());
const icon = paintPackIcon();
fs.writeFileSync(path.join(rp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(bp, 'pack_icon.png'), icon);
fs.writeFileSync(path.join(bp, 'entities', 'player.json'), buildPlayer());
console.log('wrote icons, textures, and entities/player.json to', out);
