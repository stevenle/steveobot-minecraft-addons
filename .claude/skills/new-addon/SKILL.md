---
name: new-addon
description: Create a new Minecraft Bedrock add-on in this repo, or add content (items, recipes, entities, textures) to an existing one. Use whenever asked to build an add-on, custom item, craftable gear, or in-game behavior.
---

# Creating an add-on

## Scaffold, then verify continuously

```bash
pnpm new <slug> --name "Display Name" --description "..."   # fresh UUIDs, template layout
pnpm check                                                  # validate + typecheck + test + build; the gate
```

Slugs are lowercase with `-`/`_`. Never hand-write or copy UUIDs; `pnpm new` and
`crypto.randomUUID()` are the only sources. Read CLAUDE.md before starting — the
version triple, the two-tsconfig split, and the "build copies packs
byte-for-byte" rule all bind here.

## Where things go

| Content | Path |
|---|---|
| Custom item | `behavior_pack/items/<name>.json` |
| Crafting recipe | `behavior_pack/recipes/<name>.json` |
| Custom entity (server half) | `behavior_pack/entities/<name>.json` |
| Entity render (client half) | `resource_pack/entity/<name>.entity.json` |
| Entity model | `resource_pack/models/entity/<name>.geo.json` |
| Render controllers | `resource_pack/render_controllers/<name>.render_controllers.json` |
| Item icon atlas | `resource_pack/textures/item_texture.json` + `textures/items/*.png` |
| Worn-armor look | `resource_pack/attachables/<name>.json` (can reference vanilla armor textures like `textures/models/armor/gold_1`) |
| Player-facing strings | `resource_pack/texts/en_US.lang`, keys sent as `{ translate: 'key' }` |
| Behavior | `src/main.ts`, bundled to `scripts/main.js` |

Identifiers and script events use the `steveo:` namespace. Item display names:
give the item `minecraft:display_name` with value `item.steveo:<name>.name` and
define that key in `en_US.lang`.

## Script API lessons learned the hard way

- **Spawn entities with events via the options object**:
  `dimension.spawnEntity(id, loc, { spawnEvent: 'steveo:foo' })`. The
  `/summon`-style `'steveo:thing<steveo:foo>'` string **throws at runtime** —
  and typechecks fine, so you will not catch it before the game does. The
  failure is only visible in the content log, which is unreachable on a Realm.
- **Bulk block scanning goes through `system.runJob`** with a generator that
  yields every N `getBlock` calls, or a few thousand lookups stall the tick.
  Wrap `getBlock` in try/catch: unloaded chunks and world bounds throw.
- Always pass `{ namespaces: ['steveo'] }` to `scriptEventReceive.subscribe`.
- Give every gameplay add-on a `/scriptevent steveo:<debug>` command that
  exercises its moving parts and replies in chat. On a Realm, chat is the only
  console you have.
- Script-spawned helper entities need a self-destruct: a `minecraft:timer` in a
  component group the script re-adds (remove+add in one event `sequence`
  resets it) plus `minecraft:instant_despawn` on expiry. Otherwise a script
  hiccup litters the world permanently. Also add the fuse on
  `minecraft:entity_spawned` so a manual `/summon` cannot create an immortal one.

## Rendering tricks that work (and their limits)

- Through-wall "glow" = a marker **entity** whose custom material inherits a
  vanilla one and sets `"depthFunc": "Always"` (`resource_pack/materials/entity.material`).
  Add `"+states": ["Blending"]` + `blendSrc`/`blendDst` for translucency, and
  keep texture alpha above ~128 so an alpha-test fallback still shows it.
  Verified in-game on a Realm. There is **no** `depth_test` field in particle
  or entity JSON; the material is the only lever.
- **Custom particle materials do not render on a Realm** (verified
  2026-09-01 with a freshly bumped resource pack): `materials/particles.material`
  inheriting `particles_add` with `depthFunc: Always`, driven by
  `player.spawnParticle` with a `variable.color` tint, produced nothing at
  all, even in open air via the debug command. Entity materials in
  `materials/entity.material` DO work. Use marker entities for through-wall
  effects; do not retry particles without a new lead.
- Make marker entities pretty with a client-side animation instead of more
  geometry: nested bones (`spin` parent, tilted `gem` child), then a looping
  animation on the parent driving `rotation`/`position`/`scale` from
  `query.life_time`. Zero script cost.
- A cube can reuse one 16×16 texture on every face with per-face UV
  (`"uv": { "north": { "uv": [0,0], "uv_size": [16,16] }, ... }`, geometry
  format ≥ 1.16.0).
- Textures can be generated in a scratch Node script with `node:zlib` (PNG =
  IHDR/IDAT/IEND chunks + CRC32); no image tooling required. Pack icons are
  128×128, item icons 16×16.

## Before calling it done

`pnpm check` must pass, but it cannot see into the game: recipes, wearables,
render controllers, and materials only prove out in-game. Say so, and ship the
debug scriptevent alongside the feature.
