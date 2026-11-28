/**
 * Character & boss behaviors:
 *   - Singing Dog: plays cheerful music notes and buffs nearby players.
 *   - Billip: hurting a player inflicts Slowness (draining their speed/power).
 *   - Rocket-Robo: jetpack flame particles and thruster hops.
 *   - Robo-Lizard: occasional short-range zap bolts.
 *   - King Viking: battle cry, Boom Bolts, and Viking-Bot reinforcements.
 *   - Crew Bosses: Robo-Rabbit Boy (dash + bolts), Super Rabbit Boss (leap +
 *     ground-pound shockwave), Mega-Robo (splash rockets + reinforcements).
 */
import { EntityDamageCause, Player, system, world, type Entity } from '@minecraft/server';

import { launchBolt } from './bolts';
import {
  add,
  announceNear,
  BILLIP,
  CREW_BOSSES,
  dist,
  forEachDimension,
  isVulnerable,
  KING_VIKING,
  log,
  MEGA_ROBO,
  normalize,
  ROBO_LIZARD,
  ROBO_RABBIT_BOY,
  ROCKET_ROBO,
  say,
  SINGING_DOG,
  sub,
  SUPER_RABBIT_BOSS,
  VIKING_BOT,
  yaw,
} from './common';

const AI_INTERVAL = 10;
const nextAction = new Map<string, number>();
const lastDrainMessage = new Map<string, number>();

function nearestPlayer(mob: Entity, range: number): Player | undefined {
  return mob.dimension
    .getPlayers({ location: mob.location, maxDistance: range })
    .filter(isVulnerable)
    .sort((a, b) => dist(a.location, mob.location) - dist(b.location, mob.location))[0];
}

// ---------- Billip: Slowness on hit (power-draining touch) ----------

world.afterEvents.entityHurt.subscribe((event) => {
  const victim = event.hurtEntity;
  const attacker = event.damageSource.damagingEntity;
  if (!(victim instanceof Player) || !attacker || attacker.typeId !== BILLIP) return;
  try {
    victim.addEffect('slowness', 100, { amplifier: 1, showParticles: true });
    victim.dimension.playSound('random.fizz', victim.location, { volume: 0.9, pitch: 0.75 });
    victim.dimension.spawnParticle('minecraft:dragon_breath_trail', add(victim.location, { x: 0, y: 1, z: 0 }));
    const tick = system.currentTick;
    if (tick - (lastDrainMessage.get(victim.id) ?? -200) >= 80) {
      lastDrainMessage.set(victim.id, tick);
      say(victim, 'super_rabbit.billip.drain');
    }
  } catch (err) {
    log.warn(`Billip slowness failed: ${String(err)}`);
  }
});

// ---------- Singing Dog: Music & Fun Aura ----------

const MELODY_PITCHES = [0.75, 0.89, 1.0, 1.12, 1.25, 1.5];

function tickSingingDog(dog: Entity, tick: number): void {
  if (tick < (nextAction.get(dog.id) ?? 0)) return;
  nextAction.set(dog.id, tick + 55 + Math.floor(Math.random() * 25));
  const loc = add(dog.location, { x: 0, y: 1.1, z: 0 });
  const pitch = MELODY_PITCHES[Math.floor(Math.random() * MELODY_PITCHES.length)] ?? 1.0;
  dog.dimension.playSound('note.harp', loc, { volume: 1.0, pitch });
  dog.dimension.spawnParticle('minecraft:note_particle', loc);
  for (const player of dog.dimension.getPlayers({ location: dog.location, maxDistance: 8 })) {
    player.addEffect('regeneration', 80, { amplifier: 0, showParticles: false });
    player.addEffect('speed', 80, { amplifier: 0, showParticles: false });
  }
}

// ---------- Robot Minions ----------

function tickRocketRobo(robo: Entity, tick: number): void {
  robo.dimension.spawnParticle('minecraft:basic_flame_particle', add(robo.location, { x: 0, y: 0.2, z: 0 }));
  if (tick < (nextAction.get(robo.id) ?? 0)) return;
  const target = nearestPlayer(robo, 16);
  if (!target) return;
  nextAction.set(robo.id, tick + 50 + Math.floor(Math.random() * 20));
  const dir = normalize(sub(target.location, robo.location));
  robo.applyKnockback({ x: dir.x * 0.7, z: dir.z * 0.7 }, 0.55);
  robo.dimension.playSound('mob.blaze.shoot', robo.location, { volume: 0.5, pitch: 1.5 });
}

