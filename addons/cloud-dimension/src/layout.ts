// Where everything in the Cloud Dimension is, and the block-by-block plans
// that build it. The plans are plain data; build.ts places them.
//
// The world runs along +z: the starter island at the origin, a chain of
// small islands with Gust Pads, and the Sky Castle at the far end.
import { BlockPermutation, ItemStack, type Vector3 } from '@minecraft/server';

export const DIMENSION_ID = 'steveo:clouds';
export const PORTAL_BLOCK = 'steveo:cloud_portal';
export const CLOUD_BLOCK = 'steveo:cloud_block';
export const GUST_PAD = 'steveo:gust_pad';
export const STORM_ALTAR = 'steveo:storm_altar';
export const FLOATATO = 'steveo:floatato';
export const CHARGE = 'steveo:charge';
export const NIMBUS_KING = 'steveo:nimbus_king';
export const STORM_CRYSTAL = 'steveo:storm_crystal';
export const CLOUD_STAFF = 'steveo:cloud_staff';

/** The surface block at the middle of the starter island. */
export const ISLAND = { x: 0, y: 100, z: 0 };
export const ISLAND_RADIUS = 10;
/** The island's own Cloud Portal, set into the surface. */
export const HOME_PORTAL = { x: 0, y: ISLAND.y, z: -4 };
/** Where travellers land: on the island, facing the portal, not on it. */
export const ARRIVAL = { x: 0.5, y: ISLAND.y + 1, z: 3.5 };
/** Fall this far below the islands and you are floated home. */
export const FALL_LIMIT = ISLAND.y - 40;

/** The Sky Castle: the middle of its courtyard, at grass level. */
export const CASTLE = { x: 0, y: 104, z: 150 };
const CASTLE_ISLAND_RADIUS = 24;
const WALL_HALF = 16;
const WALL_TOP = CASTLE.y + 7;
const KEEP_HALF = 9;
const KEEP_ROOF = CASTLE.y + 11;
const ARENA_HALF = 13;
/** The middle of the throne-room arena on the keep's roof, at standing height. */
export const ARENA = { x: CASTLE.x, y: KEEP_ROOF + 1, z: CASTLE.z };
export const ARENA_RADIUS = ARENA_HALF - 1;
export const ALTAR = { x: CASTLE.x, y: ARENA.y, z: CASTLE.z + 6 };
export const KING_SPAWN = { x: CASTLE.x + 0.5, y: ARENA.y + 1, z: CASTLE.z - 4.5 };
/** Inside of the Floatatoes' glass case, behind the altar. */
const CASE = { x0: CASTLE.x - 2, x1: CASTLE.x + 2, z0: CASTLE.z + 9, z1: CASTLE.z + 11, y0: ARENA.y, y1: ARENA.y + 2 };
/** In front of the castle gate, for the debug teleport. */
export const CASTLE_GATE = { x: CASTLE.x + 0.5, y: CASTLE.y + 1, z: CASTLE.z - WALL_HALF - 3.5 };
/** Courtyard spots where Charge minions turn up. */
export const COURTYARD_SPOTS: Vector3[] = [
  { x: CASTLE.x - 12.5, y: CASTLE.y + 1, z: CASTLE.z - 12.5 },
  { x: CASTLE.x + 12.5, y: CASTLE.y + 1, z: CASTLE.z - 12.5 },
  { x: CASTLE.x - 12.5, y: CASTLE.y + 1, z: CASTLE.z + 12.5 },
  { x: CASTLE.x + 12.5, y: CASTLE.y + 1, z: CASTLE.z + 12.5 },
  { x: CASTLE.x - 12.5, y: CASTLE.y + 1, z: CASTLE.z + 0.5 },
  { x: CASTLE.x + 12.5, y: CASTLE.y + 1, z: CASTLE.z + 0.5 },
];

