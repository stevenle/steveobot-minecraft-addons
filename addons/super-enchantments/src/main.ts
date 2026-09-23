/**
 * Super Enchantments — every enchantment up to level 20, three new ones, and
 * an Enchantment Tower to find them in.
 *
 * Bedrock has no data-driven enchantments and `addEnchantment` refuses levels
 * above the vanilla maximum, so "super" levels are layered on top of the
 * game's own system:
 *
 * - The vanilla enchantment is applied natively up to its own max (Sharpness
 *   V, Protection IV, ...), so the game keeps doing what it already does.
 * - The full level (and every custom enchantment) is recorded in an item
 *   dynamic property and rendered as lore lines, e.g. "✦ Sharpness XX".
 * - This script turns the surplus above the vanilla max into an effect: extra
 *   melee/arrow damage, extra knockback, longer burns, damage reduction on
 *   armor, thorns, Haste for Efficiency, water breathing for Respiration, and
 *   slow self-repair for Unbreaking. Enchantments with nothing sensible to
 *   scale (Silk Touch, Mending, Infinity, ...) accept level 20 but the surplus
 *   is cosmetic. README.md lists which is which.
 *
 * The three custom enchantments (Power Knockback, Extra Hit, Super Efficiency)
 * exist only in that property; they are applied by the fountain, shown in lore,
 * and enacted here.
 *
 * The Super Enchantment Fountain is a custom block; world generation plants an
 * Enchantment Tower (behavior_pack/structures/, from assets/generate.mjs) in
 * Overworld land biomes with one at the top. Using the fountain while holding
 * an item opens a menu of enchantments it can take, then a level slider; the
 * lapis price is deducted from the inventory and the item is enchanted in
 * place, with a burst of enchantment-letter particles.
 */
import {
  EnchantmentTypes,
  EntityDamageCause,
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Block,
  type Container,
  type Dimension,
  type Entity,
  type EntityDamageSource,
  type ItemEnchantableComponent,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';

import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('super-enchantments');
const PREFIX: RawMessage = { text: `${Format.gray}[Super Enchantments]${Format.reset} ` };

const FOUNTAIN_ID = 'steveo:enchantment_fountain';
const STRUCTURE_ID = 'steveo:enchantment_tower';
const LETTERS_PARTICLE = 'steveo:enchantment_letters';
const LAPIS_ID = 'minecraft:lapis_lazuli';
const BEDROCK_ID = 'minecraft:bedrock';
/** Item dynamic property: JSON object of enchantment id -> level for super and custom levels. */
const SUPER_PROP = 'steveo:super_enchantments';

/** The new ceiling for every enchantment. */
const MAX_LEVEL = 20;
/** Lapis charged per level gained at the fountain. */
const LAPIS_PER_LEVEL = 2;

// Custom enchantments live under the steveo: namespace so they can never
// collide with a vanilla id in the dynamic property.
const POWER_KNOCKBACK = 'steveo:power_knockback';
const EXTRA_HIT = 'steveo:extra_hit';
const SUPER_EFFICIENCY = 'steveo:super_efficiency';
const KEEN_EDGE = 'steveo:keen_edge';
const CUSTOM_IDS = [POWER_KNOCKBACK, EXTRA_HIT, SUPER_EFFICIENCY, KEEN_EDGE] as const;

// ---------- tuning ----------

/** Extra melee damage per Sharpness level above V (vanilla adds 1.25 per level). */
const SHARPNESS_PER_LEVEL = 1.25;
/** Keen Edge: extra melee damage per level, Sharpness's rate, for paxels (which cannot take Sharpness). */
const KEEN_EDGE_PER_LEVEL = 1.25;
/** Extra damage per Smite / Bane of Arthropods level above V, against their families. */
const SMITE_PER_LEVEL = 2.5;
/** Arrow damage multiplier gained per Power level above V (vanilla is +25% per level). */
const POWER_PER_LEVEL = 0.25;
/** Damage reduction per Protection level above IV, and per specialised level above IV. */
const PROTECTION_PER_LEVEL = 0.04;
const SPECIAL_PROTECTION_PER_LEVEL = 0.08;
/** Hard cap on scripted damage reduction so armor can never make a player immortal. */
const PROTECTION_CAP = 0.8;
/** Horizontal knockback force per Knockback level above II. */
const KNOCKBACK_PER_LEVEL = 0.8;
/** Horizontal force for Power Knockback: base plus this much per level. */
const POWER_KNOCKBACK_BASE = 2;
const POWER_KNOCKBACK_PER_LEVEL = 1.5;
/** Seconds of burning per Fire Aspect level above II and per Flame level above I. */
const FIRE_SECONDS_PER_LEVEL = 4;
/** Thorns damage dealt back per level above III. */
const THORNS_PER_LEVEL = 1;
/** Extra Hit: chance and radius scale with the level. */
const EXTRA_HIT_BASE_CHANCE = 0.25;
const EXTRA_HIT_CHANCE_PER_LEVEL = 0.035;
const EXTRA_HIT_BASE_RADIUS = 2;
const EXTRA_HIT_RADIUS_PER_LEVEL = 0.4;
/** Share of the original hit's damage dealt to each nearby mob. */
const EXTRA_HIT_DAMAGE_SHARE = 0.75;
/** Super Efficiency: seconds to chew through bedrock at level I, and the cut per further level. */
const BEDROCK_SECONDS = 180;
const BEDROCK_CUT_PER_LEVEL = 0.04;
/** Ticks a bedrock miner may look away before the attempt is abandoned. */
const BEDROCK_IDLE_TICKS = 100;
const BEDROCK_REACH = 7;
/** How far away the fountain can be tapped; matches the game's block reach. */
const FOUNTAIN_REACH = 7;
/** Ticks between the passive sweeps (Haste, water breathing) and the repair sweep. */
const PASSIVE_TICKS = 20;
const REPAIR_TICKS = 100;
/** Enchantment-letter bursts per fountain use. */
const BURSTS_MIN = 2;
const BURSTS_MAX = 4;

/** Curses are never on offer; the fountain only ever helps. */
const EXCLUDED_IDS = new Set(['binding', 'vanishing']);
const MELEE_TAGS = ['minecraft:is_sword', 'minecraft:is_axe'];
const MELEE_TYPES = new Set(['minecraft:mace', 'minecraft:trident']);
const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];

