// Floatatoes: flying potatoes found only in the Sky Castle's glass case.
// Tame one with a potato; it follows you, comes along through Cloud
// Portals, and catches you (Slow Falling) when you fall.
import { system, world, type Dimension, type Entity, type Player, type Vector3 } from '@minecraft/server';

import { FLOATATO } from './layout';

const CATCH_COOLDOWN = 200;
const caughtAt = new Map<string, number>();

function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage(args.length ? { translate: key, with: args } : { translate: key });
}

const DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end', 'steveo:clouds'];

function allFloatatoes(): Entity[] {
  const found: Entity[] = [];
  for (const id of DIMENSIONS) {
    try {
      found.push(...world.getDimension(id).getEntities({ type: FLOATATO }));
    } catch {
      // Dimension or type not available.
    }
  }
  return found;
}

function ownerId(floatato: Entity): string | undefined {
  try {
    const tameable = floatato.getComponent('minecraft:tameable');
    return tameable?.isTamed ? tameable.tamedToPlayerId : undefined;
  } catch {
    return undefined;
  }
}

export function isGolden(floatato: Entity): boolean {
  return floatato.getComponent('minecraft:variant')?.value === 1;
}

/** The tamed Floatatoes of `player` within `radius` of them. */
export function floatatoesOf(player: Player, radius: number): Entity[] {
  try {
    return player.dimension
      .getEntities({ type: FLOATATO, location: player.location, maxDistance: radius })
      .filter((f) => ownerId(f) === player.id);
  } catch {
    return [];
  }
}

/** Brings floatatoes along after their owner changed dimension. */
export function bringAlong(floatatoes: Entity[], dimension: Dimension, at: Vector3): void {
  floatatoes.forEach((f, i) => {
    try {
      f.teleport({ x: at.x + (i % 2 ? 1 : -1), y: at.y + 1, z: at.z + 1 }, { dimension });
    } catch {
      // It stays behind.
    }
  });
}

function catchFalls(): void {
  const now = system.currentTick;
  const byOwner = new Map<string, Entity>();
  for (const f of allFloatatoes()) {
    const owner = ownerId(f);
    if (owner && !byOwner.has(owner)) byOwner.set(owner, f);
  }
  if (byOwner.size === 0) return;
  for (const player of world.getAllPlayers()) {
    const floatato = byOwner.get(player.id);
    if (!floatato) continue;
    if ((caughtAt.get(player.id) ?? 0) > now) continue;
    let falling = false;
    try {
      falling = !player.isOnGround && !player.isFlying && !player.isGliding && player.getVelocity().y < -0.6 && !player.getEffect('slow_falling');
    } catch {
      continue;
    }
    if (!falling || floatato.dimension.id !== player.dimension.id) continue;
    if (Math.hypot(floatato.location.x - player.location.x, floatato.location.z - player.location.z) > 48) continue;
    caughtAt.set(player.id, now + CATCH_COOLDOWN);
    player.addEffect('slow_falling', 200, { showParticles: true });
    try {
      floatato.teleport({ x: player.location.x + 0.8, y: player.location.y + 2, z: player.location.z });
    } catch {
      // It still caught you.
    }
    player.playSound('mob.allay.item_given', { pitch: 1.3 });
    say(player, isGolden(floatato) ? 'clouds.floatato.caught_golden' : 'clouds.floatato.caught');
  }
}

export function installFloatatoes(): void {
  system.runInterval(catchFalls, 4);
  // No entityTypes filter: it throws at startup if the type failed to load.
  world.afterEvents.dataDrivenEntityTrigger.subscribe((event) => {
    if (event.eventId !== 'steveo:on_tame') return;
    let floatato: Entity;
    try {
      floatato = event.entity;
      if (floatato.typeId !== FLOATATO) return;
    } catch {
      return;
    }
    // The owner is set after the tame event, so look for it a tick later.
    system.run(() => announceTame(floatato));
  });
}

function announceTame(floatato: Entity): void {
  if (!floatato.isValid) return;
  const id = ownerId(floatato);
  const owner = id ? world.getAllPlayers().find((p) => p.id === id) : undefined;
  if (!owner) return;
  if (isGolden(floatato)) {
    owner.onScreenDisplay.setTitle({ translate: 'clouds.floatato.golden.title' }, {
      subtitle: { translate: 'clouds.floatato.golden.subtitle' },
      fadeInDuration: 10,
      stayDuration: 50,
      fadeOutDuration: 20,
    });
  }
  say(owner, 'clouds.floatato.tamed');
  owner.playSound('random.levelup', { pitch: 1.5 });
}
