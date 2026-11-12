/**
 * Battle Arena — place the arena block, use it, pick a length, and fight
 * escalating waves of mobs with a boss at the end of each round.
 *
 *   waves.ts  what each wave and boss is made of (themes, gear, bosses)
 *   arena.ts  one running battle: countdown, fights, fighters, ending
 *   main.ts   the block, the menu, events, the debug command
 *
 * Debug: /scriptevent steveo:arena <status|start [quick|standard|epic]|skip|boss|summon <boss>|stop|give>
 */
import { EntityDamageCause, ItemStack, Player, system, world, type Block, type Vector3 } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';

import { Arena, ARENA_BLOCK, isLit, JOIN_RANGE, log, MOB_PROPERTY, MOB_TAG, msg, PREFIX, setLit } from './arena';
import { ALL_BOSSES, MODES, type Mode } from './waves';

/** Two arenas this close would fight over the same mobs. */
const MIN_ARENA_SPACING = 48;

const arenas = new Map<string, Arena>();

function say(player: Player, key: string, ...args: string[]): void {
  player.sendMessage({ rawtext: [PREFIX, msg(key, ...args)] });
}

function keyOf(dimensionId: string, at: Vector3): string {
  return `${dimensionId}:${at.x},${at.y},${at.z}`;
}

function nearestArena(player: Player, range = Infinity): Arena | undefined {
  let best: Arena | undefined;
  let bestD = range;
  for (const arena of arenas.values()) {
    if (arena.dimensionId !== player.dimension.id) continue;
    const d = Math.hypot(arena.center.x - player.location.x, arena.center.y - player.location.y, arena.center.z - player.location.z);
    if (d <= bestD) {
      best = arena;
      bestD = d;
    }
  }
  return best;
}

function start(player: Player, block: Block, mode: Mode): void {
  const key = keyOf(block.dimension.id, block.location);
  if (arenas.has(key)) return;
  const crowded = [...arenas.values()].some(
    (a) =>
      a.dimensionId === block.dimension.id &&
      Math.hypot(a.block.x - block.location.x, a.block.y - block.location.y, a.block.z - block.location.z) < MIN_ARENA_SPACING,
  );
  if (crowded) {
    say(player, 'arena.start.too_close');
    return;
  }
  const center = { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 };
  const fighters = block.dimension.getPlayers({ location: center, maxDistance: JOIN_RANGE });
  if (!fighters.some((p) => p.id === player.id)) fighters.push(player);
  const arena = new Arena(block.dimension, block.location, mode, fighters);
  arenas.set(arena.key, arena);
  arena.tell(
    msg('arena.start.chat', player.name, { translate: `arena.mode.${mode.key}` }, fighters.map((p) => p.name).join(', ')),
  );
  arena.title(msg('arena.start.title'), msg('arena.start.subtitle', String(arena.waveCount), String(mode.bosses)), 50);
  arena.sound('mob.evocation_illager.prepare_summon', 0.8);
  log.info(`${arena.key} started (${mode.key}) with ${fighters.length} fighter(s)`);
}

async function openMenu(player: Player, block: Block): Promise<void> {
  const form = new ActionFormData().title({ translate: 'arena.menu.title' }).body({ translate: 'arena.menu.body' });
  for (const mode of MODES) {
    form.button(msg(`arena.menu.${mode.key}`, String(mode.bosses * mode.wavesPerBoss), String(mode.bosses)));
  }
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  const mode = MODES[response.selection];
  if (!mode) return;
  try {
    if (block.typeId !== ARENA_BLOCK) return;
  } catch {
    return;
  }
  start(player, block, mode);
}

function onUse(player: Player, block: Block): void {
  const arena = arenas.get(keyOf(block.dimension.id, block.location));
  if (arena) {
    const fight = arena.current;
    if (arena.phase === 'fighting' && fight?.kind === 'boss') say(player, 'arena.use.boss', String(arena.bossNumber));
    else say(player, 'arena.use.running', String(arena.waveNumber), String(arena.waveCount));
    return;
  }
  void openMenu(player, block);
}

system.beforeEvents.startup.subscribe((event) => {
  event.blockComponentRegistry.registerCustomComponent(ARENA_BLOCK, {
    onPlayerInteract: (e) => {
      const player = e.player;
      if (!player) return;
      const block = e.block;
      // Forms cannot open from inside a block callback.
      system.run(() => {
        if (player.isValid) onUse(player, block);
      });
    },
    // A block left lit with no battle behind it (the world reloaded
    // mid-battle, or it ended while the block was unloaded) goes out.
    onTick: (e) => {
      const block = e.block;
      if (!isLit(block.permutation)) return;
      if (arenas.has(keyOf(block.dimension.id, block.location))) return;
      const dimension = block.dimension;
      const at = block.location;
      system.run(() => setLit(dimension, at, false));
    },
  });
});

// A running arena's block cannot be mined out from under the battle.
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.block.typeId !== ARENA_BLOCK) return;
  if (!arenas.has(keyOf(event.dimension.id, event.block.location))) return;
  event.cancel = true;
  const player = event.player;
  system.run(() => {
    if (player.isValid) say(player, 'arena.break.blocked');
  });
});