// ---------- messages ----------

function say(player: Player, key: string, ...args: (string | RawMessage)[]): void {
  player.sendMessage([PREFIX, { translate: key, with: { rawtext: args.map((a) => (typeof a === 'string' ? { text: a } : a)) } }]);
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = Math.max(0, Math.floor(n));
  for (const [value, digits] of table) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}

/** Display name of an enchantment, vanilla or custom, as a translatable message. */
function enchantName(id: string): RawMessage {
  return { translate: `super_enchantments.enchant.${id.replace(/^steveo:/, '')}` };
}

function itemName(item: ItemStack): RawMessage {
  const id = item.typeId;
  // Vanilla items translate through item.<name>.name; custom ones carry their own key.
  return id.startsWith('minecraft:') ? { translate: `item.${id.slice('minecraft:'.length)}.name` } : { text: id };
}

// ---------- the super-level record on an item ----------

type SuperLevels = Record<string, number>;

function isCustom(id: string): id is (typeof CUSTOM_IDS)[number] {
  return (CUSTOM_IDS as readonly string[]).includes(id);
}

function vanillaMax(id: string): number {
  return isCustom(id) ? 0 : (EnchantmentTypes.get(id)?.maxLevel ?? 0);
}

function readSuper(item: ItemStack): SuperLevels {
  const raw = item.getDynamicProperty(SUPER_PROP);
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const levels: SuperLevels = {};
    for (const [id, level] of Object.entries(parsed)) {
      if (typeof level === 'number' && Number.isInteger(level) && level > 0) levels[id] = Math.min(MAX_LEVEL, level);
    }
    return levels;
  } catch {
    return {};
  }
}

/** Writes the record and re-renders the lore lines that show it. */
function writeSuper(item: ItemStack, levels: SuperLevels): void {
  const ids = Object.keys(levels).sort();
  if (ids.length === 0) {
    item.setDynamicProperty(SUPER_PROP, undefined);
    item.setLore([]);
    return;
  }
  item.setDynamicProperty(SUPER_PROP, JSON.stringify(levels));
  item.setLore(
    ids.map((id) => ({
      // ASCII only: any other character makes Bedrock fall back to a different font.
      rawtext: [{ text: Format.aqua }, enchantName(id), { text: ` ${roman(levels[id] ?? 0)}` }],
    })),
  );
}

function enchantable(item: ItemStack | undefined): ItemEnchantableComponent | undefined {
  return item?.getComponent('minecraft:enchantable');
}

