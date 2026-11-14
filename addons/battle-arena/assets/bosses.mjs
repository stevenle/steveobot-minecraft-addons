// Generates the arena's boss entities: giant versions of vanilla mobs.
// Run from the repo root:
//   node addons/battle-arena/assets/bosses.mjs addons/battle-arena
//
// Each boss starts from the vanilla entity in assets/vanilla/ (copied from
// Mojang/bedrock-samples at tag v1.26.50.4), keeps that file's
// format_version and component shapes, and is patched:
//   - selected component groups are folded into the base components, the
//     rest (babies, jockeys, conversions, raids, villages) are dropped;
//   - components that would make it wander off, despawn, convert, or ride
//     are removed;
//   - health, damage, scale and collision box are set, it is made
//     persistent, knockback-proof, fall-proof, and given a boss bar;
//   - it targets players only.
// Copying shapes from the same format_version is the point: a shape from
// another format gets the whole entity rejected (see CLAUDE.md, Gotchas).
//
// The client entity is the vanilla one with a new identifier, so the boss
// uses vanilla geometry, textures, animations and render controllers.
// The generated output is what gets committed.
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: node bosses.mjs <addon dir>');
const vanilla = path.join(path.dirname(new URL(import.meta.url).pathname), 'vanilla');

/** Parses JSON with // and /* comments and trailing commas, as Mojang's files have. */
function jsonc(text) {
  let o = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      o += c;
      if (c === '\\') o += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      o += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      o += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
    } else o += c;
  }
  return JSON.parse(o.replace(/,(\s*[}\]])/g, '$1'));
}

