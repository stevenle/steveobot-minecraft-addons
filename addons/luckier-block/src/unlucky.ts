/**
 * The bad outcomes. Each one gets the player who broke the block and the
 * center of the cell the block used to occupy (always air by now, so it is a
 * safe place to spawn things).
 *
 * Nothing here destroys player-placed blocks directly: cobwebs only fill air,
 * and the only thing that breaks terrain is the TNT outcome, which is the point.
 * Luckier blocks themselves are explosion-proof, so a stash does not chain.
 */
import { EquipmentSlot, ItemStack, type Dimension, type Player, type Vector3 } from '@minecraft/server';

export interface Unlucky {
  name: string;
  weight: number;
  run(player: Player, at: Vector3, dimension: Dimension): void;
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function spawn(dimension: Dimension, id: string, location: Vector3): void {
  try {
    dimension.spawnEntity(id, location);
  } catch {
    // Peaceful difficulty, an unloaded chunk, or outside the world.
  }
}

/** A spot `radius` blocks out on a circle around `center`, at `step` of `count`. */
function ring(center: Vector3, radius: number, step: number, count: number): Vector3 {
  const angle = (step / count) * Math.PI * 2;
  return { x: center.x + Math.cos(angle) * radius, y: center.y, z: center.z + Math.sin(angle) * radius };
}

export const UNLUCKY: readonly Unlucky[] = [
  {
    name: 'ambush',
    weight: 5,
    run(_player, at, dimension) {
      const mobs = ['minecraft:zombie', 'minecraft:skeleton', 'minecraft:spider', 'minecraft:husk', 'minecraft:stray'];
      const count = randInt(3, 5);
      for (let i = 0; i < count; i++) spawn(dimension, pick(mobs), at);
    },
  },
  {
    name: 'tnt',
    weight: 4,
    run(_player, at, dimension) {
      const count = randInt(1, 3);
      for (let i = 0; i < count; i++) spawn(dimension, 'minecraft:tnt', at);
    },
  },
  {
    name: 'lightning',
    weight: 3,
    run(player, _at, dimension) {
      spawn(dimension, 'minecraft:lightning_bolt', player.location);
    },
  },
  {
    name: 'curse',
    weight: 4,
    run(player) {
      const effects = ['blindness', 'nausea', 'poison', 'slowness', 'hunger', 'weakness', 'mining_fatigue', 'darkness'];
      const chosen = new Set<string>();
      while (chosen.size < 3) chosen.add(pick(effects));
      for (const effect of chosen) player.addEffect(effect, randInt(10, 20) * 20, { amplifier: randInt(0, 1) });
    },
  },
  {
    name: 'yeet',
    weight: 3,
    run(player) {
      player.applyKnockback({ x: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, 1.8);
    },
  },
  {
    name: 'webs',
    weight: 3,
    run(player, _at, dimension) {
      const feet = player.location;
      for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        try {
          const block = dimension.getBlock({ x: feet.x + dx, y: feet.y + dy, z: feet.z + dz });
          if (block?.isAir) block.setType('minecraft:web');
        } catch {
          // Outside the world or an unloaded chunk.
        }
      }
      for (let i = 0; i < 3; i++) spawn(dimension, 'minecraft:cave_spider', ring(feet, 2.5, i, 3));
    },
  },
  {
    name: 'silverfish',
    weight: 3,
    run(_player, at, dimension) {
      for (let i = 0; i < 8; i++) spawn(dimension, 'minecraft:silverfish', at);
    },
  },
  {
    name: 'fire',
    weight: 3,
    run(player) {
      player.setOnFire(8, true);
    },
  },
  {
    name: 'creeper',
    weight: 3,
    run(player, _at, dimension) {
      const view = player.getViewDirection();
      const behind = { x: player.location.x - view.x * 1.5, y: player.location.y, z: player.location.z - view.z * 1.5 };
      spawn(dimension, 'minecraft:creeper', behind);
      dimension.playSound('random.fuse', behind);
    },
  },
  {
    name: 'fangs',
    weight: 3,
    run(player, _at, dimension) {
      const feet = player.location;
      spawn(dimension, 'minecraft:evocation_fang', feet);
      for (let i = 0; i < 8; i++) spawn(dimension, 'minecraft:evocation_fang', ring(feet, 1.5, i, 8));
    },
  },
  {
    name: 'phantoms',
    weight: 2,
    run(player, _at, dimension) {
      const above = { x: player.location.x, y: player.location.y + 6, z: player.location.z };
      for (let i = 0; i < 3; i++) spawn(dimension, 'minecraft:phantom', ring(above, 3, i, 3));
    },
  },
  {
    name: 'butterfingers',
    weight: 2,
    run(player, _at, dimension) {
      const equipment = player.getComponent('minecraft:equippable');
      const held = equipment?.getEquipment(EquipmentSlot.Mainhand);
      if (!equipment || !held) return;
      equipment.setEquipment(EquipmentSlot.Mainhand, undefined);
      const ahead = player.getViewDirection();
      const head = player.getHeadLocation();
      dimension.spawnItem(held, { x: head.x + ahead.x * 3, y: head.y, z: head.z + ahead.z * 3 });
    },
  },
  {
    name: 'rotten',
    weight: 2,
    run(_player, at, dimension) {
      // A fake jackpot: a fountain of junk.
      const junk = ['minecraft:rotten_flesh', 'minecraft:poisonous_potato', 'minecraft:deadbush', 'minecraft:spider_eye'];
      for (let i = 0; i < 6; i++) dimension.spawnItem(new ItemStack(pick(junk), randInt(4, 12)), at);
    },
  },
];
