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

Hold the backpack and **use** it (right-click, or tap on touch). A chest
screen opens at once: the top grid is the backpack, the bottom is your own
inventory laid out the way the inventory screen shows it. **Tap an item to
move it across**: tap something in the backpack and it lands in your
inventory, tap something in your inventory and it goes into the backpack. A
whole stack moves per tap. Close the screen with the usual back button.

This is a form styled to look like a chest, not a real chest screen, so
there is no dragging and no splitting stacks; take the stack out, split it
in your inventory, and put part back. In exchange it opens directly from
your hand with one tap, which a real container cannot do in Bedrock.

The storage holds **27 items** (one chest). Bedrock's chest layout comes in
rows of nine, so 27 is the closest it can get to 30; `CHEST_27_SLOTS` and
the matching `inventory_size` in `behavior_pack/entities/backpack_storage.json`
are the two numbers to change.

The items belong to the backpack, not to you: hand the backpack to a friend,
or leave it in a chest, and whoever picks it up next gets everything inside.
A backpack cannot go inside itself. Backpacks can go inside other backpacks.

## How the storage works

Every backpack is tied to a hidden `steveo:backpack_storage` entity with a
27-slot container. The backpack item remembers its entity by id in a dynamic
property, and the entity lives in a "vault" high in the Overworld sky at
`100000, 200, 100000`, which the script keeps loaded with a ticking area
named `steveo_backpack_vault`. The chest screen is a form; each tap moves a
stack between your inventory and that container with `transferItem`, so
nothing is serialized: enchanted tools, shulker boxes, named items, and
other backpacks all survive inside it. Nobody can open the entity directly.

The chest look comes from [Chest-UI](https://github.com/Herobrine643928/Chest-UI)
by LeGend077 and Herobrine64 (CC-BY-4.0): `resource_pack/ui/` restyles any
form whose title carries its size flag into a chest grid with the player's
inventory below, and `src/chest-ui/typeIds.js` maps item ids to the numbers
that UI uses to draw icons. Icons for items the table does not know (this
repo's own items) are given as texture paths in `src/chest-ui/chest-form.ts`.
If a game update shifts the numeric ids, vanilla icons in the backpack come
out wrong until `typeIds.js` is refreshed from upstream; the item names stay
correct either way.

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
| `/scriptevent steveo:backpack debug` | Toggles a chat narration of every tap in the backpack screen: which slot was hit, what was there, and whether it moved. Errors in the screen are reported in chat regardless. |

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/backpack.json` | The item: single-stack, no durability, a short use cooldown |
| `behavior_pack/recipes/backpack.json` | The crafting recipe |
| `behavior_pack/entities/backpack_storage.json` | The storage entity: a 27-slot container that cannot be hurt, pushed, or despawned |
| `src/main.ts` | Use handling, storage lookup, the vault, the tap-to-move loop, chat commands |
| `src/chest-ui/chest-form.ts` | Builds the chest-styled form: slot buttons, icons, stack and durability markers |
| `src/chest-ui/typeIds.js` | Vendored Chest-UI item id table (CC-BY-4.0, see `LICENSE` beside it) |
| `resource_pack/ui/` | Vendored Chest-UI layouts: `server_form.json` picks the chest look, `chest_server_form.json` and `chest_inventory_system.json` draw it |
| `resource_pack/textures/ui/` | Slot and background textures for the chest look |
| `resource_pack/entity/backpack_storage.entity.json`, `models/`, `render_controllers/`, `animations/` | How the storage entity would render; it lives out of sight in the vault |
| `resource_pack/textures/items/backpack.png`, `textures/entity/backpack.png` | Item icon and model texture |
| `resource_pack/texts/en_US.lang` | Every player-facing string |
| `assets/generate.mjs` | Regenerates the textures and pack icons |

## Tuning

The numbers live at the top of `src/main.ts` as named constants: the vault
location and the busy-retry cadence for the form. Change them there, run
`pnpm check`, and redeploy.