const read = (rel) => jsonc(fs.readFileSync(path.join(vanilla, rel), 'utf8'));
function write(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${file}`);
}

const OWN_RENDER_CONTROLLER = 'controller.render.steveo_arena_boss';

/** Components no boss keeps. */
const DROP = [
  'minecraft:despawn',
  'minecraft:environment_sensor',
  'minecraft:transformation',
  'minecraft:is_shaking',
  'minecraft:timer',
  'minecraft:burns_in_daylight',
  'minecraft:rideable',
  'minecraft:behavior.mount_pathing',
  'minecraft:behavior.find_mount',
  'minecraft:addrider',
  'minecraft:shareables',
  'minecraft:behavior.pickup_items',
  'minecraft:behavior.equip_item',
  'minecraft:equip_item',
  'minecraft:behavior.avoid_mob_type',
  'minecraft:behavior.flee_sun',
  'minecraft:balloonable',
  'minecraft:leashable',
  'minecraft:leashable_to',
  'minecraft:interact',
  'minecraft:behavior.offer_flower',
  'minecraft:behavior.move_through_village',
  'minecraft:behavior.move_towards_dwelling_restriction',
  'minecraft:behavior.move_to_village',
  'minecraft:preferred_path',
  'minecraft:behavior.defend_village_target',
  'minecraft:dweller',
  'minecraft:annotation.break_door',
  'minecraft:angry',
  'minecraft:on_target_acquired',
  'minecraft:behavior.target_when_pushed',
  'minecraft:behavior.celebrate',
  'minecraft:hurt_on_condition',
  'minecraft:is_baby',
  'minecraft:can_join_raid',
  'minecraft:offspring',
  'minecraft:spawn_egg_interaction',
];

/** Players only, from any distance in the arena, without needing line of sight. */
const TARGET_PLAYERS = {
  priority: 2,
  reselect_targets: true,
  must_see: false,
  within_radius: 48,
  entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: 48 }],
};

const BOSSES = [
  {
    key: 'zombie_titan',
    from: 'zombie',
    fold: ['minecraft:zombie_adult'],
    // The 1.26 zombie client file (spears, kinetic weapons, public
    // variables) rendered nothing on a custom entity; the 1.21.50 one
    // (assets/vanilla/rp/zombie.legacy.entity.json, bedrock-samples tag
    // v1.21.50.7), a plain 1.8.0 file like the skeleton's, is used instead.
    client: 'zombie.legacy',
    ownRenderController: true,
    health: 280,
    attack: { damage: 10 },
    movement: 0.25,
    scale: 2.5,
    box: { width: 1.5, height: 4.75 },
    color: '#4F7A3A',
  },
  {
    key: 'executioner',
    from: 'vindicator',
    fold: [],
    // Raising the axe is driven by the aggro group, added and removed by
    // these events when a target is acquired or lost.
    keep: ['minecraft:on_target_acquired', 'minecraft:on_target_escape', 'minecraft:angry'],
    keepGroups: ['minecraft:vindicator_aggro'],
    keepEvents: ['minecraft:become_aggro', 'minecraft:stop_aggro'],
    health: 280,
    attack: { damage: 13 },
    movement: 0.3,
    scale: 2.4,
    box: { width: 1.45, height: 4.6 },
  },
  {
    key: 'bone_colossus',
    from: 'skeleton',
    // Melee, not the vanilla bow AI: as a giant, the bow attack barely
    // fired (2026-11-05). It swings a stone sword instead.
    fold: ['minecraft:melee_attack'],
    health: 250,
    attack: { damage: 11 },
    movement: 0.27,
    scale: 2.5,
    box: { width: 1.5, height: 4.75 },
    patch: (c) => {
      delete c['minecraft:behavior.ranged_attack'];
      delete c['minecraft:shooter'];
      c['minecraft:equipment'] = { table: 'loot_tables/entities/wither_skeleton_gear.json' };
    },
  },
  {
    key: 'iron_tyrant',
    from: 'iron_golem',
    fold: [],
    // The vanilla iron golem client would not render on a custom entity:
    // invisible with its own render controllers (controller.render.iron_golem
    // is defined in no published file, so the game special-cases the golem),
    // invisible with our plain controller (2026-11-06), and still invisible
    // with the entity_alphatest material (2026-11-11). So nothing here leans
    // on the golem any more: the boss ships its own copy of the geometry and
    // texture, its own animations, and has no runtime_identifier, the same
    // setup as mega-creepers' boss, which renders. The golem's upward toss
    // came with the runtime identifier; main.ts re-creates it.
    ownClient: true,
    noRuntime: true,
    health: 400,
    attack: { damage: { range_min: 10, range_max: 24 } },
    scale: 1.6,
    box: { width: 2.2, height: 4.6 },
  },
  {
    key: 'blaze_sovereign',
    from: 'blaze',
    // Always in ranged mode: the vanilla blaze swaps to melee when its
    // target is within two blocks, through events on being hurt, which are
    // dropped here. It throws longer, quicker volleys than a blaze.
    fold: ['ranged_mode'],
    health: 300,
    scale: 2.2,
    box: { width: 1.1, height: 4 },
    patch: (c) => {
      delete c['minecraft:on_hurt'];
      delete c['minecraft:on_hurt_by_player'];
      Object.assign(c['minecraft:behavior.ranged_attack'], {
        attack_interval: { min: 2.0, max: 3.5 },
        charge_shoot_trigger: 2.0,
        burst_shots: 5,
      });
    },
  },
  {
    key: 'hive_mother',
    from: 'witch',
    // A witch with a boss's health: she throws potions from further off
    // and drinks them as a witch does. Her brood is spawned by the script
    // (see `minions` in src/waves.ts).
    fold: [],
    health: 200,
    scale: 1.8,
    box: { width: 1.1, height: 3.4 },
    patch: (c) => {
      // Replaced by the players-only target goal every boss gets.
      delete c['minecraft:behavior.nearest_prioritized_attackable_target'];
      c['minecraft:behavior.ranged_attack'].attack_radius = 16;
    },
  },
  {
    key: 'alpha_ravager',
    from: 'ravager',
    fold: ['minecraft:hostile'],
    // Stunning and roaring are driven by vanilla events that add and remove
    // these groups (hostile included), so they stay real groups.
    keepGroups: ['minecraft:hostile', 'stunned', 'roaring'],
    keepEvents: ['minecraft:become_stunned', 'minecraft:start_roar', 'minecraft:end_roar'],
    health: 450,
    attack: { damage: 16 },
    scale: 1.5,
    box: { width: 2.9, height: 3.3 },
  },
  {
    key: 'wither_king',
    from: 'wither_skeleton',
    fold: [],
    health: 375,
    attack: { damage: 12, effect_name: 'wither', effect_duration: 10 },
    movement: 0.3,
    scale: 2.2,
    box: { width: 1.3, height: 3.7 },
  },
];

for (const boss of BOSSES) {
  const file = read(`bp/${boss.from}.json`);
  const entity = file['minecraft:entity'];
  const groups = entity.component_groups ?? {};
  const c = { ...entity.components };
  for (const g of boss.fold) {
    if (!groups[g]) throw new Error(`${boss.from} has no group ${g}`);
    Object.assign(c, groups[g]);
  }
  const drop = DROP.filter((key) => !boss.keep?.includes(key));
  for (const key of drop) delete c[key];

  c['minecraft:health'] = { value: boss.health, max: boss.health };
  if (boss.attack) c['minecraft:attack'] = boss.attack;
  if (boss.movement && c['minecraft:movement']) c['minecraft:movement'] = { value: boss.movement };
  c['minecraft:scale'] = { value: boss.scale };
  c['minecraft:collision_box'] = boss.box;
  c['minecraft:knockback_resistance'] = { value: 1 };
  c['minecraft:follow_range'] = { value: 64, max: 64 };
  c['minecraft:persistent'] = {};
  c['minecraft:fire_immune'] = {};
  c['minecraft:damage_sensor'] = { triggers: { cause: 'fall', deals_damage: 'no' } };
  c['minecraft:loot'] = { table: 'loot_tables/empty.json' };
  c['minecraft:experience_reward'] = { on_death: '100' };
  c['minecraft:boss'] = { should_darken_sky: false, hud_range: 55 };
  c['minecraft:behavior.nearest_attackable_target'] = TARGET_PLAYERS;
  c['minecraft:behavior.hurt_by_target'] = { priority: 1 };
  const family = c['minecraft:type_family']?.family ?? [];
  c['minecraft:type_family'] = { family: [...new Set([...family, 'monster', 'steveo_arena_boss'])] };
  boss.patch?.(c);

  const keptGroups = Object.fromEntries(
    (boss.keepGroups ?? []).map((g) => {
      const group = { ...groups[g] };
      for (const key of drop) delete group[key];
      if (group['minecraft:behavior.nearest_attackable_target']) {
        group['minecraft:behavior.nearest_attackable_target'] = TARGET_PLAYERS;
      }
      if (boss.movement && group['minecraft:movement']) group['minecraft:movement'] = { value: boss.movement };
      return [g, group];
    }),
  );
  const keptEvents = Object.fromEntries(
    (boss.keepEvents ?? []).filter((e) => entity.events?.[e]).map((e) => [e, entity.events[e]]),
  );

  write(`behavior_pack/entities/${boss.key}.json`, {
    format_version: file.format_version,
    'minecraft:entity': {
      description: {
        identifier: `steveo:${boss.key}`,
        ...(boss.noRuntime ? {} : { runtime_identifier: `minecraft:${boss.from}` }),
        is_spawnable: false,
        is_summonable: true,
      },
      component_groups: keptGroups,
      components: c,
      events: keptEvents,
    },
  });

  if (boss.ownClient) {
    writeOwnClient(boss);
    continue;
  }
  const client = read(`rp/${boss.client ?? boss.from}.entity.json`);
  const description = client['minecraft:client_entity'].description;
  description.identifier = `steveo:${boss.key}`;
  delete description.spawn_egg;
  if (boss.ownRenderController) description.render_controllers = [OWN_RENDER_CONTROLLER];
  write(`resource_pack/entity/${boss.key}.entity.json`, client);
}

/**
 * A client entity that names nothing vanilla: the geometry and texture are
 * copied into the pack under our own names, and the animations use only
 * queries every mob has. Bone names are the iron golem's.
 */
function writeOwnClient(boss) {
  const geo = read(`rp/${boss.from}.geo.json`);
  geo.format_version = '1.12.0';
  geo['minecraft:geometry'][0].description.identifier = `geometry.steveo_${boss.key}`;
  write(`resource_pack/models/entity/${boss.key}.geo.json`, geo);

  const texture = path.join(out, `resource_pack/textures/entity/${boss.key}.png`);
  fs.mkdirSync(path.dirname(texture), { recursive: true });
  fs.copyFileSync(path.join(vanilla, `rp/${boss.from}.png`), texture);
  console.log(`wrote ${texture}`);

  const anim = `animation.steveo_${boss.key}`;
  const stride = 'math.cos(query.modified_distance_moved * 38.17) * math.min(query.modified_move_speed, 1.0)';
  write(`resource_pack/animations/${boss.key}.animation.json`, {
    format_version: '1.8.0',
    animations: {
      [`${anim}.walk`]: {
        loop: true,
        bones: {
          leg0: { rotation: [`${stride} * 40.0`, 0, 0] },
          leg1: { rotation: [`-${stride} * 40.0`, 0, 0] },
          arm0: { rotation: [`-${stride} * 25.0`, 0, 0] },
          arm1: { rotation: [`${stride} * 25.0`, 0, 0] },
        },
      },
      [`${anim}.look_at_target`]: {
        loop: true,
        bones: { head: { rotation: ['query.target_x_rotation', 'query.target_y_rotation', 0] } },
      },
      // Both arms come up while it has someone to hit.
      [`${anim}.menace`]: {
        loop: true,
        bones: {
          arm0: { rotation: ['-70.0 + math.sin(query.life_time * 360.0) * 25.0', 0, 0] },
          arm1: { rotation: ['-70.0 - math.sin(query.life_time * 360.0) * 25.0', 0, 0] },
        },
      },
    },
  });

  write(`resource_pack/entity/${boss.key}.entity.json`, {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `steveo:${boss.key}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: `textures/entity/${boss.key}` },
        geometry: { default: `geometry.steveo_${boss.key}` },
        animations: {
          walk: `${anim}.walk`,
          look_at_target: `${anim}.look_at_target`,
          menace: `${anim}.menace`,
        },
        scripts: { animate: ['walk', 'look_at_target', { menace: 'query.has_target' }] },
        render_controllers: [OWN_RENDER_CONTROLLER],
      },
    },
  });
}

// A plain render controller (default geometry, material and texture) for
// bosses whose vanilla controller cannot be relied on.
write('resource_pack/render_controllers/bosses.render_controllers.json', {
  format_version: '1.8.0',
  render_controllers: {
    [OWN_RENDER_CONTROLLER]: {
      geometry: 'Geometry.default',
      materials: [{ '*': 'Material.default' }],
      textures: ['Texture.default'],
    },
  },
});

// The empty loot table the bosses point at: rewards come from the script.
write('behavior_pack/loot_tables/empty.json', { pools: [] });