function tickRoboLizard(lizard: Entity, tick: number): void {
  if (tick < (nextAction.get(lizard.id) ?? 0)) return;
  const target = nearestPlayer(lizard, 14);
  if (!target || dist(target.location, lizard.location) < 4) return;
  nextAction.set(lizard.id, tick + 75 + Math.floor(Math.random() * 25));
  const from = add(lizard.getHeadLocation(), { x: 0, y: 0.1, z: 0 });
  const aim = normalize(sub(add(target.location, { x: 0, y: 1, z: 0 }), from));
  launchBolt(lizard, add(from, aim), aim, { speed: 0.7, damage: 3, splashRadius: 0, maxTicks: 35 });
  lizard.dimension.playSound('random.orb', from, { volume: 0.8, pitch: 1.8 });
}

// ---------- King Viking ----------

function tickKingViking(kv: Entity, tick: number): void {
  if (tick < (nextAction.get(kv.id) ?? 0)) return;
  const target = nearestPlayer(kv, 22);
  if (!target) return;
  nextAction.set(kv.id, tick + 80 + Math.floor(Math.random() * 30));

  const d = dist(target.location, kv.location);
  const nearbyBots = kv.dimension.getEntities({ type: VIKING_BOT, location: kv.location, maxDistance: 20 });
  if (nearbyBots.length < 3 && Math.random() < 0.35) {
    kv.dimension.playSound('mob.pillager.celebrate', kv.location, { volume: 1.4, pitch: 0.8 });
    announceNear(kv.dimension, kv.location, 24, 'super_rabbit.king_viking.cry');
    for (const ox of [-1.5, 1.5]) {
      try {
        kv.dimension.spawnEntity(VIKING_BOT, add(kv.location, { x: ox, y: 0.2, z: 0 }));
      } catch {
        // Blocked spot.
      }
    }
    return;
  }

  if (d >= 4) {
    const from = kv.getHeadLocation();
    const aim = normalize(sub(add(target.location, { x: 0, y: 1, z: 0 }), from));
    launchBolt(kv, add(from, aim), aim, { speed: 0.65, damage: 5, splashRadius: 1.8, maxTicks: 45 });
    kv.dimension.playSound('mob.ghast.fireball', from, { volume: 1.2, pitch: 0.9 });
  }
}

// ---------- Crew Bosses ----------

function tickBillip(billip: Entity, tick: number): void {
  if (tick < (nextAction.get(billip.id) ?? 0)) return;
  const target = nearestPlayer(billip, 18);
  if (!target) return;
  nextAction.set(billip.id, tick + 55 + Math.floor(Math.random() * 20));
  const dir = normalize(sub(target.location, billip.location));
  billip.applyKnockback({ x: dir.x * 1.05, z: dir.z * 1.05 }, 0.42);
  billip.dimension.playSound('mob.irongolem.throw', billip.location, { volume: 0.9, pitch: 1.3 });
}

function tickRoboRabbitBoy(boss: Entity, tick: number): void {
  if (tick < (nextAction.get(boss.id) ?? 0)) return;
  const target = nearestPlayer(boss, 22);
  if (!target) return;
  nextAction.set(boss.id, tick + 55 + Math.floor(Math.random() * 20));
  const d = dist(target.location, boss.location);
  const from = boss.getHeadLocation();
  const aim = normalize(sub(add(target.location, { x: 0, y: 1, z: 0 }), from));
  if (d >= 5) {
    for (const angle of [-8, 8]) {
      launchBolt(boss, add(from, aim), yaw(aim, angle), { speed: 0.8, damage: 4, splashRadius: 0, maxTicks: 40 });
    }
    boss.dimension.playSound('random.orb', from, { volume: 1.0, pitch: 1.5 });
  } else {
    boss.applyKnockback({ x: aim.x * 0.95, z: aim.z * 0.95 }, 0.55);
  }
}