function nativeLevel(item: ItemStack | undefined, id: string): number {
  if (item === undefined || isCustom(id)) return 0;
  try {
    return enchantable(item)?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

/** The level the player sees: the super record if present, else the game's own. */
function totalLevel(item: ItemStack | undefined, id: string): number {
  if (item === undefined) return 0;
  return readSuper(item)[id] ?? nativeLevel(item, id);
}

/** Levels above what the game itself enacts; only this part is scripted. */
function surplus(item: ItemStack | undefined, id: string): number {
  return Math.max(0, totalLevel(item, id) - vanillaMax(id));
}

/**
 * Applies an enchantment at a level up to MAX_LEVEL. Vanilla enchantments are
 * set natively up to their own max; the rest goes in the record. Throws when
 * the game refuses the enchantment for this item.
 */
function applyEnchantment(item: ItemStack, id: string, level: number): void {
  const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  if (!isCustom(id)) {
    const type = EnchantmentTypes.get(id);
    const component = enchantable(item);
    if (type === undefined || component === undefined) throw new Error(`${id} cannot go on ${item.typeId}`);
    const native = Math.min(target, type.maxLevel);
    if (component.hasEnchantment(id)) component.removeEnchantment(id);
    component.addEnchantment({ type, level: native });
  }
  const levels = readSuper(item);
  if (target > vanillaMax(id)) levels[id] = target;
  else delete levels[id];
  writeSuper(item, levels);
}

// ---------- inventory helpers ----------

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent('minecraft:inventory')?.container;
}

function heldItem(player: Player): ItemStack | undefined {
  try {
    return inventoryOf(player)?.getItem(player.selectedSlotIndex);
  } catch {
    return undefined;
  }
}

function setHeldItem(player: Player, item: ItemStack): void {
  inventoryOf(player)?.setItem(player.selectedSlotIndex, item);
}

function wornItems(player: Player): ItemStack[] {
  const equippable = player.getComponent('minecraft:equippable');
  if (equippable === undefined) return [];
  const items: ItemStack[] = [];
  for (const slot of ARMOR_SLOTS) {
    const item = equippable.getEquipment(slot);
    if (item !== undefined) items.push(item);
  }
  return items;
}

function countItem(container: Container, typeId: string): number {
  let count = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === typeId) count += item.amount;
  }
  return count;
}

function removeItem(container: Container, typeId: string, amount: number): void {
  let left = amount;
  for (let slot = 0; slot < container.size && left > 0; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId !== typeId) continue;
    if (item.amount <= left) {
      left -= item.amount;
      container.setItem(slot, undefined);
    } else {
      item.amount -= left;
      left = 0;
      container.setItem(slot, item);
    }
  }
}

function give(player: Player, stack: ItemStack): void {
  const inventory = inventoryOf(player);
  if (inventory === undefined) return;
  const leftover = inventory.addItem(stack);
  if (leftover !== undefined) player.dimension.spawnItem(leftover, player.location);
}

function isMelee(item: ItemStack): boolean {
  return MELEE_TAGS.some((tag) => item.hasTag(tag)) || MELEE_TYPES.has(item.typeId);
}

function isPickaxe(item: ItemStack): boolean {
  return item.hasTag('minecraft:is_pickaxe');
}

/**
 * Paxels from the paxel add-on, matched by id so this pack does not depend on
 * that one: an unknown id simply never matches.
 */
function isPaxel(item: ItemStack): boolean {
  return /^steveo:[a-z]+_paxel$/.test(item.typeId);
}

function customApplies(id: string, item: ItemStack): boolean {
  switch (id) {
    case POWER_KNOCKBACK:
    case EXTRA_HIT:
      return isMelee(item);
    case SUPER_EFFICIENCY:
      return isPickaxe(item);
    case KEEN_EDGE:
      return isPaxel(item);
    default:
      return false;
  }
}

// ---------- the fountain ----------

interface Candidate {
  id: string;
  current: number;
}

