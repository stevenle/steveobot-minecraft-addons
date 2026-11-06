/**
 * One running battle: who is fighting, which fight is next, and the mobs
 * that are still standing.
 *
 * A battle is a fixed list of fights (`n` waves, a boss, `n` waves, a
 * boss, ...). Between fights there is a countdown; a fight ends when every
 * mob it spawned is gone. The battle ends in victory when the final boss
 * dies, and in defeat once every player who was there at the start has
 * died at least once. A battle nobody is near for a minute is abandoned.
 *
 * State lives in memory only. If the world reloads mid-battle the battle is
 * gone, and the sweep in main.ts removes its leftover mobs as they load.
 */
import {
  BlockPermutation,
  ItemStack,
  system,
  world,
  type Dimension,
  type Entity,
  type Player,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

import {
  gearLevel,
  GEAR_ITEMS,
  planBosses,
  planWave,
  type BossDef,
  type Kit,
  type MobKind,
  type Mode,
  type WavePlan,
} from './waves';

export const log = createLogger('battle-arena');

export const ARENA_BLOCK = 'steveo:battle_arena';
/** Every arena mob carries this tag; the arena key is in a dynamic property. */
export const MOB_TAG = 'steveo_arena_mob';
export const MOB_PROPERTY = 'steveo:arena';
export const PREFIX: RawMessage = { text: `${Format.gray}[Battle Arena]${Format.reset} ` };

/** Players this close to the block when it is activated join the battle. */
export const JOIN_RANGE = 24;
/** Players this close see the countdown and wave status. */
const AUDIENCE_RANGE = 48;
/** A mob that strays this far is pulled back into the ring. */
const LEASH_RANGE = 32;
/** With no fighter this close for ABANDON_TICKS, the battle is called off. */
const ABANDON_RANGE = 64;
const ABANDON_TICKS = 60 * 20;
/** Mobs spawn on a ring this far from the block. */
const RING = { min: 5, max: 9 };
const COUNTDOWN = { first: 10, wave: 8, boss: 12 };
/** The pause after a fight is cleared, before the next countdown starts. */
const INTERMISSION_TICKS = 6 * 20;
/**
 * A fight's title stays this long (plus 5 ticks in, 10 out); its mobs
 * spawn ANNOUNCE_TICKS after it appears, once it is off the screen.
 */
const TITLE_STAY = 30;
const ANNOUNCE_TICKS = 50;
/** A boss that fails to spawn this many times in a row (once per tick pass) is skipped. */
const BOSS_SPAWN_TRIES = 5;
/** How many players a damage leaderboard lists. */
const LEADERBOARD_SIZE = 5;
/** After this long in one fight, stragglers get pulled back every REGROUP_TICKS. */
const STRAGGLER_TICKS = 90 * 20;
const REGROUP_TICKS = 20 * 20;
/** Long enough to outlast any fight; effects are cleared with the mob anyway. */
const EFFECT_TICKS = 20 * 60 * 60;

type Fight = { kind: 'wave' } | { kind: 'boss'; boss: BossDef };

interface Fighter {
  readonly id: string;
  readonly name: string;
  died: boolean;
  /** Left the game: counts as fallen, since they cannot come back to this battle. */
  left: boolean;
}

export type Outcome = 'victory' | 'defeat' | 'abandoned' | 'stopped' | 'broken';

/** Builds a translated message, with string or nested-message arguments. */
export function msg(key: string, ...args: (string | RawMessage)[]): RawMessage {
  if (args.length === 0) return { translate: key };
  return { translate: key, with: { rawtext: args.map((a) => (typeof a === 'string' ? { text: a } : a)) } };
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const PASSABLE = /(^|_)(grass|fern|flower|bush|sapling|torch|carpet|snow_layer|vine|button|pressure_plate|rail|dead_bush|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley)$/;

function isOpen(dimension: Dimension, at: Vector3): boolean {
  try {
    const block = dimension.getBlock(at);
    if (!block) return false;
    return block.isAir || PASSABLE.test(block.typeId);
  } catch {
    return false;
  }
}

function isGround(dimension: Dimension, at: Vector3): boolean {
  try {
    const block = dimension.getBlock(at);
    if (!block || block.isAir || block.isLiquid) return false;
    return !PASSABLE.test(block.typeId);
  } catch {
    return false;
  }
}

/** A random standable spot on the ring around `center`, or just above the block if none is found. */
export function findSpot(dimension: Dimension, center: Vector3, height = 2): Vector3 {
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = RING.min + Math.random() * (RING.max - RING.min);
    const x = Math.floor(center.x + Math.cos(angle) * r);
    const z = Math.floor(center.z + Math.sin(angle) * r);
    for (let dy = 4; dy >= -4; dy--) {
      const y = Math.floor(center.y) + dy;
      if (!isGround(dimension, { x, y, z })) continue;
      let clear = true;
      for (let h = 1; h <= height && clear; h++) clear = isOpen(dimension, { x, y: y + h, z });
      if (clear) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
    }
  }
  return { x: center.x, y: Math.floor(center.y) + 1, z: center.z };
}

function applyKit(entity: Entity, kit: Kit): void {
  for (const { slot, item } of kit.items) {
    try {
      entity.runCommand(`replaceitem entity @s ${slot} 0 ${item}`);
    } catch (err) {
      log.warn(`equipping ${item} on ${entity.typeId} failed: ${String(err)}`);
    }
  }
  // Undead would otherwise burn up in daylight before the players get to them.
  const effects = [{ name: 'fire_resistance', amplifier: 0 }, ...kit.effects];
  for (const { name, amplifier } of effects) {
    try {
      entity.addEffect(name, EFFECT_TICKS, { amplifier, showParticles: false });
    } catch (err) {
      log.warn(`effect ${name} on ${entity.typeId} failed: ${String(err)}`);
    }
  }
}

export class Arena {
  readonly key: string;
  readonly dimensionId: string;
  /** The arena block's own location. */
  readonly block: Vector3;
  /** Centre of the block's top face; mobs ring around it. */
  readonly center: Vector3;
  readonly mode: Mode;
  readonly fights: readonly Fight[];
  readonly waveCount: number;
  readonly fighters = new Map<string, Fighter>();

  /** Index into `fights` of the current (or upcoming) fight. */
  index = 0;
  phase: 'countdown' | 'announcing' | 'fighting' | 'intermission' = 'countdown';
  /** While announcing: what to spawn, and when (after the title fades). */
  private pendingSpawn: (() => void) | undefined;
  private spawnAt = 0;
  private intermissionEnd = 0;
  /** Damage dealt to arena mobs by player id, this fight and this whole battle. */
  private fightDamage = new Map<string, { name: string; damage: number }>();
  private totalDamage = new Map<string, { name: string; damage: number }>();
  private countdownEnd: number;
  private lastSecond = -1;
  private fightStart = 0;
  private lastRegroup = 0;
  private lastNear: number;
  readonly mobs = new Map<string, Entity>();
  boss: Entity | undefined;
  private bossDef: BossDef | undefined;
  /** True from a boss's spawn until it dies; a boss that vanishes is respawned while this holds. */
  private bossPending = false;
  /** Whether the current boss has spawned at least once, and failed spawns so far. */
  private bossSpawned = false;
  private bossSpawnFailures = 0;
  bossesDefeated = 0;
  ended = false;

  constructor(dimension: Dimension, block: Vector3, mode: Mode, players: readonly Player[]) {
    this.dimensionId = dimension.id;
    this.block = { x: block.x, y: block.y, z: block.z };
    this.key = `${dimension.id}:${block.x},${block.y},${block.z}`;
    this.center = { x: block.x + 0.5, y: block.y + 1, z: block.z + 0.5 };
    this.mode = mode;
    const fights: Fight[] = [];
    for (const boss of planBosses(mode)) {
      for (let i = 0; i < mode.wavesPerBoss; i++) fights.push({ kind: 'wave' });
      fights.push({ kind: 'boss', boss });
    }
    this.fights = fights;
    this.waveCount = fights.filter((f) => f.kind === 'wave').length;
    for (const p of players) this.fighters.set(p.id, { id: p.id, name: p.name, died: false, left: false });
    this.countdownEnd = system.currentTick + COUNTDOWN.first * 20;
    this.lastNear = system.currentTick;
    setLit(dimension, this.block, true);
    this.ignite();
  }

  /** The block catching fire as the battle starts: a whoosh, a clang, a burst of flame on the trim. */
  private ignite(): void {
    this.sound('mob.blaze.shoot', 0.7, 1);
    this.sound('random.anvil_land', 0.6, 0.5);
    for (let i = 0; i < 16; i++) this.trimParticle('minecraft:basic_flame_particle');
  }

  /** A particle at a random point on the gold trim's ring of flames. */
  private trimParticle(id: string): void {
    const u = Math.random() * 14 - 7;
    const side = Math.floor(Math.random() * 4);
    const [dx, dz] = side === 0 ? [u, -7] : side === 1 ? [u, 7] : side === 2 ? [-7, u] : [7, u];
    try {
      this.dimension.spawnParticle(id, {
        x: this.block.x + 0.5 + dx / 16,
        y: this.block.y + (5 + Math.random() * 4) / 16,
        z: this.block.z + 0.5 + dz / 16,
      });
    } catch {
      // Unloaded chunk.
    }
  }

  get dimension(): Dimension {
    return world.getDimension(this.dimensionId);
  }

  get current(): Fight | undefined {
    return this.fights[this.index];
  }

  get isFinal(): boolean {
    return this.index === this.fights.length - 1;
  }

  /** 1-based wave number of the current fight, counting waves only. */
  get waveNumber(): number {
    return this.fights.slice(0, this.index + 1).filter((f) => f.kind === 'wave').length;
  }

  get bossNumber(): number {
    return this.fights.slice(0, this.index + 1).filter((f) => f.kind === 'boss').length;
  }

  /** Players who should see this battle's titles: fighters anywhere, plus anyone nearby. */
  audience(): Player[] {
    return world.getAllPlayers().filter((p) => {
      if (this.fighters.has(p.id)) return true;
      try {
        return p.dimension.id === this.dimensionId && distance(p.location, this.center) <= AUDIENCE_RANGE;
      } catch {
        return false;
      }
    });
  }

  tell(message: RawMessage): void {
    for (const p of this.audience()) p.sendMessage({ rawtext: [PREFIX, message] });
  }

  title(title: RawMessage, subtitle?: RawMessage, stay = 40): void {
    for (const p of this.audience()) {
      try {
        p.onScreenDisplay.setTitle(title, {
          fadeInDuration: 5,
          stayDuration: stay,
          fadeOutDuration: 10,
          ...(subtitle ? { subtitle } : {}),
        });
      } catch {
        // Player mid-respawn.
      }
    }
  }

  sound(id: string, pitch = 1, volume = 1): void {
    for (const p of this.audience()) {
      try {
        p.playSound(id, { pitch, volume });
      } catch {
        // Player mid-respawn.
      }
    }
  }

  /** Fighters who are still in it (alive and have not died yet). */
  standing(): Fighter[] {
    return [...this.fighters.values()].filter((f) => !f.died && !f.left);
  }

  // ---------------------------------------------------------------- spawning

  private spawnMob(kind: MobKind, kit: Kit, at: Vector3): Entity | undefined {
    const entity = this.spawnTracked(kind.id, at, kind.spawnEvent);
    if (entity) applyKit(entity, kit);
    return entity;
  }

  /** Spawns an entity and marks it as this arena's. */
  private spawnTracked(id: string, at: Vector3, spawnEvent?: string): Entity | undefined {
    try {
      const entity = spawnEvent ? this.dimension.spawnEntity(id, at, { spawnEvent }) : this.dimension.spawnEntity(id, at);
      entity.addTag(MOB_TAG);
      entity.setDynamicProperty(MOB_PROPERTY, this.key);
      this.mobs.set(entity.id, entity);
      return entity;
    } catch (err) {
      log.warn(`spawning ${id} failed: ${String(err)}`);
      return undefined;
    }
  }

  private puff(at: Vector3): void {
    try {
      this.dimension.spawnParticle('minecraft:large_explosion', at);
    } catch {
      // Unloaded chunk.
    }
  }

  /**
   * Shows the wave's title now and spawns its mobs once the title has faded,
   * so the text is not covering the screen as they arrive.
   */
  private announceWave(now: number): void {
    const plan = planWave(this.index, this.fights.length, this.fighters.size);
    this.title(
      msg('arena.wave.title', String(this.waveNumber), String(this.waveCount)),
      msg('arena.wave.subtitle', { translate: `arena.theme.${plan.theme.key}` }, String(plan.mobs.length)),
      TITLE_STAY,
    );
    this.sound('raid.horn', 1, 0.6);
    this.pendingSpawn = () => this.spawnWave(plan);
    this.spawnAt = now + ANNOUNCE_TICKS;
  }

  private spawnWave(plan: WavePlan): void {
    for (const mob of plan.mobs) {
      const at = findSpot(this.dimension, this.center);
      if (this.spawnMob(mob.kind, mob.kit, at)) this.puff(at);
    }
    const gear = gearLevel(this.index, this.fights.length);
    log.info(`${this.key} wave ${this.waveNumber}: ${plan.theme.key} x${plan.mobs.length} at gear ${gear.toFixed(2)}`);
  }

  private announceBoss(def: BossDef, now: number): void {
    this.title(
      msg(this.isFinal ? 'arena.boss.final_title' : 'arena.boss.title'),
      { translate: def.nameKey },
      TITLE_STAY,
    );
    this.sound('mob.enderdragon.growl', 0.8, 1);
    this.bossDef = def;
    this.bossPending = true;
    this.bossSpawned = false;
    this.bossSpawnFailures = 0;
    this.pendingSpawn = () => {
      this.spawnBoss(def);
      this.sound('ambient.weather.thunder', 1, 0.8);
    };
    this.spawnAt = now + ANNOUNCE_TICKS;
  }

  /**
   * Spawns the boss: one big creature. Its health is fixed in its entity
   * file, so extra fighters are met with Resistance instead.
   */
  private spawnBoss(def: BossDef): void {
    const at = findSpot(this.dimension, this.center, def.height);
    const boss = this.spawnTracked(def.entity, at);
    if (!boss) return;
    this.boss = boss;
    this.bossSpawned = true;
    this.puff(at);
    const extra = this.fighters.size - 1;
    if (extra > 0) {
      try {
        boss.addEffect('resistance', EFFECT_TICKS, { amplifier: Math.min(2, extra - 1), showParticles: false });
      } catch (err) {
        log.warn(`boss resistance failed: ${String(err)}`);
      }
    }
  }

  /**
   * Brings a vanished boss back at full strength, or spawns it if the first
   * spawn failed. A boss whose entity never spawns (its file failed to load,
   * which leaves no trace on a Realm) is skipped with a note in chat, rather
   * than hanging the battle.
   */
  private respawnBoss(): void {
    const def = this.bossDef;
    if (!def) return;
    const firstSpawn = !this.bossSpawned;
    this.spawnBoss(def);
    if (this.boss) {
      if (!firstSpawn) this.tell(msg('arena.boss.returns', { translate: def.nameKey }));
      return;
    }
    if (++this.bossSpawnFailures < BOSS_SPAWN_TRIES) return;
    log.error(`boss ${def.entity} could not be spawned; skipping it`);
    this.tell(msg('arena.boss.failed', def.entity));
    this.bossDefeated();
  }

  // ------------------------------------------------------------------- events

  /** Called by main.ts when a tracked mob dies. */
  onMobDied(entity: Entity, location: Vector3): void {
    this.mobs.delete(entity.id);
    sweepGear(this.dimension, location);
    if (this.boss && entity.id === this.boss.id) {
      this.boss = undefined;
      this.bossDefeated();
    }
  }

  private bossDefeated(): void {
    const def = this.bossDef;
    this.bossPending = false;
    this.bossesDefeated++;
    this.dropRewards(this.isFinal);
    if (this.isFinal) {
      this.finish('victory');
      return;
    }
    this.tell(msg('arena.boss.defeated', def ? { translate: def.nameKey } : '?'));
    this.sound('random.levelup', 0.8);
  }

  /** Called by main.ts when a fighter dies. */
  onFighterDied(player: Player): void {
    const fighter = this.fighters.get(player.id);
    if (!fighter || fighter.died) return;
    fighter.died = true;
    const fallen = [...this.fighters.values()].filter((f) => f.died || f.left).length;
    this.tell(msg('arena.fighter.fallen', fighter.name, String(fallen), String(this.fighters.size)));
    if (this.standing().length === 0) this.finish('defeat');
  }

  onFighterLeft(playerId: string): void {
    const fighter = this.fighters.get(playerId);
    if (!fighter || fighter.left) return;
    fighter.left = true;
    if (this.standing().length === 0) this.finish('defeat');
  }

  // -------------------------------------------------------------------- ticks

  /** Runs every 10 ticks. */
  tick(): void {
    if (this.ended) return;
    const now = system.currentTick;

    // The block itself: gone means the battle is over (pickaxes are blocked
    // in main.ts, so this is /setblock or a world edit).
    try {
      const block = this.dimension.getBlock(this.block);
      if (block && block.typeId !== ARENA_BLOCK) {
        this.finish('broken');
        return;
      }
    } catch {
      // Unloaded: leave it until the area loads again.
    }

    // Abandonment: a fighter (fallen or not) within range keeps it going.
    const near = world.getAllPlayers().some((p) => {
      try {
        return this.fighters.has(p.id) && p.dimension.id === this.dimensionId && distance(p.location, this.center) <= ABANDON_RANGE;
      } catch {
        return false;
      }
    });
    if (near) this.lastNear = now;
    else if (now - this.lastNear > ABANDON_TICKS) {
      this.finish('abandoned');
      return;
    }

    // Embers rising off the ring of flames on the block's trim.
    this.trimParticle('minecraft:basic_flame_particle');
    if (Math.random() < 0.5) this.trimParticle('minecraft:lava_particle');

    if (this.phase === 'countdown') this.tickCountdown(now);
    else if (this.phase === 'intermission') this.tickIntermission(now);
    else if (this.phase === 'announcing') this.tickAnnouncing(now);
    else this.tickFight(now);
  }

  private tickCountdown(now: number): void {
    const left = Math.ceil((this.countdownEnd - now) / 20);
    const fight = this.current;
    if (!fight) return;
    if (left <= 0) {
      this.phase = 'announcing';
      this.lastSecond = -1;
      this.fightDamage.clear();
      if (fight.kind === 'wave') this.announceWave(now);
      else this.announceBoss(fight.boss, now);
      return;
    }
    if (left === this.lastSecond) return;
    this.lastSecond = left;
    const next =
      fight.kind === 'boss'
        ? msg(this.isFinal ? 'arena.countdown.final' : 'arena.countdown.boss', String(left))
        : msg('arena.countdown.wave', String(this.waveNumber), String(left));
    for (const p of this.audience()) {
      try {
        p.onScreenDisplay.setActionBar(next);
      } catch {
        // Player mid-respawn.
      }
    }
    if (left <= 3) {
      this.title({ text: `${left <= 1 ? Format.red : Format.yellow}${Format.bold}${left}` }, undefined, 15);
      this.sound('note.pling', left === 1 ? 1.6 : 1.2);
    }
  }

  private tickFight(now: number): void {
    // Drop mobs that are gone without a death event (despawned, unloaded).
    for (const [id, mob] of this.mobs) {
      if (!mob.isValid) this.mobs.delete(id);
    }
    // A boss that vanished without dying (a Warden digging away) comes back.
    // If the spawn fails (area unloaded), it is retried next tick.
    if (this.boss && !this.boss.isValid) this.boss = undefined;
    if (this.bossPending && !this.boss) this.respawnBoss();

    const regroup = now - this.fightStart > STRAGGLER_TICKS && now - this.lastRegroup > REGROUP_TICKS;
    if (regroup) this.lastRegroup = now;
    for (const mob of this.mobs.values()) {
      try {
        const d = distance(mob.location, this.center);
        if (d > LEASH_RANGE || (regroup && d > RING.max + 4)) {
          mob.teleport(findSpot(this.dimension, this.center));
        }
      } catch {
        // Died this tick.
      }
    }

    this.showStatus();

    if (this.mobs.size > 0 || this.bossPending) return;
    // Fight cleared.
    const cleared = this.current;
    this.index++;
    if (this.index >= this.fights.length) {
      // Unreachable: the final boss's death ends the battle first.
      this.finish('victory');
      return;
    }
    // A pause to breathe: announce the clear and who hit hardest, then
    // start the next countdown once the intermission is over.
    const top = topDamage(this.fightDamage)[0];
    this.title(msg('arena.cleared_title'), top ? msg('arena.damage.top', top.name) : undefined, 50);
    if (cleared?.kind === 'wave') this.tell(msg('arena.wave.cleared', String(this.waveNumber - 1)));
    this.postLeaderboard(this.fightDamage, cleared?.kind === 'boss' ? 'arena.damage.header_boss' : 'arena.damage.header_wave');
    this.sound('random.orb', 0.8);
    this.healFighters();
    this.phase = 'intermission';
    this.intermissionEnd = now + INTERMISSION_TICKS;
  }

  private tickAnnouncing(now: number): void {
    if (now < this.spawnAt) return;
    const spawn = this.pendingSpawn;
    this.pendingSpawn = undefined;
    this.phase = 'fighting';
    this.fightStart = now;
    this.lastRegroup = now;
    spawn?.();
  }

  private tickIntermission(now: number): void {
    if (now < this.intermissionEnd) return;
    const next = this.current;
    this.phase = 'countdown';
    this.lastSecond = -1;
    this.countdownEnd = now + (next?.kind === 'boss' ? COUNTDOWN.boss : COUNTDOWN.wave) * 20;
  }

  /** Called by main.ts when a player hurts one of this arena's mobs. */
  recordDamage(player: Player, amount: number): void {
    if (amount <= 0) return;
    for (const table of [this.fightDamage, this.totalDamage]) {
      const entry = table.get(player.id) ?? { name: player.name, damage: 0 };
      entry.damage += amount;
      table.set(player.id, entry);
    }
  }

  /**
   * Posts a damage leaderboard to chat. Only in a multiplayer battle: with
   * one fighter it would always be the same name at the top.
   */
  private postLeaderboard(table: Map<string, { name: string; damage: number }>, header: string): void {
    if (this.fighters.size < 2 && table.size < 2) return;
    const ranked = topDamage(table).slice(0, LEADERBOARD_SIZE);
    if (ranked.length === 0) return;
    const lines: RawMessage[] = [msg(header)];
    ranked.forEach((entry, i) => {
      lines.push({ text: '\n' }, msg('arena.damage.line', String(i + 1), entry.name, String(Math.round(entry.damage))));
    });
    this.tell({ rawtext: lines });
  }

  /** A short breather between fights: a few seconds of regeneration for anyone nearby. */
  private healFighters(): void {
    for (const p of this.dimension.getPlayers({ location: this.center, maxDistance: AUDIENCE_RANGE })) {
      try {
        p.addEffect('regeneration', 5 * 20, { amplifier: 1, showParticles: true });
      } catch {
        // Dead.
      }
    }
  }

  private showStatus(): void {
    let line: RawMessage;
    if (this.boss) {
      const health = this.boss.getComponent('minecraft:health');
      const hp = health ? `${Math.ceil(health.currentValue)}/${Math.ceil(health.effectiveMax)}` : '?';
      line = msg('arena.status.boss', this.bossDef ? { translate: this.bossDef.nameKey } : '?', hp);
    } else {
      line = msg('arena.status.wave', String(this.waveNumber), String(this.waveCount), String(this.mobs.size));
    }
    for (const p of this.audience()) {
      try {
        p.onScreenDisplay.setActionBar(line);
      } catch {
        // Player mid-respawn.
      }
    }
  }

  // ------------------------------------------------------------------ rewards

  private dropRewards(final: boolean): void {
    const tier = this.bossesDefeated;
    const roll = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
    const loot: [string, number][] = final
      ? [
          ['minecraft:diamond', roll(4, 8) + this.mode.bosses],
          ['minecraft:emerald', roll(8, 16)],
          ['minecraft:enchanted_golden_apple', 1],
          ['minecraft:totem_of_undying', 1],
          ['minecraft:experience_bottle', 32],
          [this.mode.key === 'epic' ? 'minecraft:netherite_ingot' : 'minecraft:netherite_scrap', this.mode.key === 'quick' ? 1 : 2],
        ]
      : [
          ['minecraft:diamond', roll(1, 2) + Math.floor(tier / 2)],
          ['minecraft:emerald', roll(3, 6) + tier],
          ['minecraft:golden_apple', roll(1, 2)],
          ['minecraft:experience_bottle', 8 + 4 * tier],
          ['minecraft:iron_ingot', roll(4, 8)],
        ];
    const at = { x: this.center.x, y: this.center.y + 0.5, z: this.center.z };
    for (const [id, amount] of loot) {
      try {
        this.dimension.spawnItem(new ItemStack(id, Math.min(amount, 64)), at);
      } catch (err) {
        log.warn(`reward ${id} failed: ${String(err)}`);
      }
    }
  }

  // ------------------------------------------------------------------- ending

  /** Ends the battle and cleans up its mobs. main.ts drops it from the registry. */
  finish(outcome: Outcome): void {
    if (this.ended) return;
    this.ended = true;
    setLit(this.dimension, this.block, false);
    for (const mob of this.mobs.values()) {
      try {
        if (mob.isValid) mob.remove();
      } catch {
        // Already gone.
      }
    }
    this.mobs.clear();
    this.boss = undefined;
    // Evokers leave vexes behind, untagged.
    try {
      for (const vex of this.dimension.getEntities({ type: 'minecraft:vex', location: this.center, maxDistance: AUDIENCE_RANGE })) {
        vex.remove();
      }
    } catch {
      // Unloaded.
    }

    const reached = String(this.waveNumber);
    switch (outcome) {
      case 'victory':
        this.title(msg('arena.end.victory'), msg('arena.end.victory_sub', String(this.bossesDefeated)), 80);
        this.tell(msg('arena.end.victory_chat', String(this.waveCount), String(this.bossesDefeated)));
        this.sound('random.totem');
        this.sound('random.levelup', 1.2);
        this.postLeaderboard(this.totalDamage, 'arena.damage.header_total');
        break;
      case 'defeat':
        this.title(msg('arena.end.defeat'), msg('arena.end.defeat_sub', reached, String(this.bossesDefeated)), 80);
        this.tell(msg('arena.end.defeat_chat', reached, String(this.bossesDefeated)));
        this.sound('mob.wither.death', 1, 0.6);
        this.postLeaderboard(this.totalDamage, 'arena.damage.header_total');
        break;
      default:
        this.tell(msg(`arena.end.${outcome}`));
        break;
    }
    for (const p of this.audience()) {
      try {
        p.onScreenDisplay.setActionBar('');
      } catch {
        // Player mid-respawn.
      }
    }
    log.info(`${this.key} ended: ${outcome} at fight ${this.index + 1}/${this.fights.length}`);
  }

  /** Debug: clears the current fight's mobs, as if the players had killed them. */
  skipFight(): void {
    if (this.phase !== 'fighting') {
      this.intermissionEnd = system.currentTick;
      this.countdownEnd = system.currentTick;
      this.spawnAt = system.currentTick;
      return;
    }
    if (this.bossPending && this.isFinal) {
      this.bossesDefeated++;
      this.finish('victory');
      return;
    }
    if (this.bossPending) this.bossesDefeated++;
    this.bossPending = false;
    for (const mob of this.mobs.values()) {
      try {
        mob.remove();
      } catch {
        // Gone.
      }
    }
    this.mobs.clear();
    this.boss = undefined;
  }

  /** Debug: jumps to the countdown before the next boss. */
  skipToBoss(): void {
    const next = this.fights.findIndex((f, i) => i >= this.index && f.kind === 'boss');
    if (next < 0) return;
    for (const mob of this.mobs.values()) {
      try {
        mob.remove();
      } catch {
        // Gone.
      }
    }
    this.mobs.clear();
    this.boss = undefined;
    this.bossPending = false;
    this.index = next;
    this.phase = 'countdown';
    this.countdownEnd = system.currentTick + 3 * 20;
  }
}

/** Leaderboard order: most damage first. */
function topDamage(table: Map<string, { name: string; damage: number }>): { name: string; damage: number }[] {
  return [...table.values()].sort((a, b) => b.damage - a.damage);
}

/**
 * Switches the arena block between its idle and battle looks (the
 * `steveo:active` state: flames on the trim, glowing cracks, more light).
 * Does nothing if the block is gone or its chunk is unloaded; the block's
 * own tick puts a stale lit block out (see main.ts).
 */
export function setLit(dimension: Dimension, at: Vector3, lit: boolean): void {
  try {
    const block = dimension.getBlock(at);
    if (block?.typeId !== ARENA_BLOCK) return;
    if (isLit(block.permutation) === lit) return;
    block.setPermutation(BlockPermutation.resolve(ARENA_BLOCK, { 'steveo:active': lit }));
  } catch (err) {
    log.warn(`switching the arena block ${lit ? 'on' : 'off'} failed: ${String(err)}`);
  }
}

export function isLit(permutation: BlockPermutation): boolean {
  return permutation.getAllStates()['steveo:active'] === true;
}

/**
 * Arena mobs' gear is not loot: sweep any dropped armor or weapon off the
 * floor where a mob died, so a battle is not a free netherite farm. The
 * boss rewards are the loot.
 */
function sweepGear(dimension: Dimension, location: Vector3): void {
  system.runTimeout(() => {
    try {
      for (const item of dimension.getEntities({ type: 'minecraft:item', location, maxDistance: 2.5 })) {
        const stack = item.getComponent('minecraft:item')?.itemStack;
        if (stack && GEAR_ITEMS.has(stack.typeId)) item.remove();
      }
    } catch {
      // Unloaded.
    }
  }, 2);
}
