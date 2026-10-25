/**
 * Luckier Block — a rainbow question block. Break it and you get a random
 * item (anything a survival player could legitimately own), occasionally a
 * jackpot of several, or something bad happens instead.
 *
 *   items.ts    the prize pool: every registered item minus the illegal ones
 *   unlucky.ts  the bad outcomes (mobs, TNT, lightning, curses, ...)
 *
 * Only a player breaking the block rolls an outcome. The block has an empty
 * loot table and is explosion-proof, so TNT cannot open (or destroy) a stash.
 *
 * Debug: /scriptevent steveo:luckier <give|lucky|jackpot|unlucky [name]|items>
 */
import { ItemStack, Player, system, type Dimension, type RawMessage, type Vector3 } from '@minecraft/server';

import { Format } from '@shared/chat';
import { createLogger } from '@shared/log';

import { prizePool, randomPrize } from './items';
import { UNLUCKY, type Unlucky } from './unlucky';

const log = createLogger('luckier-block');

const LUCKIER_BLOCK = 'steveo:luckier_block';
const PREFIX: RawMessage = { text: `${Format.gray}[Luckier Block]${Format.reset} ` };

/** Out of 100: how often each kind of outcome comes up. The rest is a single prize. */
const UNLUCKY_CHANCE = 30;
const JACKPOT_CHANCE = 8;

function say(player: Player, key: string, ...with_: (string | RawMessage)[]): void {
  const body: RawMessage = with_.length
    ? { translate: key, with: { rawtext: with_.map((w) => (typeof w === 'string' ? { text: w } : w)) } }
    : { translate: key };
  player.sendMessage({ rawtext: [PREFIX, body] });
}

function effects(dimension: Dimension, at: Vector3, sound: string, particle: string, pitch = 1): void {
  try {
    dimension.playSound(sound, at, { pitch });
    dimension.spawnParticle(particle, at);
  } catch {
    // Unloaded chunk.
  }
}

function givePrize(player: Player, at: Vector3, dimension: Dimension): void {
  const prize = randomPrize();
  dimension.spawnItem(prize, at);
  say(player, 'luckier.lucky', { translate: prize.localizationKey }, String(prize.amount));
  effects(dimension, at, 'random.levelup', 'minecraft:totem_particle', 1.4);
}

function giveJackpot(player: Player, at: Vector3, dimension: Dimension): void {
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) dimension.spawnItem(randomPrize(), at);
  say(player, 'luckier.jackpot', String(count));
  effects(dimension, at, 'random.totem', 'minecraft:totem_particle');
}

function runUnlucky(outcome: Unlucky, player: Player, at: Vector3, dimension: Dimension): void {
  say(player, `luckier.unlucky.${outcome.name}`);
  effects(dimension, at, 'mob.wither.spawn', 'minecraft:large_explosion', 1.6);
  try {
    outcome.run(player, at, dimension);
  } catch (error) {
    log.error(`unlucky outcome ${outcome.name} failed`, error);
  }
}

function pickUnlucky(): Unlucky {
  const total = UNLUCKY.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const outcome of UNLUCKY) {
    roll -= outcome.weight;
    if (roll < 0) return outcome;
  }
  return UNLUCKY[0] as Unlucky;
}

function open(player: Player, at: Vector3, dimension: Dimension): void {
  const roll = Math.random() * 100;
  if (roll < UNLUCKY_CHANCE) runUnlucky(pickUnlucky(), player, at, dimension);
  else if (roll < UNLUCKY_CHANCE + JACKPOT_CHANCE) giveJackpot(player, at, dimension);
  else givePrize(player, at, dimension);
}

system.beforeEvents.startup.subscribe((event) => {
  event.blockComponentRegistry.registerCustomComponent(LUCKIER_BLOCK, {
    onPlayerBreak: (e) => {
      const player = e.player;
      if (!player) return;
      const at = { x: e.block.location.x + 0.5, y: e.block.location.y + 0.5, z: e.block.location.z + 0.5 };
      const dimension = e.dimension;
      // Breaking happens inside a restricted callback; act on the next tick.
      system.run(() => {
        if (player.isValid) open(player, at, dimension);
      });
    },
  });
});

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:luckier') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const at = { x: head.x + view.x * 2, y: head.y, z: head.z + view.z * 2 };
    const [command = '', arg] = event.message.trim().split(/\s+/);

    switch (command) {
      case 'give':
        player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(LUCKIER_BLOCK, 16));
        say(player, 'luckier.debug.given');
        break;
      case 'lucky':
        givePrize(player, at, player.dimension);
        break;
      case 'jackpot':
        giveJackpot(player, at, player.dimension);
        break;
      case 'unlucky': {
        const outcome = arg ? UNLUCKY.find((o) => o.name === arg) : pickUnlucky();
        if (!outcome) {
          say(player, 'luckier.debug.unknown', UNLUCKY.map((o) => o.name).join(', '));
          break;
        }
        runUnlucky(outcome, player, at, player.dimension);
        break;
      }
      case 'items': {
        const pool = prizePool();
        const sample = Array.from({ length: 5 }, () => pool[Math.floor(Math.random() * pool.length)] ?? '?');
        say(player, 'luckier.debug.items', String(pool.length), sample.join(', '));
        break;
      }
      default:
        say(player, 'luckier.debug.help', UNLUCKY.map((o) => o.name).join(', '));
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