/** Everything the fountain can put on this item, upgrades first. */
function candidates(item: ItemStack): Candidate[] {
  const list: Candidate[] = [];
  const component = enchantable(item);
  if (component !== undefined) {
    for (const type of EnchantmentTypes.getAll()) {
      if (EXCLUDED_IDS.has(type.id)) continue;
      const current = totalLevel(item, type.id);
      let allowed = current > 0;
      if (!allowed) {
        try {
          allowed = component.canAddEnchantment({ type, level: 1 });
        } catch {
          allowed = false;
        }
      }
      if (allowed) list.push({ id: type.id, current });
    }
  }
  for (const id of CUSTOM_IDS) {
    if (customApplies(id, item)) list.push({ id, current: totalLevel(item, id) });
  }
  return list.sort((a, b) => Number(b.current > 0) - Number(a.current > 0) || a.id.localeCompare(b.id));
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** A random number of enchantment-letter bursts, spread over a few ticks. */
function celebrate(dimension: Dimension, location: Vector3): void {
  const bursts = randomInt(BURSTS_MIN, BURSTS_MAX);
  for (let i = 0; i < bursts; i++) {
    system.runTimeout(() => {
      try {
        dimension.spawnParticle(LETTERS_PARTICLE, location);
        dimension.playSound('random.levelup', location, { pitch: 0.8 + i * 0.15, volume: 0.8 });
      } catch (err) {
        log.warn(`could not spawn letters: ${String(err)}`);
      }
    }, i * 6);
  }
}

async function openFountain(player: Player, fountain: Block): Promise<void> {
  const item = heldItem(player);
  if (item === undefined) {
    say(player, 'super_enchantments.fountain.hold');
    return;
  }
  if (item.typeId === 'minecraft:book' || item.typeId === 'minecraft:enchanted_book') {
    say(player, 'super_enchantments.fountain.book');
    return;
  }
  const options = candidates(item);
  if (options.length === 0) {
    say(player, 'super_enchantments.fountain.nothing');
    return;
  }
  const inventory = inventoryOf(player);
  if (inventory === undefined) return;

  const menu = new ActionFormData()
    .title({ translate: 'super_enchantments.fountain.title' })
    .body({
      translate: 'super_enchantments.fountain.body',
      with: [String(MAX_LEVEL), String(countItem(inventory, LAPIS_ID)), String(LAPIS_PER_LEVEL)],
    });
  for (const option of options) {
    const key = option.current > 0 ? 'super_enchantments.fountain.button.upgrade' : 'super_enchantments.fountain.button.new';
    menu.button({ translate: key, with: { rawtext: [enchantName(option.id), { text: roman(option.current) }] } });
  }
  const pick = await menu.show(player);
  if (pick.canceled || pick.selection === undefined) return;
  const chosen = options[pick.selection];
  if (chosen === undefined) return;
  if (chosen.current >= MAX_LEVEL) {
    say(player, 'super_enchantments.fountain.maxed', enchantName(chosen.id), String(MAX_LEVEL));
    return;
  }

  const minLevel = chosen.current + 1;
  const form = new ModalFormData()
    .title(enchantName(chosen.id))
    .slider({ translate: 'super_enchantments.fountain.level' }, minLevel, MAX_LEVEL, { valueStep: 1, defaultValue: minLevel })
    .label({
      translate: 'super_enchantments.fountain.cost',
      with: [String(LAPIS_PER_LEVEL), String(countItem(inventory, LAPIS_ID))],
    })
    .submitButton({ translate: 'super_enchantments.fountain.submit' });
  const result = await form.show(player);
  if (result.canceled) return;
  const level = Math.max(minLevel, Math.min(MAX_LEVEL, Math.floor(Number(result.formValues?.[0] ?? minLevel))));

  // The player may have swapped items or spent lapis while the form was open.
  const now = heldItem(player);
  if (now === undefined || now.typeId !== item.typeId) {
    say(player, 'super_enchantments.fountain.changed');
    return;
  }
  const cost = (level - totalLevel(now, chosen.id)) * LAPIS_PER_LEVEL;
  const lapis = countItem(inventory, LAPIS_ID);
  if (lapis < cost) {
    say(player, 'super_enchantments.fountain.lapis', String(cost), String(lapis));
    return;
  }
  try {
    applyEnchantment(now, chosen.id, level);
  } catch (err) {
    log.warn(`could not enchant ${now.typeId} with ${chosen.id} ${level}: ${String(err)}`);
    say(player, 'super_enchantments.fountain.failed', enchantName(chosen.id));
    return;
  }
  removeItem(inventory, LAPIS_ID, cost);
  setHeldItem(player, now);
  celebrate(fountain.dimension, { x: fountain.location.x + 0.5, y: fountain.location.y + 1.1, z: fountain.location.z + 0.5 });
  say(player, 'super_enchantments.fountain.done', enchantName(chosen.id), roman(level), itemName(now), String(cost));
  log.info(`${player.name}: ${chosen.id} ${level} on ${now.typeId} for ${cost} lapis`);
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.block.typeId !== FOUNTAIN_ID || !event.isFirstEvent) return;
  event.cancel = true;
  const { player, block } = event;
  system.run(() => {
    openFountain(player, block).catch((err: unknown) => log.error('fountain menu failed', err));
  });
});

/** True when the fountain is the block under the player's crosshair. */
function facingFountain(player: Player): boolean {
  try {
    return player.getBlockFromViewDirection({ maxDistance: FOUNTAIN_REACH, includeLiquidBlocks: false })?.block.typeId === FOUNTAIN_ID;
  } catch {
    return false;
  }
}