/** The island chain between the starter island and the castle. */
const CHAIN = [
  { x: 6, y: 102, z: 26, r: 5 },
  { x: -4, y: 105, z: 48, r: 6 },
  { x: 5, y: 103, z: 70, r: 5 },
  { x: -3, y: 106, z: 92, r: 6 },
  { x: 2, y: 104, z: 114, r: 5 },
];

// ---------- Plan entries ----------

export type Placement =
  | { kind: 'block'; at: Vector3; block: string | BlockPermutation }
  | { kind: 'chest'; at: Vector3; items: () => ItemStack[] }
  | { kind: 'spawn'; at: Vector3; id: string; count: number };

const block = (at: Vector3, b: string | BlockPermutation): Placement => ({ kind: 'block', at, block: b });

/** A small seeded random generator, so a rebuilt island has the same shape. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A rounded, wobbly island: grass in the middle, cloud at the rim, deepest
 * in the middle. `flat` lists cells to keep grass-free (for the castle floor).
 */
function island(center: Vector3, radius: number, seed: number, depthScale = 7): Placement[] {
  const rand = seeded(seed);
  const wobble = [rand(), rand()].map((v) => v * Math.PI * 2);
  const plan: Placement[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const angle = Math.atan2(dz, dx);
      const edge = radius * (0.82 + 0.1 * Math.sin(angle * 3 + (wobble[0] ?? 0)) + 0.08 * Math.sin(angle * 5 + (wobble[1] ?? 0)));
      const d = Math.hypot(dx, dz);
      if (d > edge) continue;
      const depth = 1 + Math.round((1 - d / edge) * depthScale + rand() * 1.5);
      const grassy = d < edge - 2.5;
      for (let i = 0; i < depth; i++) {
        let b = CLOUD_BLOCK;
        if (grassy && i === 0) b = 'minecraft:grass_block';
        else if (grassy && i < 3) b = 'minecraft:dirt';
        plan.push(block({ x: center.x + dx, y: center.y - i, z: center.z + dz }, b));
      }
    }
  }
  return plan;
}

const leaves = () => BlockPermutation.resolve('minecraft:oak_leaves', { persistent_bit: true });

function tree(base: Vector3, rand: () => number): Placement[] {
  const plan: Placement[] = [];
  const leaf = leaves();
  for (let dy = 2; dy <= 5; dy++) {
    const r = dy >= 5 ? 1 : 2;
    for (let lx = -r; lx <= r; lx++) {
      for (let lz = -r; lz <= r; lz++) {
        if (Math.abs(lx) === r && Math.abs(lz) === r && (dy === 5 || rand() < 0.5)) continue;
        plan.push(block({ x: base.x + lx, y: base.y + dy, z: base.z + lz }, leaf));
      }
    }
  }
  for (let dy = 0; dy < 5; dy++) plan.push(block({ x: base.x, y: base.y + dy, z: base.z }, 'minecraft:oak_log'));
  return plan;
}

// ---------- Sections ----------

