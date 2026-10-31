/**
 * The creeper dungeon's floor plan, as data. Nothing here touches the world:
 * `planDungeon` turns an origin and a seed into a list of block placements,
 * chest spots, and the rooms the encounter code needs to know about, and
 * `planShaft` adds the ladder shaft and surface ruin once the generator has
 * found the ground.
 *
 * Coordinates below are relative to the arena's centre at floor level
 * (the floor blocks are at y = -1). North is -z. Plan view:
 *
 *                       +-------+
 *                       | VAULT |        sealed until the boss dies
 *                       +---#---+
 *                           #            (# = sealed creeperite)
 *   +------+ +-------------###-------------+ +------+
 *   |secret|=| SIDE |=====|  ARENA  |=====| SIDE |=|secret|
 *   +------+ +------+     |  (boss) |     +------+ +------+
 *                         +----+----+
 *                              |          one corridor hides a trap plate
 *                         +----+----+
 *                         |  HALL   |  ladder shaft up to a surface ruin
 *                         +---------+
 *
 * The two side rooms are drawn from four kinds (den, mine, library,
 * armory), and one of them has a secret closet behind a patch of cracked
 * bricks under a carved face.
 */
import type { Vector3 } from '@minecraft/server';

export type BlockSpec = string | { id: string; states: Record<string, string | number | boolean> };

export interface Placement extends Vector3 {
  block: BlockSpec;
  /** Needs support from its neighbours (ladder, rail, plate, chest): placed after everything else. */
  late?: boolean;
  /** Only overwrite air, plants, and snow (clearing round the surface ruin). */
  ifReplaceable?: boolean;
}

export type Facing = 'north' | 'south' | 'east' | 'west';
export type LootTable = 'common' | 'armory' | 'vault' | 'secret';

export interface ChestSpot extends Vector3 {
  table: LootTable;
  facing: Facing;
}

export type RoomKind = 'arena' | 'hall' | 'den' | 'mine' | 'library' | 'armory';

export interface Box {
  min: Vector3;
  max: Vector3;
}

export interface RoomInfo extends Box {
  kind: RoomKind;
  /** Where creepers appear when a player first walks in. */
  spawns: Vector3[];
  /** How many of those are charged. */
  charged: number;
}

export interface TrapInfo extends Vector3 {
  spawns: Vector3[];
}

export interface DungeonPlan {
  origin: Vector3;
  placements: Map<string, Placement>;
  chests: ChestSpot[];
  rooms: RoomInfo[];
  traps: TrapInfo[];
  /** Everything sealed: the vault, its corridor, and the door. */
  vault: Box;
  /** The sealed blocks in the arena wall that open when the boss dies. */
  door: Box;
  boss: Vector3;
  /** The whole dungeon, without the shaft. */
  footprint: Box;
  /** Bottom of the ladder shaft (inside the hall), and the hall ceiling height above it. */
  shaft: Vector3;
  shaftStartY: number;
}

export const BLOCKS = {
  stone: 'steveo:creeperite',
  polished: 'steveo:polished_creeperite',
  bricks: 'steveo:creeperite_bricks',
  cracked: 'steveo:cracked_creeperite_bricks',
  carved: 'steveo:carved_creeperite_bricks',
  metal: 'steveo:creeperite_block',
  ore: 'steveo:creeperite_ore',
  sealed: 'steveo:sealed_creeperite_bricks',
  air: 'minecraft:air',
  light: 'minecraft:verdant_froglight',
  web: 'minecraft:web',
  face: 'minecraft:polished_blackstone',
} as const;

/** Local-space extent of everything `planDungeon` places. */
export const FOOTPRINT: Box = { min: { x: -30, y: -1, z: -21 }, max: { x: 30, y: 9, z: 25 } };

/** The creeper face, 8x8; '#' is dark. Row 0 is the top (north). */
const FACE = ['........', '........', '.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..'];