// Cancelling the block interaction does not stop the held item from being
// used as well: armor would equip itself, food would start being eaten, a bow
// would draw. Swallow the item use whenever the fountain is what was tapped,
// so the item is still in hand when the menu opens.
world.beforeEvents.itemUse.subscribe((event) => {
  if (facingFountain(event.source)) event.cancel = true;
});

// ---------- damage: super Sharpness/Smite/Bane/Power, Keen Edge, super Protection ----------

function hasFamily(entity: Entity, family: string): boolean {
  try {
    return entity.getComponent('minecraft:type_family')?.hasTypeFamily(family) ?? false;
  } catch {
    return false;
  }
}

function attackBonus(attacker: Player, victim: Entity, source: EntityDamageSource, damage: number): number {
  const weapon = heldItem(attacker);
  if (weapon === undefined) return damage;
  if (source.cause === EntityDamageCause.entityAttack) {
    let bonus = SHARPNESS_PER_LEVEL * surplus(weapon, 'sharpness') + KEEN_EDGE_PER_LEVEL * totalLevel(weapon, KEEN_EDGE);
    if (hasFamily(victim, 'undead')) bonus += SMITE_PER_LEVEL * surplus(weapon, 'smite');
    if (hasFamily(victim, 'arthropod')) bonus += SMITE_PER_LEVEL * surplus(weapon, 'bane_of_arthropods');
    return damage + bonus;
  }
  if (source.cause === EntityDamageCause.projectile && source.damagingProjectile !== undefined) {
    return damage * (1 + POWER_PER_LEVEL * surplus(weapon, 'power'));
  }
  return damage;
}

const FIRE_CAUSES = new Set([
  EntityDamageCause.fire,
  EntityDamageCause.fireTick,
  EntityDamageCause.lava,
  EntityDamageCause.magma,
  EntityDamageCause.campfire,
  EntityDamageCause.soulCampfire,
]);
const BLAST_CAUSES = new Set([EntityDamageCause.blockExplosion, EntityDamageCause.entityExplosion]);

function protectionFactor(player: Player, source: EntityDamageSource): number {
  let reduction = 0;
  for (const armor of wornItems(player)) {
    reduction += PROTECTION_PER_LEVEL * surplus(armor, 'protection');
    if (FIRE_CAUSES.has(source.cause)) reduction += SPECIAL_PROTECTION_PER_LEVEL * surplus(armor, 'fire_protection');
    if (BLAST_CAUSES.has(source.cause)) reduction += SPECIAL_PROTECTION_PER_LEVEL * surplus(armor, 'blast_protection');
    if (source.cause === EntityDamageCause.projectile) {
      reduction += SPECIAL_PROTECTION_PER_LEVEL * surplus(armor, 'projectile_protection');
    }
    if (source.cause === EntityDamageCause.fall) reduction += SPECIAL_PROTECTION_PER_LEVEL * surplus(armor, 'feather_falling');
  }
  return 1 - Math.min(PROTECTION_CAP, reduction);
}

world.beforeEvents.entityHurt.subscribe((event) => {
  let damage = event.damage;
  const attacker = event.damageSource.damagingEntity;
  if (attacker instanceof Player) damage = attackBonus(attacker, event.hurtEntity, event.damageSource, damage);
  if (event.hurtEntity instanceof Player) damage *= protectionFactor(event.hurtEntity, event.damageSource);
  if (damage !== event.damage) event.damage = damage;
});

// ---------- melee hits: Knockback, Power Knockback, Fire Aspect ----------

function shove(from: Vector3, target: Entity, horizontal: number, vertical: number): void {
  const dx = target.location.x - from.x;
  const dz = target.location.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  try {
    target.applyKnockback({ x: (dx / length) * horizontal, z: (dz / length) * horizontal }, vertical);
  } catch (err) {
    log.warn(`could not knock back ${target.typeId}: ${String(err)}`);
  }
}

world.afterEvents.entityHitEntity.subscribe((event) => {
  const attacker = event.damagingEntity;
  if (!(attacker instanceof Player)) return;
  const weapon = heldItem(attacker);
  if (weapon === undefined) return;
  const target = event.hitEntity;

  const knockback = surplus(weapon, 'knockback');
  const power = totalLevel(weapon, POWER_KNOCKBACK);
  if (knockback > 0 || power > 0) {
    const horizontal = KNOCKBACK_PER_LEVEL * knockback + (power > 0 ? POWER_KNOCKBACK_BASE + POWER_KNOCKBACK_PER_LEVEL * power : 0);
    const vertical = Math.min(2.5, 0.4 + 0.05 * knockback + 0.08 * power);
    shove(attacker.location, target, horizontal, vertical);
    if (power > 0) {
      try {
        attacker.dimension.spawnParticle('minecraft:knockback_roar_particle', target.location);
        attacker.dimension.playSound('mob.ravager.roar', target.location, { pitch: 1.4, volume: 0.6 });
      } catch {
        // Decoration only.
      }
    }
  }

  const fire = surplus(weapon, 'fire_aspect');
  if (fire > 0) {
    try {
      target.setOnFire(FIRE_SECONDS_PER_LEVEL * fire + 4, true);
    } catch {
      // Some entities cannot burn.
    }
  }
});