/** The starter island, as first built in 1.0.0 (same seed, same shape). */
export function startPlan(): Placement[] {
  const rand = seeded(20261105);
  const wobble = [rand(), rand(), rand()].map((v) => v * Math.PI * 2);
  const plan: Placement[] = [];
  for (let dx = -ISLAND_RADIUS; dx <= ISLAND_RADIUS; dx++) {
    for (let dz = -ISLAND_RADIUS; dz <= ISLAND_RADIUS; dz++) {
      const angle = Math.atan2(dz, dx);
      const edge =
        ISLAND_RADIUS *
        (0.82 + 0.1 * Math.sin(angle * 3 + (wobble[0] ?? 0)) + 0.08 * Math.sin(angle * 5 + (wobble[1] ?? 0)));
      const d = Math.hypot(dx, dz);
      if (d > edge) continue;
      const inner = 1 - d / edge;
      const depth = 1 + Math.round(inner * 7 + rand() * 1.5);
      const grassy = d < edge - 2.5;
      for (let i = 0; i < depth; i++) {
        let b = CLOUD_BLOCK;
        if (grassy && i === 0) b = 'minecraft:grass_block';
        else if (grassy && i < 3) b = 'minecraft:dirt';
        plan.push(block({ x: ISLAND.x + dx, y: ISLAND.y - i, z: ISLAND.z + dz }, b));
      }
    }
  }
  const treeAt = { x: ISLAND.x + 4, y: ISLAND.y + 1, z: ISLAND.z - 1 };
  const leaf = leaves();
  for (let dy = 2; dy <= 5; dy++) {
    const r = dy >= 5 ? 1 : 2;
    for (let lx = -r; lx <= r; lx++) {
      for (let lz = -r; lz <= r; lz++) {
        if (Math.abs(lx) === r && Math.abs(lz) === r && (dy === 5 || rand() < 0.5)) continue;
        plan.push(block({ x: treeAt.x + lx, y: treeAt.y + dy, z: treeAt.z + lz }, leaf));
      }
    }
  }
  for (let dy = 0; dy < 5; dy++) plan.push(block({ x: treeAt.x, y: treeAt.y + dy, z: treeAt.z }, 'minecraft:oak_log'));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + (wobble[2] ?? 0);
    const c = { x: ISLAND.x + Math.round(Math.cos(a) * 15), y: ISLAND.y - 3 + i, z: ISLAND.z + Math.round(Math.sin(a) * 15) };
    for (let px = -1; px <= 1; px++) {
      for (let pz = -1; pz <= 1; pz++) {
        if (Math.abs(px) + Math.abs(pz) < 2) plan.push(block({ x: c.x + px, y: c.y, z: c.z + pz }, CLOUD_BLOCK));
      }
    }
  }
  plan.push(block(HOME_PORTAL, PORTAL_BLOCK));
  plan.push(...startPadPlan());
  return plan;
}

/** The starter island's Gust Pad, toward the chain. Added in 1.1.0. */
export function startPadPlan(): Placement[] {
  return [block({ x: ISLAND.x, y: ISLAND.y, z: ISLAND.z + 6 }, GUST_PAD)];
}

/** The island chain, each with a Gust Pad toward the castle. */
export function chainPlan(): Placement[] {
  const plan: Placement[] = [];
  CHAIN.forEach((c, i) => {
    plan.push(...island(c, c.r, 9100 + i, 4));
    plan.push(block({ x: c.x, y: c.y, z: c.z + Math.max(1, c.r - 3) }, GUST_PAD));
    if (i % 2 === 1) plan.push(...tree({ x: c.x - 2, y: c.y + 1, z: c.z - 2 }, seeded(9200 + i)));
  });
  return plan;
}

// ---------- The Sky Castle ----------

const WALL = 'minecraft:quartz_bricks';
const TRIM = 'minecraft:smooth_quartz';
const ROOF = 'minecraft:light_blue_concrete';
const GLASS = 'minecraft:glass';
const LIGHT = 'minecraft:sea_lantern';
const AIR = 'minecraft:air';

function fill(plan: Placement[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: string | BlockPermutation) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) plan.push(block({ x, y, z }, b));
}

/** A hollow square ring of wall from y0 to y1. */
function ring(plan: Placement[], cx: number, cz: number, half: number, y0: number, y1: number, b: string) {
  for (let y = y0; y <= y1; y++) {
    for (let i = -half; i <= half; i++) {
      plan.push(block({ x: cx + i, y, z: cz - half }, b), block({ x: cx + i, y, z: cz + half }, b));
      if (Math.abs(i) < half) plan.push(block({ x: cx - half, y, z: cz + i }, b), block({ x: cx + half, y, z: cz + i }, b));
    }
  }
}

function crenellations(plan: Placement[], cx: number, cz: number, half: number, y: number) {
  for (let i = -half; i <= half; i += 2) {
    plan.push(block({ x: cx + i, y, z: cz - half }, WALL), block({ x: cx + i, y, z: cz + half }, WALL));
    plan.push(block({ x: cx - half, y, z: cz + i }, WALL), block({ x: cx + half, y, z: cz + i }, WALL));
  }
}

