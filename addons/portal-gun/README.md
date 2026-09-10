# Portal Gun

A handheld portal device for Minecraft Bedrock, in the spirit of *Portal*.
Fire a blue portal and an orange portal onto any solid surface; walk, fall,
or throw things into one and they come out the other, facing outward, with
their speed carried through. The gun never breaks.

## Crafting

At a crafting table:

```
I I O
I R _
I _ _
```

`I` is an iron ingot, `O` a block of obsidian, `R` redstone dust, `_` empty.
The gun has no durability, so there is nothing to repair.

## Using it

Hold the gun and aim at a block within 64 blocks.

| Input | Effect |
|---|---|
| **Use** (right-click / tap) | Fires the loaded portal |
| **Attack** (left-click / swing, even at air) | Switches between **blue** and **orange** |
| **Crouch + Use** | Also switches colors, for touch and controller players |

The gun shows which color is loaded: its core and muzzle glow blue or
orange, and its name reads *Portal Gun (Blue)* or *Portal Gun (Orange)*.
The action bar confirms each switch. Under the hood the gun is two item
variants that the script swaps in your hand, keeping any custom name or lore.
Attacking with the gun never breaks blocks, in Survival or Creative, so the
attack button is safe to press anywhere. Crouch + Use does the same switch
without a swing, which matters on touch where a tap on empty space does not
count as an attack.

Firing a color again moves that portal. Each player owns one pair, and any
player, mob, or item can travel through anyone's pair. A portal on a wall is
one block wide and two tall; on a floor or ceiling it is a one-block disc.
Shooting the top edge of a short wall slides the portal down so it still fits.

A shot fizzles, with a note in the action bar, when nothing is in range,
when there is no room in front of the surface, or when the spot already has
a portal.

**Momentum carries through.** Fall into a floor portal and you fly out of a
wall portal at the speed you were falling. Exit speed is capped at three
blocks per tick. Coming out of a portal you are ignored by it until you step
clear, so standing in a floor portal does not bounce you back and forth.

**Portals persist.** They survive relogging and world reloads, and work
across dimensions, but only while both ends are in loaded chunks. A portal
whose script bookkeeping is lost fades on its own after 30 seconds instead
of lingering forever.

## Chat commands

These are script events. Type them in chat with a leading slash. They are
the only way to see what the add-on is doing on a Realm, where there is no
content log.

| Command | What it does |
|---|---|
| `/scriptevent steveo:portal give` | Puts a Portal Gun in your inventory. |
| `/scriptevent steveo:portal clear` | Removes both of your portals. |
| `/scriptevent steveo:portal status` | Lists your portals: color, kind, cell, dimension, and whether each is loaded. |
| `/scriptevent steveo:portal demo` | Spawns an unlinked blue and orange portal in front of you for 30 seconds, to check rendering. |
| `/scriptevent steveo:portal` | Prints the usage line. |

Messages from the add-on are prefixed `[Portal Gun]`.

## Troubleshooting

- **Nothing happens on use, no action-bar text**: the script is not
  running. Check the version triple in the root `CLAUDE.md`.
- **`status` lists portals but you cannot see them**: the resource pack is
  not rendering. Run `demo`; if the demo portals are invisible too, bump the
  RP version in its manifest and re-upload (Realm clients cache old packs).
- **Portals visible but no teleport**: run `status` and check both ends say
  loaded. A pair only works while both chunks are loaded.
- **Attack does not switch colors**: the swing event needs script API 2.9
  or newer (see the version triple). On touch, attack is a tap on a block or
  mob; a tap on empty space does not swing. Crouch + Use switches regardless.
- **Portal placed oddly on a short wall**: expected; it slid down to fit.
- **Pack icons missing in the Realm's Edit World screen**: expected on
  Realms for every add-on; not a bug in this pack.

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/portal_gun.json`, `items/portal_gun_orange.json`, `recipes/portal_gun.json` | The gun's blue and orange variants (no durability) and its recipe |
| `behavior_pack/entities/portal.json` | The portal marker: color and orientation component groups, 30 s self-destruct fuse |
| `src/main.ts` | Raycast placement, per-player portal registry, traversal with momentum, persistence, chat commands |
| `resource_pack/entity/portal.entity.json` | Client entity: textures, material, animations |
| `resource_pack/models/entity/portal.geo.json` | A vertical 1×2 plane and a horizontal 1×1 plane, toggled by orientation |
| `resource_pack/render_controllers/portal.render_controllers.json` | Picks the texture by color and the plane by orientation |
| `resource_pack/animations/portal.animation.json` | Rotates walls to face the right axis; pulses and spins the ovals |
| `resource_pack/materials/entity.material` | Emissive, alpha-blended, double-sided material |
| `resource_pack/textures/entity/portal_*.png` | Wall oval and floor disc per color |
| `resource_pack/textures/items/portal_gun_*.png` | Gun icon per loaded color |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

The portal textures, gun icons, and pack icon are generated pixel art;
`assets/generate.mjs` regenerates them (run it from the repo root with the
add-on folder as its argument).