// ---------- arrows: Punch, Flame ----------

world.afterEvents.projectileHitEntity.subscribe((event) => {
  const shooter = event.source;
  if (!(shooter instanceof Player)) return;
  const bow = heldItem(shooter);
  if (bow === undefined) return;
  const target = event.getEntityHit().entity;
  if (target === undefined) return;
  const punch = surplus(bow, 'punch');
  if (punch > 0) shove(shooter.location, target, KNOCKBACK_PER_LEVEL * punch, Math.min(2, 0.3 + 0.05 * punch));
  const flame = surplus(bow, 'flame');
  if (flame > 0) {
    try {
      target.setOnFire(FIRE_SECONDS_PER_LEVEL * flame + 5, true);
    } catch {
      // Some entities cannot burn.
    }
  }
});

// ---------- after damage: Extra Hit splash, super Thorns ----------

/** Entities hurt by a splash this tick, so a splash can never feed itself. */
const splashed = new Set<string>();
let splashing = false;

function extraHit(attacker: Player, victim: Entity, damage: number, level: number): void {
  if (Math.random() > EXTRA_HIT_BASE_CHANCE + EXTRA_HIT_CHANCE_PER_LEVEL * level) return;
  const radius = EXTRA_HIT_BASE_RADIUS + EXTRA_HIT_RADIUS_PER_LEVEL * level;
  const dimension = victim.dimension;
  const nearby = dimension
    .getEntities({
      location: victim.location,
      maxDistance: radius,
      excludeTypes: ['minecraft:player', 'minecraft:item', 'minecraft:xp_orb', 'minecraft:armor_stand', 'minecraft:arrow'],
      excludeFamilies: ['inanimate'],
    })
    .filter((entity) => entity.id !== victim.id && entity.id !== attacker.id && entity.getComponent('minecraft:health') !== undefined);
  if (nearby.length === 0) return;
  const amount = Math.max(1, Math.round(damage * EXTRA_HIT_DAMAGE_SHARE));
  splashing = true;
  try {
    for (const entity of nearby) {
      splashed.add(entity.id);
      try {
        entity.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: attacker });
        dimension.spawnParticle('minecraft:critical_hit_emitter', {
          x: entity.location.x,
          y: entity.location.y + 1,
          z: entity.location.z,
        });
      } catch {
        // Invulnerable or already gone.
      }
    }
    dimension.playSound('random.anvil_land', victim.location, { pitch: 1.6, volume: 0.5 });
  } finally {
    splashing = false;
    system.run(() => splashed.clear());
  }
}

world.afterEvents.entityHurt.subscribe((event) => {
  const { hurtEntity, damageSource, damage } = event;
  const attacker = damageSource.damagingEntity;

  if (attacker instanceof Player && damageSource.cause === EntityDamageCause.entityAttack && !splashing && !splashed.has(hurtEntity.id)) {
    const level = totalLevel(heldItem(attacker), EXTRA_HIT);
    if (level > 0) extraHit(attacker, hurtEntity, damage, level);
  }

  if (hurtEntity instanceof Player && attacker !== undefined && attacker.id !== hurtEntity.id && damageSource.cause === EntityDamageCause.entityAttack) {
    let thorns = 0;
    for (const armor of wornItems(hurtEntity)) thorns += surplus(armor, 'thorns');
    if (thorns > 0) {
      try {
        attacker.applyDamage(THORNS_PER_LEVEL * thorns, { cause: EntityDamageCause.thorns, damagingEntity: hurtEntity });
      } catch {
        // Invulnerable or already gone.
      }
    }
  }
});

// ---------- Super Efficiency: mining bedrock ----------

interface BedrockJob {
  dimensionId: string;
  block: Vector3;
  ticks: number;
  needed: number;
  idle: number;
}

const bedrockJobs = new Map<string, BedrockJob>();

function bedrockSeconds(level: number): number {
  return Math.max(10, Math.round(BEDROCK_SECONDS * (1 - BEDROCK_CUT_PER_LEVEL * (level - 1))));
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sameBlock(a: Vector3, b: Vector3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

function lookingAt(player: Player, location: Vector3): Block | undefined {
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: BEDROCK_REACH, includeLiquidBlocks: false, includePassableBlocks: false });
    if (hit === undefined || !sameBlock(hit.block.location, location)) return undefined;
    return hit.block;
  } catch {
    return undefined;
  }
}