/** Small seeded PRNG (mulberry32), so a region always gets the same dungeon. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

class Builder {
  readonly placements = new Map<string, Placement>();
  constructor(
    readonly origin: Vector3,
    readonly rand: () => number,
  ) {}

  at(x: number, y: number, z: number): Vector3 {
    return { x: this.origin.x + x, y: this.origin.y + y, z: this.origin.z + z };
  }

  set(x: number, y: number, z: number, block: BlockSpec, extra: Partial<Placement> = {}): void {
    const p = this.at(x, y, z);
    this.placements.set(key(p.x, p.y, p.z), { ...p, block, ...extra });
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: BlockSpec | ((x: number, y: number, z: number) => BlockSpec)): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
          this.set(x, y, z, typeof block === 'function' ? block(x, y, z) : block);
  }

  /** A hollow box: `floor` at the bottom, `ceiling` on top, `wall` round the sides, air inside. */
  shell(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    wall: (x: number, y: number, z: number) => BlockSpec,
    floor: (x: number, z: number) => BlockSpec,
    ceiling: (x: number, z: number) => BlockSpec,
  ): void {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
    for (let x = ax; x <= bx; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = az; z <= bz; z++) {
          const edge = x === ax || x === bx || z === az || z === bz;
          const block = y === y0 ? floor(x, z) : y === y1 ? ceiling(x, z) : edge ? wall(x, y, z) : BLOCKS.air;
          this.set(x, y, z, block);
        }
  }

  chance(p: number): boolean {
    return this.rand() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.rand() * items.length)];
    if (item === undefined) throw new Error('pick from empty list');
    return item;
  }

  wallBlock(oreChance = 0.03): string {
    const r = this.rand();
    if (r < oreChance) return BLOCKS.ore;
    if (r < oreChance + 0.18) return BLOCKS.cracked;
    if (r < oreChance + 0.26) return BLOCKS.stone;
    return BLOCKS.bricks;
  }

  floorBlock(): string {
    return this.chance(0.15) ? BLOCKS.cracked : BLOCKS.bricks;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
    const a = this.at(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const b = this.at(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    return { min: a, max: b };
  }
}

const chest = (b: Builder, x: number, y: number, z: number, table: LootTable, facing: Facing): ChestSpot => ({
  ...b.at(x, y, z),
  table,
  facing,
});

function arena(b: Builder): void {
  const lights = new Set([-7, -3, 3, 7]);
  b.shell(
    -9, -1, -9, 9, 9, 9,
    (x, y, z) => {
      const along = Math.abs(x) === 9 ? z : x;
      if (y === 0) return BLOCKS.polished;
      if (y === 8) return along % 3 === 0 ? BLOCKS.carved : BLOCKS.polished;
      if (y === 4 && lights.has(along)) return BLOCKS.light;
      return b.wallBlock();
    },
    (x, z) => {
      if (Math.abs(x) > 4 || Math.abs(z) > 4) return b.floorBlock();
      // A giant creeper face inlaid in the floor, looking north at the vault.
      const row = FACE[z + 4];
      return row !== undefined && row[x + 4] === '#' ? BLOCKS.face : BLOCKS.polished;
    },
    (x, z) => (x % 4 === 0 && z % 4 === 0 ? BLOCKS.light : BLOCKS.polished),
  );
  for (const px of [-6, 5]) for (const pz of [-6, 5]) {
    b.fill(px, 0, pz, px + 1, 8, pz + 1, (_x, y) => (y === 2 || y === 6 ? BLOCKS.carved : y === 4 ? BLOCKS.light : BLOCKS.polished));
  }
  for (const cx of [-8, 8]) for (const cz of [-8, 8]) for (const y of [7, 8]) {
    if (b.chance(0.5)) b.set(cx, y, cz, BLOCKS.web);
  }
}

/** A straight 3-wide, 4-tall corridor between two rooms along x (axis 'x') or z. */
function corridor(b: Builder, axis: 'x' | 'z', from: number, to: number): void {
  const [a, c] = [Math.min(from, to), Math.max(from, to)];
  const mid = Math.round((a + c) / 2);
  if (axis === 'z') {
    b.shell(-2, -1, a, 2, 4, c, () => b.wallBlock(), () => b.floorBlock(), (x, z) => (x === 0 && z === mid ? BLOCKS.light : BLOCKS.polished));
  } else {
    b.shell(a, -1, -2, c, 4, 2, () => b.wallBlock(), () => b.floorBlock(), (x, z) => (z === 0 && x === mid ? BLOCKS.light : BLOCKS.polished));
  }
}

function passage(b: Builder, axis: 'x' | 'z', from: number, to: number): void {
  if (axis === 'z') b.fill(-1, 0, from, 1, 3, to, BLOCKS.air);
  else b.fill(from, 0, -1, to, 3, 1, BLOCKS.air);
}

function hall(b: Builder, chests: ChestSpot[]): RoomInfo {
  b.shell(
    -4, -1, 17, 4, 5, 25,
    () => b.wallBlock(),
    () => b.floorBlock(),
    (x, z) => (Math.abs(x) === 2 && (z === 19 || z === 23) ? BLOCKS.light : BLOCKS.polished),
  );
  // Two creeper statues flank the ladder.
  for (const x of [-2, 2]) {
    b.set(x, 0, 24, BLOCKS.metal);
    b.set(x, 1, 24, BLOCKS.metal);
    b.set(x, 2, 24, BLOCKS.carved);
  }
  for (const x of [-3, 3]) for (const y of [3, 4]) if (b.chance(0.6)) b.set(x, y, 18, BLOCKS.web);
  chests.push(chest(b, -3, 0, 21, 'common', 'east'), chest(b, 3, 0, 21, 'common', 'west'));
  return { kind: 'hall', ...b.box(-3, 0, 18, 3, 4, 24), spawns: [b.at(0, 0, 20)], charged: 0 };
}

function vault(b: Builder, chests: ChestSpot[]): void {
  const sealed = () => BLOCKS.sealed;
  b.shell(-2, -1, -12, 2, 4, -10, sealed, sealed, sealed);
  b.shell(-4, -1, -21, 4, 5, -13, sealed, sealed, sealed);
  b.fill(-1, 0, -13, 1, 3, -10, BLOCKS.air);
  // The door: the sealed face in the arena's north wall.
  b.fill(-1, 0, -9, 1, 3, -9, BLOCKS.sealed);
  b.set(0, 0, -17, BLOCKS.metal);
  b.set(0, 1, -17, BLOCKS.carved);
  for (const x of [-3, 3]) for (const z of [-14, -20]) b.set(x, 4, z, BLOCKS.light);
  chests.push(
    chest(b, -3, 0, -17, 'vault', 'east'),
    chest(b, 3, 0, -17, 'vault', 'west'),
    chest(b, 0, 0, -20, 'vault', 'south'),
  );
}

type SideKind = 'den' | 'mine' | 'library' | 'armory';
const SIDE_KINDS: readonly SideKind[] = ['den', 'mine', 'library', 'armory'];

/**
 * A side room east (side 1) or west (side -1) of the arena. Inside, `u` runs
 * away from the arena (-4 at the door, 4 at the far wall) and `v` is z.
 */
function sideRoom(b: Builder, side: 1 | -1, kind: SideKind, secret: boolean, chests: ChestSpot[]): RoomInfo {
  const X = (u: number) => side * (22 + u);
  const towardArena: Facing = side === 1 ? 'west' : 'east';
  const oreChance = kind === 'mine' ? 0.35 : 0.03;
  b.shell(
    X(-5), -1, -5, X(5), 6, 5,
    (x, _y, z) => {
      // Keep the far wall plain so the secret's cracked patch stands out.
      if (secret && x === X(5) && Math.abs(z) < 5) return BLOCKS.bricks;
      return b.wallBlock(oreChance);
    },
    () => (b.chance(0.5) ? BLOCKS.polished : b.floorBlock()),
    (x, z) => (Math.abs(x - X(0)) === 2 && Math.abs(z) === 2 ? BLOCKS.light : BLOCKS.polished),
  );
  const set = (u: number, y: number, v: number, block: BlockSpec, extra?: Partial<Placement>) => b.set(X(u), y, v, block, extra);
  const nearDoor = (u: number, v: number) => u <= -3 && Math.abs(v) <= 1;
  const atSecret = (u: number, v: number) => secret && u === 4 && Math.abs(v) <= 1;
  let spawns: Array<[number, number]> = [];
  let charged = 0;

  switch (kind) {
    case 'den': {
      for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {
        if (b.chance(0.4)) set(u, -1, v, b.chance(0.5) ? 'minecraft:gravel' : 'minecraft:moss_block');
      }
      for (const v of [-4, 4]) {
        set(4, 0, v, 'minecraft:tnt');
        set(4, 1, v, 'minecraft:tnt');
      }
      for (let u = -4; u <= 4; u++) for (const v of [-4, 4]) for (const y of [4, 5]) {
        if (b.chance(0.2)) set(u, y, v, BLOCKS.web);
      }
      chests.push(chest(b, X(-3), 0, 4, 'common', 'north'));
      spawns = [[2, 2], [2, -2], [-1, 2], [-1, -2]];
      break;
    }
    case 'mine': {
      for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {
        if (Math.abs(v) > 1 && b.chance(0.3)) set(u, -1, v, 'minecraft:gravel');
      }
      for (let u = -4; u <= 4; u++) set(u, 0, 0, 'minecraft:rail', { late: true });
      for (const [u, v, h] of [[2, -3, 3], [-2, 3, 2], [3, 3, 1]] as const) {
        for (let y = 0; y < h; y++) set(u, y, v, BLOCKS.ore);
        set(u, h, v, BLOCKS.stone);
      }
      chests.push(chest(b, X(4), 0, -4, 'common', towardArena));
      spawns = [[0, 2], [0, -2], [-2, -2]];
      break;
    }
    case 'library': {
      for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {
        const perimeter = Math.abs(u) === 4 || Math.abs(v) === 4;
        if (!perimeter || nearDoor(u, v) || atSecret(u, v) || (u === 3 && v === 4)) continue;
        for (let y = 0; y <= 2; y++) set(u, y, v, 'minecraft:bookshelf');
        if (b.chance(0.25)) set(u, 4, v, BLOCKS.web);
      }
      set(0, 0, 0, 'minecraft:enchanting_table');
      chests.push(chest(b, X(3), 0, 4, 'common', 'north'));
      spawns = [[2, 2], [-2, -2], [2, -2]];
      charged = 1;
      break;
    }
    case 'armory': {
      set(0, 0, 4, 'minecraft:anvil');
      set(-2, 0, 4, 'minecraft:smithing_table');
      set(2, 0, 4, 'minecraft:grindstone');
      for (let u = -2; u <= 2; u++) for (const y of [1, 2]) set(u, y, -4, 'minecraft:iron_bars');
      chests.push(chest(b, X(4), 0, 3, 'armory', towardArena), chest(b, X(4), 0, -3, 'armory', towardArena));
      spawns = [[0, 0], [-2, 2], [-2, -2]];
      break;
    }
  }

  if (secret) {
    const U = (u: number) => X(u);
    b.shell(U(5), -1, -2, U(8), 3, 2, () => BLOCKS.bricks, () => BLOCKS.polished, () => BLOCKS.polished);
    // The tell: a 3x3 of cracked bricks with a carved face over it.
    b.fill(U(5), 0, -1, U(5), 2, 1, BLOCKS.cracked);
    b.set(U(5), 3, 0, BLOCKS.carved);
    b.set(U(7), 3, 0, BLOCKS.light);
    b.set(U(6), 2, -1, BLOCKS.web);
    b.set(U(6), 2, 1, BLOCKS.web);
    chests.push(chest(b, U(7), 0, 0, 'secret', towardArena));
  }

  return {
    kind,
    ...b.box(X(-4), 0, -4, X(4), 5, 4),
    spawns: spawns.map(([u, v]) => b.at(X(u), 0, v)),
    charged,
  };
}

export function planDungeon(origin: Vector3, seed: number): DungeonPlan {
  const rand = seededRandom(seed);
  const b = new Builder(origin, rand);
  const chests: ChestSpot[] = [];
  const rooms: RoomInfo[] = [];

  arena(b);
  rooms.push({ kind: 'arena', ...b.box(-8, 0, -8, 8, 8, 8), spawns: [], charged: 0 });
  rooms.push(hall(b, chests));

  const kinds = [...SIDE_KINDS];
  const east = kinds.splice(Math.floor(rand() * kinds.length), 1)[0] ?? 'den';
  const west = kinds.splice(Math.floor(rand() * kinds.length), 1)[0] ?? 'mine';
  const secretEast = rand() < 0.5;
  rooms.push(sideRoom(b, 1, east, secretEast, chests));
  rooms.push(sideRoom(b, -1, west, !secretEast, chests));

  corridor(b, 'z', 10, 16);
  corridor(b, 'x', 10, 16);
  corridor(b, 'x', -10, -16);
  passage(b, 'z', 9, 17);
  passage(b, 'x', 9, 17);
  passage(b, 'x', -9, -17);
  vault(b, chests);

  // One corridor hides a pressure plate that springs an ambush from both ends.
  const traps: TrapInfo[] = [];
  const trap = b.pick(['south', 'east', 'west'] as const);
  if (trap === 'south') {
    b.set(0, 0, 13, 'minecraft:stone_pressure_plate', { late: true });
    traps.push({ ...b.at(0, 0, 13), spawns: [b.at(0, 0, 10), b.at(0, 0, 16)] });
  } else {
    const s = trap === 'east' ? 1 : -1;
    b.set(13 * s, 0, 0, 'minecraft:stone_pressure_plate', { late: true });
    traps.push({ ...b.at(13 * s, 0, 0), spawns: [b.at(10 * s, 0, 0), b.at(16 * s, 0, 0)] });
  }
  for (const [x, z] of [[0, 11], [11, 0], [-11, 0], [0, 15], [15, 0], [-15, 0]] as const) {
    if (b.chance(0.3)) b.set(x === 0 ? b.pick([-1, 1]) : x, 3, z === 0 ? b.pick([-1, 1]) : z, BLOCKS.web);
  }

  return {
    origin,
    placements: b.placements,
    chests,
    rooms,
    traps,
    vault: b.box(-4, -1, -21, 4, 5, -9),
    door: b.box(-1, 0, -9, 1, 3, -9),
    boss: b.at(0, 0, 0),
    footprint: b.box(FOOTPRINT.min.x, FOOTPRINT.min.y, FOOTPRINT.min.z, FOOTPRINT.max.x, FOOTPRINT.max.y, FOOTPRINT.max.z),
    shaft: b.at(0, 0, 24),
    shaftStartY: origin.y + 5,
  };
}

/**
 * Adds the ladder shaft from the hall up to `surfaceY` (the top ground block
 * at the shaft's column, which becomes the hole) and a little ruin round the
 * top so the dungeon can be found from above. The ladder hangs on the
 * shaft's south wall.
 */
export function planShaft(plan: DungeonPlan, surfaceY: number, seed: number): void {
  const rand = seededRandom(seed ^ 0x5eed);
  const { x: sx, z: sz } = plan.shaft;
  const set = (x: number, y: number, z: number, block: BlockSpec, extra: Partial<Placement> = {}) =>
    plan.placements.set(key(x, y, z), { x, y, z, block, ...extra });
  const ladder: BlockSpec = { id: 'minecraft:ladder', states: { facing_direction: 2 } };

  for (let y = plan.shaft.y; y <= surfaceY; y++) {
    set(sx, y, sz, ladder, { late: true });
    if (y < plan.shaftStartY) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const light = (y - plan.shaftStartY) % 8 === 4 && dz === 0;
      const wall = y === surfaceY ? BLOCKS.polished : light ? BLOCKS.light : rand() < 0.2 ? BLOCKS.cracked : BLOCKS.bricks;
      set(sx + dx, y, sz + dz, wall);
    }
  }

  // The ruin: a cracked platform and four broken pillars topped with carved faces.
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const ring = Math.abs(dx) === 2 || Math.abs(dz) === 2;
    if (ring) set(sx + dx, surfaceY, sz + dz, rand() < 0.4 ? BLOCKS.cracked : BLOCKS.polished);
    for (let y = surfaceY + 1; y <= surfaceY + 4; y++) set(sx + dx, y, sz + dz, BLOCKS.air, { ifReplaceable: true });
  }
  for (const dx of [-2, 2]) for (const dz of [-2, 2]) {
    const height = 1 + Math.floor(rand() * 3);
    for (let i = 1; i <= height; i++) set(sx + dx, surfaceY + i, sz + dz, rand() < 0.35 ? BLOCKS.cracked : BLOCKS.bricks);
    set(sx + dx, surfaceY + height + 1, sz + dz, BLOCKS.carved);
  }
}
