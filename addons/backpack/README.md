# Backpack

A craftable backpack you carry in your inventory, like a shulker box that
never has to be placed. Use it and it opens a chest's worth of storage that
goes wherever the backpack goes. It never breaks.

## Crafting

At a crafting table:

```
L _ L
L B L
L L L
```

`L` is leather, `B` a bundle, `_` empty.

The backpack has no durability, so there is nothing to repair. In creative it
is in the Items tab.

## Opening it

Hold the backpack and **use** it (right-click, or tap on touch). The backpack
floats up in front of your face; tap it (right-click, or the *Open* button on
touch) and the chest screen opens. Move items in and out like any chest,
then close it and walk on. The floating backpack goes back where it came
from when you step away, when the backpack leaves your inventory, or after
two minutes.

Only the player who brought a backpack out can open it. Anyone else who taps
it is told so.

The storage holds **27 items** (one chest). Bedrock's container screen only
comes in chest and double-chest sizes, so 27 is the closest it can get to
30; `inventory_size` in `behavior_pack/entities/backpack_storage.json` can be
raised to 54 for a double chest.

The items belong to the backpack, not to you: hand the backpack to a friend,
or leave it in a chest, and whoever picks it up next gets everything inside.
A backpack cannot go inside itself; the script hands it back to you if you
try. Backpacks can go inside other backpacks.

## How the storage works

Every backpack is tied to a hidden `steveo:backpack_storage` entity with a
27-slot container. The backpack item remembers its entity by id in a dynamic
property, and the entity spends its life parked in a "vault" high in the
Overworld sky at `100000, 200, 100000`, which the script keeps loaded with a
ticking area named `steveo_backpack_vault`. Opening the backpack teleports
the entity to you and back. Because the storage is a real container, nothing
is serialized: enchanted tools, shulker boxes, named items, and other
backpacks all survive inside it.

Two things can go wrong, and both are reported in chat:

- **"Out of reach right now"**: the vault chunk is not loaded yet (the first
  run after installing, or the world has used all ten ticking areas). The
  script re-requests the ticking area; try again in a moment.
- **"Storage is missing"**: the entity is gone, most likely to `/kill @e`.
  The contents are lost; `/scriptevent steveo:backpack reset` gives the
  backpack fresh, empty storage. The script never replaces storage on its
  own, so a temporarily unreachable backpack is never silently emptied.

Duplicating a backpack in creative copies its storage id, so the copies share
one set of contents.

## Chat commands

Script events. Type them in chat with a leading slash. All of them act on
the backpack in your hand.

| Command | What it does |
|---|---|
| `/scriptevent steveo:backpack open` | Opens the held backpack, same as using it. |
| `/scriptevent steveo:backpack give` | Puts a backpack in your inventory. |
| `/scriptevent steveo:backpack status` | Reports the storage entity id, how many slots are used, and whether the vault chunk is loaded. |
| `/scriptevent steveo:backpack reset` | Replaces the held backpack's storage with a new, empty one. |

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/backpack.json` | The item: single-stack, no durability, a short use cooldown |
| `behavior_pack/recipes/backpack.json` | The crafting recipe |
| `behavior_pack/entities/backpack_storage.json` | The storage entity: a 27-slot container that cannot be hurt, pushed, or despawned |
| `src/main.ts` | Use handling, storage lookup, the vault, sessions, ownership, chat commands |
| `resource_pack/entity/backpack_storage.entity.json` | Client entity for the floating backpack |
| `resource_pack/models/entity/backpack.geo.json` | The backpack model |
| `resource_pack/render_controllers/backpack.render_controllers.json` | Render controller for the floating backpack |
| `resource_pack/animations/backpack.animation.json` | The gentle bob while it floats |
| `resource_pack/textures/items/backpack.png`, `textures/entity/backpack.png` | Item icon and model texture |
| `resource_pack/texts/en_US.lang` | Every player-facing string |
| `assets/generate.mjs` | Regenerates the textures and pack icons |

## Tuning

The numbers live at the top of `src/main.ts` as named constants: how far
the backpack floats from you, the walk-away range and timeout, and the vault
location. Change them there, run `pnpm check`, and redeploy.