world.afterEvents.entityDie.subscribe((event) => {
  const dead = event.deadEntity;
  try {
    if (dead.typeId === 'minecraft:player') {
      for (const arena of arenas.values()) {
        if (arena.fighters.has(dead.id)) arena.onFighterDied(dead as Player);
      }
      return;
    }
    if (!dead.hasTag(MOB_TAG)) return;
    const key = dead.getDynamicProperty(MOB_PROPERTY);
    const arena = typeof key === 'string' ? arenas.get(key) : undefined;
    arena?.onMobDied(dead, dead.location);
  } catch (err) {
    log.warn(`death handling failed: ${String(err)}`);
  }
});

// Damage to arena mobs, for the leaderboards. Arrows and tridents report
// the shooter as the damaging entity.
world.afterEvents.entityHurt.subscribe((event) => {
  const attacker = event.damageSource.damagingEntity;
  const hurt = event.hurtEntity;
  // The Iron Tyrant throws whoever it hits into the air, as an iron golem
  // does. The golem's own toss came with its runtime identifier, which the
  // boss no longer has (it would not render with it; see assets/bosses.mjs).
  if (attacker?.typeId === 'steveo:iron_tyrant' && event.damageSource.cause === EntityDamageCause.entityAttack) {
    try {
      hurt.applyKnockback({ x: 0, z: 0 }, 0.6);
    } catch {
      // The victim died from the hit.
    }
    return;
  }
  if (!(attacker instanceof Player)) return;
  try {
    if (!hurt.hasTag(MOB_TAG)) return;
    const key = hurt.getDynamicProperty(MOB_PROPERTY);
    const arena = typeof key === 'string' ? arenas.get(key) : undefined;
    arena?.recordDamage(attacker, event.damage);
  } catch {
    // The mob is already gone.
  }
});

world.afterEvents.playerLeave.subscribe((event) => {
  for (const arena of arenas.values()) arena.onFighterLeft(event.playerId);
});

system.runInterval(() => {
  for (const [key, arena] of arenas) {
    try {
      arena.tick();
    } catch (err) {
      log.error(`arena ${key} tick failed`, err);
    }
    if (arena.ended) arenas.delete(key);
  }
}, 10);

// Mobs from a battle that no longer exists (ended while they were unloaded,
// or the world reloaded mid-battle) are removed as they turn up.
system.runInterval(() => {
  for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) {
    try {
      for (const mob of world.getDimension(id).getEntities({ tags: [MOB_TAG] })) {
        const key = mob.getDynamicProperty(MOB_PROPERTY);
        const arena = typeof key === 'string' ? arenas.get(key) : undefined;
        if (!arena || !arena.mobs.has(mob.id)) mob.remove();
      }
    } catch (err) {
      log.warn(`orphan sweep in ${id} failed: ${String(err)}`);
    }
  }
}, 100);

// ------------------------------------------------------------------- debug

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:arena') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;
    const [command = '', arg] = event.message.trim().split(/\s+/);
    const arena = nearestArena(player, 128);

    switch (command) {
      case 'give':
        player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(ARENA_BLOCK, 1));
        say(player, 'arena.debug.given');
        break;
      case 'start': {
        const mode = MODES.find((m) => m.key === arg) ?? MODES[0];
        const at = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
        const block = player.dimension.getBlock(at);
        if (!mode || !block) break;
        if (block.typeId !== ARENA_BLOCK) block.setType(ARENA_BLOCK);
        player.teleport({ x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 });
        start(player, block, mode);
        break;
      }
      case 'summon': {
        // A boss on its own, outside any battle, to check that it loads and fights.
        const boss = ALL_BOSSES.find((b) => b.key === arg);
        if (!boss) {
          say(player, 'arena.debug.summon_help', ALL_BOSSES.map((b) => b.key).join(', '));
          break;
        }
        const view = player.getViewDirection();
        const at = { x: player.location.x + view.x * 6, y: player.location.y, z: player.location.z + view.z * 6 };
        try {
          player.dimension.spawnEntity(boss.entity, at);
          say(player, 'arena.debug.summoned', boss.entity);
        } catch (err) {
          say(player, 'arena.debug.summon_failed', boss.entity, String(err));
        }
        break;
      }
      case 'skip':
        if (arena) arena.skipFight();
        else say(player, 'arena.debug.none');
        break;
      case 'boss':
        if (arena) arena.skipToBoss();
        else say(player, 'arena.debug.none');
        break;
      case 'stop':
        if (arena) {
          arena.finish('stopped');
          arenas.delete(arena.key);
        } else say(player, 'arena.debug.none');
        break;
      case 'status': {
        if (!arena) {
          say(player, 'arena.debug.status_none', String(arenas.size));
          break;
        }
        const fighters = [...arena.fighters.values()]
          .map((f) => `${f.name}${f.died ? ' (fallen)' : f.left ? ' (left)' : ''}`)
          .join(', ');
        const fights = arena.fights.map((f, i) => (f.kind === 'wave' ? 'W' : 'B') + (i === arena.index ? '*' : '')).join(' ');
        say(
          player,
          'arena.debug.status',
          arena.mode.key,
          fights,
          arena.phase,
          String(arena.mobs.size),
          String(arena.bossesDefeated),
          fighters,
          String(arenas.size),
        );
        break;
      }
      default:
        say(player, 'arena.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