function tickSuperRabbitBoss(boss: Entity, tick: number): void {
  if (tick < (nextAction.get(boss.id) ?? 0)) return;
  const target = nearestPlayer(boss, 20);
  if (!target) return;
  nextAction.set(boss.id, tick + 75 + Math.floor(Math.random() * 25));

  const dir = normalize(sub(target.location, boss.location));
  boss.applyKnockback({ x: dir.x * 0.9, z: dir.z * 0.9 }, 0.65);
  boss.dimension.playSound('mob.ravager.roar', boss.location, { volume: 1.2, pitch: 0.85 });

  // Ground-pound shockwave shortly after the leap lands
  system.runTimeout(() => {
    if (!boss.isValid) return;
    try {
      const at = boss.location;
      boss.dimension.spawnParticle('minecraft:large_explosion', at);
      boss.dimension.playSound('random.explode', at, { volume: 1.1, pitch: 0.7 });
      for (const player of boss.dimension.getPlayers({ location: at, maxDistance: 5.5 })) {
        if (!isVulnerable(player)) continue;
        player.applyDamage(6, { cause: EntityDamageCause.entityAttack, damagingEntity: boss });
        const push = normalize({ x: player.location.x - at.x, y: 0, z: player.location.z - at.z });
        player.applyKnockback({ x: push.x * 1.4, z: push.z * 1.4 }, 0.6);
      }
    } catch {
      // Unloaded.
    }
  }, 16);
}

const MEGA_SUMMONED_PROP = 'steveo:mega_summoned';

function tickMegaRobo(boss: Entity, tick: number): void {
  if (tick < (nextAction.get(boss.id) ?? 0)) return;
  const target = nearestPlayer(boss, 24);
  if (!target) return;
  nextAction.set(boss.id, tick + 70 + Math.floor(Math.random() * 25));

  const health = boss.getComponent('minecraft:health');
  if (health && health.currentValue <= health.effectiveMax * 0.5 && boss.getDynamicProperty(MEGA_SUMMONED_PROP) !== true) {
    boss.setDynamicProperty(MEGA_SUMMONED_PROP, true);
    boss.dimension.playSound('mob.irongolem.repair', boss.location, { volume: 1.5, pitch: 0.7 });
    for (const ox of [-2, 2]) {
      try {
        boss.dimension.spawnEntity(VIKING_BOT, add(boss.location, { x: ox, y: 0.2, z: 0 }));
      } catch {
        // Blocked spot.
      }
    }
  }

  const from = boss.getHeadLocation();
  const aim = normalize(sub(add(target.location, { x: 0, y: 1, z: 0 }), from));
  for (const angle of [-10, 0, 10]) {
    launchBolt(boss, add(from, aim), yaw(aim, angle), { speed: 0.62, damage: 6, splashRadius: 2.2, maxTicks: 50 });
  }
  boss.dimension.playSound('mob.ghast.fireball', from, { volume: 1.5, pitch: 0.65 });
}

// ---------- Main AI loop ----------

system.runInterval(() => {
  const tick = system.currentTick;
  forEachDimension((dim) => {
    const runAll = (type: string, fn: (e: Entity, t: number) => void) => {
      for (const entity of dim.getEntities({ type })) {
        try {
          fn(entity, tick);
        } catch (err) {
          log.warn(`AI for ${type} failed: ${String(err)}`);
        }
      }
    };
    runAll(SINGING_DOG, tickSingingDog);
    runAll(ROCKET_ROBO, tickRocketRobo);
    runAll(ROBO_LIZARD, tickRoboLizard);
    runAll(KING_VIKING, tickKingViking);
    runAll(BILLIP, tickBillip);
    runAll(ROBO_RABBIT_BOY, tickRoboRabbitBoy);
    runAll(SUPER_RABBIT_BOSS, tickSuperRabbitBoss);
    runAll(MEGA_ROBO, tickMegaRobo);
  });
}, AI_INTERVAL);

// ---------- Boss defeat announcements & cleanup ----------

const BOSS_NAMES: Record<string, string> = {
  [ROBO_RABBIT_BOY]: 'Robo-Rabbit Boy',
  [BILLIP]: 'Billip',
  [SUPER_RABBIT_BOSS]: 'Super Rabbit Boss',
  [MEGA_ROBO]: 'Mega-Robo',
  [KING_VIKING]: 'King Viking',
};

world.afterEvents.entityDie.subscribe(
  (event) => {
    const dead = event.deadEntity;
    nextAction.delete(dead.id);
    const label = BOSS_NAMES[dead.typeId];
    if (!label) return;
    try {
      dead.dimension.playSound('random.levelup', dead.location, { volume: 0.9 });
      announceNear(dead.dimension, dead.location, 36, 'super_rabbit.boss.defeated', label);
    } catch {
      // Unloading.
    }
  },
  { entityTypes: [...CREW_BOSSES, KING_VIKING] },
);
