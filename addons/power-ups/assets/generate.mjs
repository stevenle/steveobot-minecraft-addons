// Generates the power-up item icons (16×16) and both pack icons
// (128×128, the Super Carrot scaled up 8×).
// Run from the repo root:  node addons/power-ups/assets/generate.mjs addons/power-ups
// The generated output is what gets committed; this script is for regenerating it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node generate.mjs <addon dir>');

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
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** '#rrggbb' or '#rrggbbaa' -> [r, g, b, a]. */
function hex(h) {
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), h.length > 7 ? n(7) : 255];
}

// Each sprite: a palette (one character per colour, '.' is transparent) and 16 rows of 16.
const SPRITES = {
  super_carrot: {
    pal: { O: '#a8480a', o: '#f58a1f', l: '#ffc266', d: '#cf6a10', G: '#1f7a2a', g: '#58c84a', y: '#ffe45c', w: '#ffffff' },
    px: [
      '...........G.G..',
      '...y......GgGgG.',
      '..ywy......GgggG',
      '...y.....OOGgGG.',
      '........OlooOG.G',
      '.......OlooooO..',
      '......OlooodoO..',
      '.....OloooooO...',
      '....OloodooO....',
      '...OloooooO.....',
      '...OoodooO......',
      '..OooooOO....y..',
      '..OoooO.....ywy.',
      '.OooOO.......y..',
      '.OOO............',
      '................',
    ],
  },
  bounce_boots_charm: {
    pal: { R: '#7d1320', r: '#e03131', p: '#ff8787', w: '#ffffff', c: '#d0d7e2', S: '#4b5263', s: '#aab3c5' },
    px: [
      '................',
      '....RRRRRR......',
      '....RwwwwR......',
      '....RcwwcR......',
      '....RrrrrR......',
      '....RrprrR......',
      '....RrprrRRR....',
      '....RrprrrrrRR..',
      '....RrrrrrrrrrR.',
      '....RrrrrrrrrrR.',
      '....RRRRRRRRRRR.',
      '.....SssssssS...',
      '.......SssS.....',
      '.....SssssssS...',
      '.......SssS.....',
      '....SSSSSSSSSS..',
    ],
  },
  fire_pepper: {
    pal: { R: '#8a0f14', r: '#e8261c', l: '#ff8a70', G: '#1f7a2a', g: '#58c84a', o: '#ff922b', y: '#ffe45c' },
    px: [
      '...........GG...',
      '..........Gg....',
      '.........GgG....',
      '........RGGR....',
      '.......RrrrrR...',
      '......RrlrrrR...',
      '......RrlrrrR...',
      '......RrrrrrR...',
      '.......RrrrrR...',
      '.......RrrrrR...',
      '........RrrrR...',
      '...y....RrrrR...',
      '..yoy...RrrR....',
      '.yoyoy.RrrR.....',
      '..yoyRRrR.......',
      '...y.RRR........',
    ],
  },
  bubble_shell: {
    pal: { P: '#14606b', p: '#7fe0d8', D: '#2fa7a6', l: '#ffffff', b: '#bfe9ff' },
    px: [
      '............bb..',
      '...........b..b.',
      '.....PPPPPP.bb..',
      '...PPpppppPPP...',
      '..PpplpDpppDppP.',
      '.PpplpDppDppDpP.',
      '.PplppDppDppDpP.',
      '.PplpDppDppDppP.',
      '.PpppDppDppDppP.',
      '..PppDpDpDppPP..',
      '..PpppDpDpDppP..',
      '...PppDDDDppP...',
      '....PPpDDpPP....',
      '..b...PppP......',
      '.b.b..PppP......',
      '..b...PPPP......',
    ],
  },
  rock_fist: {
    pal: { K: '#2b2f38', g: '#8e96a3', l: '#c9d0da', d: '#626a78' },
    px: [
      '................',
      '..KKKKKKKKKKKKK.',
      '..KlgKlgKlgKlgK.',
      '..KggKggKggKggK.',
      '..KggKggKggKggK.',
      '..KgdKgdKgdKgdK.',
      '..KKKKKKKKKKKKK.',
      '.KllggggggKgggK.',
      '.KgggggggdKggdK.',
      '.KKKKKKKKKKggdK.',
      '..KggggggggggdK.',
      '..KgggKgggggdK..',
      '...KgdgKggddK...',
      '...KddddddddK...',
      '....KKKKKKKK....',
      '................',
    ],
  },
  feather_cape_token: {
    pal: { W: '#5f7fa8', w: '#ffffff', b: '#9fd0ff', y: '#ffc933', q: '#8a5a12' },
    px: [
      '...........WWW..',
      '.........WWwwwW.',
      '........WwwwbwW.',
      '.......WwwwbwwW.',
      '......WwwwbwwW..',
      '.....WwwwbwwwW..',
      '....WwwwbwwwW...',
      '....WwwbwwwW....',
      '...WwwbwwwW.....',
      '...WwbwwWW......',
      '...WbwWW........',
      '..yyWW..........',
      '.qyy............',
      '.q..............',
      'q...............',
      '................',
    ],
  },
  // Semi-transparent on purpose. Alpha stays above 128 so an alpha-tested
  // render (the item in hand) still shows every pixel.
  ghost_radish: {
    pal: { V: '#7868bef2', v: '#ece8ffc7', l: '#fffffff2', G: '#468c6ee6', g: '#a0e1becc' },
    px: [
      '.....G....G.....',
      '....GgG..GgG....',
      '.....GgGGgG.....',
      '......GggG......',
      '.....VVVVVV.....',
      '....VvvvvvvV....',
      '...VvlvvvvvvV...',
      '...VvlvvvvvvV...',
      '...VvvvvvvvvV...',
      '...VvvvvvvlvV...',
      '...VvvvvvvvvV...',
      '....VvvvvvvV....',
      '.....VvvvvV.....',
      '......VvvV......',
      '.......VV.......',
      '........V.......',
    ],
  },
  super_power_up: {
    pal: { K: '#b8860b', a: '#ffe45c', b: '#ff922b', c: '#f0569a', d: '#8a5cf0', e: '#3b9bff', w: '#ffffff', Z: '#ffffff' },
    px: [
      '.....KKKKKK.....',
      '...KKaaaaaaKK...',
      '..KawaaaaaZZaK..',
      '.KawwaaaaZZaaaK.',
      '.KbwbbbbZZbbbbK.',
      'KbbbbbbZZbbbbbbK',
      'KbbbbbZZZZZZbbbK',
      'KcccccccccZZcccK',
      'KccccccccZZccccK',
      'KcccccccZZcccccK',
      'KddddddZZddddddK',
      '.KddddZZddddddK.',
      '.KddddZdddddddK.',
      '..KeeeeeeeeeeK..',
      '...KKeeeeeeKK...',
      '.....KKKKKK.....',
    ],
  },
  // The three shape friends from the book cover, each with a little smile.
  water_diamond: {
    pal: { K: '#12306b', b: '#3b9bff', l: '#bfe2ff', E: '#0b1d47' },
    px: [
      '.......KK.......',
      '......KbbK......',
      '.....KblbbK.....',
      '....KblbbbbK....',
      '...KblbbbbbbK...',
      '..KbbEbbbbEbbK..',
      '.KbbbEbbbbEbbbK.',
      'KbbbbbbbbbbbbbbK',
      'KbbbbEbbbbEbbbbK',
      '.KbbbbEEEEbbbbK.',
      '..KbbbbbbbbbbK..',
      '...KbbbbbbbbK...',
      '....KbbbbbbK....',
      '.....KbbbbK.....',
      '......KbbK......',
      '.......KK.......',
    ],
  },
  light_square: {
    pal: { K: '#7a5a00', y: '#ffe033', l: '#fff8c2', d: '#f0b90b', E: '#3d2c00' },
    px: [
      '................',
      '.KKKKKKKKKKKKKK.',
      '.KyyyyyyyyyyyyK.',
      '.KyllyyyyyyyyyK.',
      '.KylyyyyyyyyyyK.',
      '.KyyyEyyyyEyyyK.',
      '.KyyyEyyyyEyyyK.',
      '.KyyyyyyyyyyyyK.',
      '.KyyEyyyyyyEyyK.',
      '.KyyyEyyyyEyyyK.',
      '.KyyyyEEEEyyyyK.',
      '.KyyyyyyyyyyyyK.',
      '.KyyyyyyyyyyydK.',
      '.KyyyyyyyyyyddK.',
      '.KKKKKKKKKKKKKK.',
      '................',
    ],
  },
  fire_triangle: {
    pal: { K: '#6b0f14', r: '#f03e3e', l: '#ffa8a8', E: '#3d0508' },
    px: [
      'KKKKKKKKKKKKKKKK',
      'KrllrrrrrrrrrrrK',
      '.KrrrrrrrrrrrrK.',
      '.KrrrErrrrErrrK.',
      '..KrrErrrrErrK..',
      '..KrrrrrrrrrrK..',
      '...KrErrrrErK...',
      '...KrrEEEErrK...',
      '....KrrrrrrK....',
      '....KrrrrrrK....',
      '.....KrrrrK.....',
      '.....KrrrrK.....',
      '......KrrK......',
      '......KrrK......',
      '.......KK.......',
      '................',
    ],
  },
};

function render(sprite, scale) {
  if (sprite.px.length !== 16) throw new Error('sprite must have 16 rows');
  const size = 16 * scale;
  const buf = Buffer.alloc(size * size * 4);
  sprite.px.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`row ${y} is ${row.length} wide`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const colour = sprite.pal[ch];
      if (!colour) throw new Error(`unknown pixel '${ch}'`);
      const c = hex(colour);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * size + x * scale + dx) * 4;
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
      }
    });
  });
  return png(size, size, buf);
}

for (const [name, sprite] of Object.entries(SPRITES)) {
  fs.writeFileSync(path.join(out, `resource_pack/textures/items/${name}.png`), render(sprite, 1));
}
for (const pack of ['behavior_pack', 'resource_pack']) {
  fs.writeFileSync(path.join(out, pack, 'pack_icon.png'), render(SPRITES.super_carrot, 8));
}