function tower(plan: Placement[], cx: number, cz: number, items: () => ItemStack[]) {
  const top = CASTLE.y + 14;
  for (let y = CASTLE.y; y <= top; y++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > 3.4) continue;
        const shell = d > 2.2;
        if (y === CASTLE.y) plan.push(block({ x: cx + dx, y, z: cz + dz }, TRIM));
        else plan.push(block({ x: cx + dx, y, z: cz + dz }, shell ? WALL : AIR));
      }
    }
  }
  // A pointed roof.
  for (let layer = 0; layer < 5; layer++) {
    const r = 3.6 - layer * 0.8;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        if (Math.hypot(dx, dz) <= r) plan.push(block({ x: cx + dx, y: top + 1 + layer, z: cz + dz }, ROOF));
      }
    }
  }
  // A door toward the courtyard, a light and a chest inside.
  // The tower straddles the corner of the curtain wall, so the door faces
  // diagonally into the courtyard.
  const toward = { x: -Math.sign(cx - CASTLE.x), z: -Math.sign(cz - CASTLE.z) };
  for (let y = CASTLE.y + 1; y <= CASTLE.y + 2; y++) {
    for (const [a, b] of [[2, 2], [2, 1], [1, 2]] as const) {
      plan.push(block({ x: cx + toward.x * a, y, z: cz + toward.z * b }, AIR));
    }
  }
  plan.push(block({ x: cx, y: top, z: cz }, LIGHT));
  plan.push({ kind: 'chest', at: { x: cx - toward.x, y: CASTLE.y + 1, z: cz - toward.z }, items });
}

const stack = (id: string, n: number) => new ItemStack(id, n);