world.afterEvents.entityHitBlock.subscribe((event) => {
  const player = event.damagingEntity;
  if (!(player instanceof Player) || event.hitBlock.typeId !== BEDROCK_ID) return;
  const level = totalLevel(heldItem(player), SUPER_EFFICIENCY);
  if (level === 0) return;
  const existing = bedrockJobs.get(player.id);
  const location = event.hitBlock.location;
  if (existing !== undefined && existing.dimensionId === player.dimension.id && sameBlock(existing.block, location)) {
    existing.idle = 0;
    return;
  }
  const seconds = bedrockSeconds(level);
  bedrockJobs.set(player.id, { dimensionId: player.dimension.id, block: location, ticks: 0, needed: seconds * 20, idle: 0 });
  say(player, 'super_enchantments.efficiency.start', clock(seconds));
});

function progressBar(fraction: number): string {
  const filled = Math.round(fraction * 10);
  return `${Format.aqua}[${'#'.repeat(filled)}${Format.gray}${'-'.repeat(10 - filled)}${Format.aqua}]${Format.reset}`;
}

function breakBedrock(player: Player, block: Block): void {
  const dimension = block.dimension;
  const center = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
  block.setType('minecraft:air');
  dimension.spawnItem(new ItemStack(BEDROCK_ID, 1), center);
  try {
    dimension.playSound('dig.stone', center, { pitch: 0.6, volume: 1 });
    dimension.spawnParticle('minecraft:knockback_roar_particle', center);
  } catch {
    // Decoration only.
  }
  say(player, 'super_enchantments.efficiency.done');
  log.info(`${player.name} mined bedrock at ${block.location.x},${block.location.y},${block.location.z}`);
}

const BEDROCK_TICK_STEP = 2;

system.runInterval(() => {
  for (const [playerId, job] of bedrockJobs) {
    const player = world.getEntity(playerId);
    if (!(player instanceof Player) || !player.isValid || player.dimension.id !== job.dimensionId) {
      bedrockJobs.delete(playerId);
      continue;
    }
    const level = totalLevel(heldItem(player), SUPER_EFFICIENCY);
    const block = level > 0 ? lookingAt(player, job.block) : undefined;
    if (block === undefined || block.typeId !== BEDROCK_ID) {
      job.idle += BEDROCK_TICK_STEP;
      if (job.idle >= BEDROCK_IDLE_TICKS || level === 0) {
        bedrockJobs.delete(playerId);
        player.onScreenDisplay.setActionBar({ translate: 'super_enchantments.efficiency.lost' });
      }
      continue;
    }
    job.idle = 0;
    job.ticks += BEDROCK_TICK_STEP;
    if (job.ticks >= job.needed) {
      bedrockJobs.delete(playerId);
      breakBedrock(player, block);
      continue;
    }
    if (job.ticks % 20 === 0) {
      try {
        block.dimension.playSound('hit.stone', block.location, { pitch: 0.5, volume: 0.6 });
      } catch {
        // Decoration only.
      }
    }
    if (job.ticks % 4 === 0) {
      const fraction = job.ticks / job.needed;
      player.onScreenDisplay.setActionBar({
        translate: 'super_enchantments.efficiency.progress',
        with: [progressBar(fraction), String(Math.floor(fraction * 100)), clock((job.needed - job.ticks) / 20)],
      });
    }
  }
}, BEDROCK_TICK_STEP);

// ---------- passive effects: super Efficiency (Haste), Respiration, Unbreaking ----------

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const tool = heldItem(player);
    const haste = surplus(tool, 'efficiency');
    if (haste > 0) {
      player.addEffect('haste', PASSIVE_TICKS * 2, { amplifier: Math.min(4, Math.ceil(haste / 5) - 1), showParticles: false });
    }
    if (player.isInWater) {
      const helmet = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Head);
      if (surplus(helmet, 'respiration') > 0) {
        player.addEffect('water_breathing', PASSIVE_TICKS * 2, { amplifier: 0, showParticles: false });
      }
    }
  }
}, PASSIVE_TICKS);

