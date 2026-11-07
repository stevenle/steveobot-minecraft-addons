// Generates the Nimbus King and the Charge minion from the vanilla breeze.
// Run from the repo root:
//   node addons/cloud-dimension/assets/entities.mjs addons/cloud-dimension
//
// Both start from assets/vanilla/ (Mojang/bedrock-samples at tag v1.26.50.4)
// and keep that file's format_version and component shapes, because a shape
// from another format gets the whole entity rejected (CLAUDE.md, Gotchas).
// The patches:
//   - new identifier, not naturally spawnable, the breeze runtime id;
//   - the idle-sound property, its sensor and events are dropped (a custom
//     entity should not declare minecraft:-namespaced properties);
//   - projectile reflection and projectile immunity are dropped, so bows work;
//   - players are the only targets;
//   - health, scale, collision box and family are set; the king also gets a
//     boss bar, knockback immunity and persistence, the Charge a random
//     health of 10, 15, 20 or 25.
//
// The client entities are the vanilla breeze's with their own copies of the
// published breeze render controllers (a renamed vanilla client file whose
// controllers resolve to nothing spawns invisible; see CLAUDE.md). The king's
// copies add a white overlay so it reads as a cloud.
// The generated output is what gets committed.
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: node entities.mjs <addon dir>');
const vanilla = path.join(path.dirname(new URL(import.meta.url).pathname), 'vanilla');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(vanilla, rel), 'utf8'));
function write(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${file}`);
}

const PLAYERS_ONLY = (radius) => ({
  priority: 1,
  must_see: false,
  reselect_targets: true,
  within_radius: radius,
  entity_types: [
    {
      filters: { test: 'is_family', subject: 'other', value: 'player' },
      max_dist: radius,
    },
  ],
});

function patchBreeze({ id, health, scale, family, extra, groups, events }) {
  const file = read('bp/breeze.json');
  const entity = file['minecraft:entity'];
  entity.description = {
    identifier: id,
    runtime_identifier: 'minecraft:breeze',
    is_spawnable: false,
    is_summonable: true,
  };
  const c = entity.components;
  delete c['minecraft:environment_sensor'];
  delete c['minecraft:reflect_projectiles'];
  c['minecraft:damage_sensor'] = { triggers: [{ cause: 'fall', deals_damage: 'no' }] };
  c['minecraft:behavior.nearest_attackable_target'] = PLAYERS_ONLY(extra.targetRadius ?? 24);
  c['minecraft:behavior.hurt_by_target'] = { priority: 4 };
  c['minecraft:health'] = { value: health, max: health };
  c['minecraft:scale'] = { value: scale };
  c['minecraft:collision_box'] = {
    width: Math.round(0.6 * scale * 100) / 100,
    height: Math.round(1.77 * scale * 100) / 100,
  };
  c['minecraft:type_family'] = { family: [...family, 'breeze', 'monster', 'mob'] };
  Object.assign(c, extra.components ?? {});
  for (const key of extra.drop ?? []) delete c[key];
  entity.component_groups = groups ?? {};
  entity.events = events ?? {};
  return file;
}

// ---------- Nimbus King ----------
const king = patchBreeze({
  id: 'steveo:nimbus_king',
  health: 1500,
  scale: 3.5,
  family: ['steveo_nimbus_king'],
  extra: {
    targetRadius: 40,
    components: {
      'minecraft:knockback_resistance': { value: 1 },
      'minecraft:follow_range': { value: 48, max: 48 },
      'minecraft:fire_immune': {},
      'minecraft:loot': { table: 'loot_tables/empty.json' },
      'minecraft:experience_reward': { on_death: '500' },
      'minecraft:boss': { should_darken_sky: false, hud_range: 64 },
      'minecraft:nameable': {},
    },
  },
});
{
  const c = king['minecraft:entity'].components;
  const fire = c['minecraft:behavior.fire_at_target'];
  fire.attack_cooldown = 2;
  fire.attack_range = { min: 0, max: 32 };
  fire.owner_offset = [0, 1.2, 0];
  // The king cannot be shoved out of its arena by players or minions.
  delete c['minecraft:pushable_by_entity'];
}
write('behavior_pack/entities/nimbus_king.json', king);

// ---------- Charge ----------
const HEALTHS = [10, 15, 20, 25];
const chargeGroups = Object.fromEntries(
  HEALTHS.map((hp) => [`steveo:health_${hp}`, { 'minecraft:health': { value: hp, max: hp } }]),
);
const charge = patchBreeze({
  id: 'steveo:charge',
  health: 20,
  scale: 0.75,
  family: ['steveo_charge'],
  extra: { targetRadius: 20 },
  groups: chargeGroups,
  events: {
    'minecraft:entity_spawned': {
      sequence: [
        {
          randomize: HEALTHS.map((hp) => ({ weight: 1, add: { component_groups: [`steveo:health_${hp}`] } })),
        },
      ],
    },
  },
});
write('behavior_pack/entities/charge.json', charge);

// ---------- Client entities ----------
const controllers = read('rp/breeze.render_controllers.json').render_controllers;
const ownControllers = {};
function clientFor(id, prefix, overlay) {
  const file = read('rp/breeze.entity.json');
  const d = file['minecraft:client_entity'].description;
  d.identifier = id;
  delete d.spawn_egg;
  d.spawn_egg = { base_color: overlay ? '#F4F8FF' : '#9AD8FF', overlay_color: '#4A7FB5' };
  d.render_controllers = Object.keys(controllers).map((name) => {
    const own = name.replace('controller.render.breeze', `controller.render.${prefix}`);
    const copy = structuredClone(controllers[name]);
    if (overlay && name === 'controller.render.breeze') copy.overlay_color = overlay;
    ownControllers[own] = copy;
    return own;
  });
  return file;
}
write('resource_pack/entity/nimbus_king.entity.json', clientFor('steveo:nimbus_king', 'steveo_nimbus_king', {
  r: '1.0',
  g: '1.0',
  b: '1.0',
  a: '0.55',
}));
write('resource_pack/entity/charge.entity.json', clientFor('steveo:charge', 'steveo_charge'));
write('resource_pack/render_controllers/breezes.render_controllers.json', {
  format_version: '1.8.0',
  render_controllers: ownControllers,
});
