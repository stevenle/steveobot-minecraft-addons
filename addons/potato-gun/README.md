# Potato Gun

Two weapons that fire potatoes, and an enchantment that makes the potatoes
explode. The **Potato Crossbow** is quick and arcs like an arrow. The
**Potato Launcher** is a rocket launcher: its potato is bigger, slower,
flies nearly straight with a flame trail, and hits twice as hard. Both have
unlimited potatoes and never break.

## Crafting

At a crafting table:

| Item | Recipe |
|---|---|
| Potato Crossbow | Crossbow + Potato (shapeless) |
| Potato Launcher | See below |
| Explosive Enchantment | Book + TNT + Gunpowder (shapeless) |
| Explosive Potato Crossbow | Potato Crossbow + Explosive Enchantment (shapeless) |
| Explosive Potato Launcher | Potato Launcher + Explosive Enchantment (shapeless) |

The launcher:

```
I I I
F R P
I I I
```

`I` is an iron ingot, `F` a firework rocket, `R` redstone dust, `P` a potato.

## Using it

Hold a gun and **use** it (right-click / tap). The guns need no ammo: the
potatoes come from nowhere, and nothing is consumed per shot.

| Gun | Speed | Damage | Cooldown | Explosive radius |
|---|---|---|---|---|
| Potato Crossbow | fast, arcs | 4 (2 hearts) | 0.5 s | 1.8 blocks |
| Potato Launcher | slower, straight | 8 (4 hearts) | 1.5 s | 3 blocks (a creeper) |

Potatoes splat into chunks where they land. An explosive potato also
detonates, and the blast is credited to whoever fired it. Whether the blast
breaks blocks follows the `mobGriefing` game rule, the same as creepers, so
`/gamerule mobGriefing false` makes explosive potatoes hurt mobs and players
without cratering the world. Explosions never start fires.

## The Explosive enchantment

Bedrock does not allow custom enchantments, so Explosive is built the way it
plays: craft an **Explosive Enchantment** (a glinting book), then combine it
with a gun at a crafting table. The result is an explosive variant of that
gun with an enchantment glint and an "Explosive" line under its name.

## Chat commands

These are script events. Type them in chat with a leading slash. They are
the only way to see what the add-on is doing on a Realm, where there is no
content log.

| Command | What it does |
|---|---|
| `/scriptevent steveo:potato give` | Puts all four guns and an Explosive Enchantment in your inventory. |
| `/scriptevent steveo:potato status` | Reports potatoes in flight and whether explosions break blocks. |
| `/scriptevent steveo:potato demo` | Fires a crossbow potato from your view with no gun, to check the projectile renders. |
| `/scriptevent steveo:potato` | Prints the usage line. |

Messages from the add-on are prefixed `[Potato Gun]`.

## Troubleshooting

- **Using the gun does nothing, not even a sound**: the script is not
  running. Check the version triple in the root `CLAUDE.md`.
- **You hear the shot but see nothing fly**: the resource pack is not
  rendering. Run `demo`; if that is invisible too, bump the RP version in
  its manifest and re-upload (Realm clients cache old packs). The damage
  still lands, since it comes from the entity, not the render.
- **Explosive potatoes splat but do not explode**: run `status`. If it
  reports zero potatoes in flight right after a shot, the script lost the
  shot; the fallback reads the entity's variant, so this points at the
  entity events in `entities/potato.json`.
- **Explosions do not break blocks**: `mobGriefing` is off. That is a
  choice, not a bug.
- **No "Explosive" line on a freshly crafted explosive gun**: it appears
  the first time you hold the gun, not in the crafting output slot.
- **Pack icons missing in the Realm's Edit World screen**: expected on
  Realms for every add-on; not a bug in this pack.

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/potato_crossbow*.json`, `potato_launcher*.json` | The four guns (plain and explosive), no durability, per-gun cooldown |
| `behavior_pack/items/explosive_enchantment.json` | The glinting enchantment book |
| `behavior_pack/recipes/*.json` | One recipe per item above |
| `behavior_pack/entities/potato.json` | The potato projectile: crossbow/launcher stats as component groups, explosive flag as `variant`, 8 s self-destruct fuse |
| `src/main.ts` | Firing, hit effects, explosions, lore, hints, chat commands |
| `resource_pack/entity/potato.entity.json` | Client entity: textures by variant, spin, smoke and flame trails |
| `resource_pack/models/entity/potato.geo.json` | A lumpy three-cube potato |
| `resource_pack/animations/potato.animation.json` | Tumble, plus particle trails for explosive and launcher potatoes |
| `resource_pack/particles/potato_splat.json` | Potato chunks on impact, sampled from the vanilla potato texture |
| `resource_pack/textures/items/*.png`, `textures/entity/*.png` | Item icons and potato skins |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

The icons, potato textures, and pack icon are generated pixel art;
`assets/generate.mjs` regenerates them (run it from the repo root with the
add-on folder as its argument).