function repair(item: ItemStack, points: number): boolean {
  const durability = item.getComponent('minecraft:durability');
  if (durability === undefined || durability.damage === 0) return false;
  durability.damage = Math.max(0, durability.damage - points);
  return true;
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const tool = heldItem(player);
    if (tool !== undefined) {
      const points = surplus(tool, 'unbreaking');
      if (points > 0 && repair(tool, points)) setHeldItem(player, tool);
    }
    const equippable = player.getComponent('minecraft:equippable');
    if (equippable === undefined) continue;
    for (const slot of ARMOR_SLOTS) {
      const armor = equippable.getEquipment(slot);
      if (armor === undefined) continue;
      const points = surplus(armor, 'unbreaking');
      if (points > 0 && repair(armor, points)) equippable.setEquipment(slot, armor);
    }
  }
}, REPAIR_TICKS);

// ---------- debug: /scriptevent steveo:enchant <tower|fountain|lapis|bedrock|letters|info|apply id level> ----------

function lookedAtBlock(player: Player): Block | undefined {
  try {
    return player.getBlockFromViewDirection({ maxDistance: 8, includeLiquidBlocks: false })?.block;
  } catch {
    return undefined;
  }
}

function debugTower(player: Player): void {
  const origin = {
    x: Math.floor(player.location.x) - 4,
    y: Math.floor(player.location.y) - 5,
    z: Math.floor(player.location.z) - 4,
  };
  try {
    world.structureManager.place(STRUCTURE_ID, player.dimension, origin);
    say(player, 'super_enchantments.debug.tower');
  } catch (err) {
    log.error('could not place tower', err);
    say(player, 'super_enchantments.debug.tower.failed', err instanceof Error ? err.message : String(err));
  }
}

function debugPlaceAbove(player: Player, typeId: string, key: string): void {
  const above = lookedAtBlock(player)?.above();
  if (above === undefined) {
    say(player, 'super_enchantments.debug.look');
    return;
  }
  above.setType(typeId);
  say(player, key);
}

function debugInfo(player: Player): void {
  const item = heldItem(player);
  if (item === undefined) {
    say(player, 'super_enchantments.debug.info.none');
    return;
  }
  const levels = readSuper(item);
  const ids = new Set(Object.keys(levels));
  try {
    for (const enchant of enchantable(item)?.getEnchantments() ?? []) ids.add(enchant.type.id);
  } catch {
    // Not enchantable.
  }
  const sorted = [...ids].sort();
  say(player, 'super_enchantments.debug.info.header', itemName(item), String(sorted.length));
  if (sorted.length === 0) say(player, 'super_enchantments.debug.info.empty');
  for (const id of sorted) {
    say(
      player,
      'super_enchantments.debug.info.line',
      enchantName(id),
      roman(totalLevel(item, id)),
      String(vanillaMax(id)),
      String(nativeLevel(item, id)),
    );
  }
}

function resolveEnchantId(raw: string): string | undefined {
  const bare = raw.toLowerCase().replace(/^(minecraft|steveo):/, '');
  const custom = `steveo:${bare}`;
  if (isCustom(custom)) return custom;
  return EnchantmentTypes.get(bare)?.id;
}

function debugApply(player: Player, rawId: string | undefined, rawLevel: string | undefined): void {
  const id = rawId === undefined ? undefined : resolveEnchantId(rawId);
  const level = Number(rawLevel);
  const item = heldItem(player);
  if (id === undefined || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL || item === undefined) {
    say(player, 'super_enchantments.debug.apply.bad', String(MAX_LEVEL));
    return;
  }
  try {
    applyEnchantment(item, id, level);
    setHeldItem(player, item);
    say(player, 'super_enchantments.debug.apply', enchantName(id), roman(level), itemName(item));
  } catch (err) {
    say(player, 'super_enchantments.debug.apply.failed', enchantName(id), err instanceof Error ? err.message : String(err));
  }
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id !== 'steveo:enchant') return;
    const player = event.sourceEntity;
    if (!(player instanceof Player)) return;
    const [command, arg1, arg2] = event.message.trim().split(/\s+/);
    switch (command) {
      case 'tower':
        debugTower(player);
        break;
      case 'fountain':
        debugPlaceAbove(player, FOUNTAIN_ID, 'super_enchantments.debug.fountain');
        break;
      case 'bedrock':
        debugPlaceAbove(player, BEDROCK_ID, 'super_enchantments.debug.bedrock');
        break;
      case 'lapis':
        give(player, new ItemStack(LAPIS_ID, 64));
        say(player, 'super_enchantments.debug.lapis');
        break;
      case 'letters':
        celebrate(player.dimension, { x: player.location.x, y: player.location.y + 1, z: player.location.z });
        say(player, 'super_enchantments.debug.letters');
        break;
      case 'info':
        debugInfo(player);
        break;
      case 'apply':
        debugApply(player, arg1, arg2);
        break;
      default:
        say(player, 'super_enchantments.debug.help');
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