export function castlePlan(): Placement[] {
  const plan: Placement[] = [];
  const { x: cx, y: cy, z: cz } = CASTLE;

  // The island it stands on, flattened to the courtyard.
  plan.push(...island({ x: cx, y: cy, z: cz }, CASTLE_ISLAND_RADIUS, 9300, 10));
  for (let dx = -WALL_HALF; dx <= WALL_HALF; dx++) {
    for (let dz = -WALL_HALF; dz <= WALL_HALF; dz++) {
      plan.push(block({ x: cx + dx, y: cy, z: cz + dz }, 'minecraft:grass_block'));
      plan.push(block({ x: cx + dx, y: cy - 1, z: cz + dz }, 'minecraft:dirt'));
    }
  }
  // A cloud path from the castle's front edge to the gate.
  fill(plan, cx - 1, cy, cz - CASTLE_ISLAND_RADIUS - 2, cx + 1, cy, cz - WALL_HALF, TRIM);

  // Curtain wall with crenellations and a gate.
  ring(plan, cx, cz, WALL_HALF, cy + 1, WALL_TOP, WALL);
  crenellations(plan, cx, cz, WALL_HALF, WALL_TOP + 1);
  fill(plan, cx - 1, cy + 1, cz - WALL_HALF, cx + 1, cy + 4, cz - WALL_HALF, AIR);

  // Corner towers with a chest each. The Storm Crystal is in the far-left one.
  tower(plan, cx - WALL_HALF, cz - WALL_HALF, () => [stack('minecraft:golden_apple', 2), stack('minecraft:arrow', 32), stack('minecraft:bread', 8)]);
  tower(plan, cx + WALL_HALF, cz - WALL_HALF, () => [stack('minecraft:iron_ingot', 8), stack('minecraft:feather', 16), stack('minecraft:white_wool', 8)]);
  tower(plan, cx - WALL_HALF, cz + WALL_HALF, () => [stack(STORM_CRYSTAL, 1), stack('minecraft:diamond', 3), stack('minecraft:potato', 6)]);
  tower(plan, cx + WALL_HALF, cz + WALL_HALF, () => [stack('minecraft:baked_potato', 8), stack('minecraft:emerald', 6), stack('minecraft:wind_charge', 8)]);

  // The keep: hollow, lit, with a staircase to the roof.
  fill(plan, cx - KEEP_HALF, cy, cz - KEEP_HALF, cx + KEEP_HALF, cy, cz + KEEP_HALF, TRIM);
  ring(plan, cx, cz, KEEP_HALF, cy + 1, KEEP_ROOF - 1, WALL);
  fill(plan, cx - KEEP_HALF + 1, cy + 1, cz - KEEP_HALF + 1, cx + KEEP_HALF - 1, KEEP_ROOF - 1, cz + KEEP_HALF - 1, AIR);
  fill(plan, cx - 1, cy + 1, cz - KEEP_HALF, cx + 1, cy + 3, cz - KEEP_HALF, AIR);
  for (const [lx, lz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) plan.push(block({ x: cx + lx, y: cy, z: cz + lz }, LIGHT));
  // Ten steps along the front wall, from the left corner up to the roof (the
  // back of the roof is the throne and the glass case).
  const stairZ = [cz - KEEP_HALF + 1, cz - KEEP_HALF + 2];
  for (let i = 0; i < KEEP_ROOF - cy - 1; i++) {
    for (const z of stairZ) plan.push(block({ x: cx - KEEP_HALF + 1 + i, y: cy + 1 + i, z }, TRIM));
  }

  // The roof is the throne-room arena, wider than the keep.
  fill(plan, cx - ARENA_HALF, KEEP_ROOF, cz - ARENA_HALF, cx + ARENA_HALF, KEEP_ROOF, cz + ARENA_HALF, TRIM);
  // The stairwell opening, over the top steps.
  const stairTop = cx - KEEP_HALF + 1 + (KEEP_ROOF - cy - 2);
  for (const z of stairZ) fill(plan, stairTop - 3, KEEP_ROOF, z, stairTop, KEEP_ROOF, z, AIR);
  ring(plan, cx, cz, ARENA_HALF, KEEP_ROOF + 1, KEEP_ROOF + 1, WALL);
  ring(plan, cx, cz, ARENA_HALF, KEEP_ROOF + 2, KEEP_ROOF + 2, GLASS);
  for (const [lx, lz] of [[-10, -10], [10, -10], [-10, 10], [10, 10], [0, -10]] as const) {
    plan.push(block({ x: cx + lx, y: KEEP_ROOF, z: cz + lz }, LIGHT));
  }

  // The throne altar, and the Floatatoes' glass case behind it.
  plan.push(block(ALTAR, STORM_ALTAR));
  fill(plan, CASE.x0 - 1, CASE.y0, CASE.z0 - 1, CASE.x1 + 1, CASE.y1 + 1, CASE.z1 + 1, GLASS);
  fill(plan, CASE.x0, CASE.y0, CASE.z0, CASE.x1, CASE.y1, CASE.z1, AIR);
  for (const x of [CASE.x0, CASE.x1]) {
    for (const z of [CASE.z0, CASE.z1]) plan.push(block({ x, y: KEEP_ROOF, z }, LIGHT));
  }
  plan.push({ kind: 'spawn', at: { x: cx + 0.5, y: CASE.y0 + 0.5, z: CASE.z0 + 1.5 }, id: FLOATATO, count: 4 });

  // Guards in the courtyard.
  for (const at of COURTYARD_SPOTS.slice(0, 4)) plan.push({ kind: 'spawn', at, id: CHARGE, count: 1 });
  return plan;
}

/** True if the point is inside the Floatatoes' glass case (for the "already spawned" check). */
export const CASE_CENTER = { x: (CASE.x0 + CASE.x1) / 2 + 0.5, y: CASE.y0 + 1, z: (CASE.z0 + CASE.z1) / 2 + 0.5 };

export type Section = { key: string; plan: () => Placement[] };

/** Built in order; a world keeps the keys of the tiles it has finished. */
export const SECTIONS: Section[] = [
  { key: 'start', plan: startPlan },
  { key: 'start_pad', plan: startPadPlan },
  { key: 'chain', plan: chainPlan },
  { key: 'castle', plan: castlePlan },
];
