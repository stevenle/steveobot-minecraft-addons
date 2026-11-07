// The Cloud Staff: fires a vanilla wind charge, then rests for 1.5 seconds.
//
// The vanilla wind charge sets isolated_physics to false itself, so a
// script-launched one moves (see the potato-gun gotcha in CLAUDE.md). It
// only does 1 damage on its own, so a hit from the staff adds more.
import { EntityDamageCause, system, world, type Player } from '@minecraft/server';

import { onItemUse } from '@shared/use';

import { CLOUD_STAFF } from './layout';

const COOLDOWN_CATEGORY = 'steveo_cloud_staff';
const COOLDOWN_TICKS = 30;
const SPEED = 1.5;
const BONUS_DAMAGE = 6;
/** Projectile id -> shooter, for the damage bonus; forgotten after a few seconds. */
const shots = new Map<string, Player>();

export function fireStaff(player: Player): boolean {
  if (player.getItemCooldown(COOLDOWN_CATEGORY) > 0) return false;
  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  const at = { x: head.x + view.x * 1.2, y: head.y + view.y * 1.2 - 0.1, z: head.z + view.z * 1.2 };
  const charge = player.dimension.spawnEntity('minecraft:wind_charge_projectile', at);
  const projectile = charge.getComponent('minecraft:projectile');
  if (projectile) {
    projectile.owner = player;
    projectile.shoot({ x: view.x * SPEED, y: view.y * SPEED, z: view.z * SPEED });
  }
  player.startItemCooldown(COOLDOWN_CATEGORY, COOLDOWN_TICKS);
  player.playSound('wind_charge.burst', { pitch: 1.4, volume: 0.6 });
  const id = charge.id;
  shots.set(id, player);
  system.runTimeout(() => shots.delete(id), 100);
  return true;
}

export function installStaff(): void {
  onItemUse(
    (typeId) => typeId === CLOUD_STAFF,
    (player) => {
      try {
        fireStaff(player);
      } catch (err) {
        player.sendMessage({ translate: 'clouds.debug.error', with: [String(err)] });
      }
    },
  );

  world.afterEvents.projectileHitEntity.subscribe((event) => {
    let id: string;
    try {
      id = event.projectile.id;
    } catch {
      return;
    }
    const shooter = shots.get(id);
    if (!shooter) return;
    shots.delete(id);
    const hit = event.getEntityHit().entity;
    if (!hit || !shooter.isValid || hit.id === shooter.id) return;
    try {
      hit.applyDamage(BONUS_DAMAGE, { cause: EntityDamageCause.entityAttack, damagingEntity: shooter });
    } catch {
      // Gone already.
    }
  });
}
