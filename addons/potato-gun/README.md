# Potato Gun

Two weapons that fire potatoes, and two enchantments that change what the
potatoes do: one makes them explode, the other makes them poison mobs. The **Potato Crossbow** is quick and arcs like an arrow. The
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
| Poison Enchantment | Book + Poisonous Potato + Spider Eye (shapeless) |
| Poison Potato Crossbow | Potato Crossbow + Poison Enchantment (shapeless) |
| Poison Potato Launcher | Potato Launcher + Poison Enchantment (shapeless) |

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

| Gun | Speed | Damage | Cooldown | Explosive radius | Poison |
|---|---|---|---|---|---|
| Potato Crossbow | fast, arcs | 6 (3 hearts) | 0.5 s | 1.8 blocks | Poison I, 7 s |
| Potato Launcher | slower, straight | 12 (6 hearts) | 1.5 s | 3 blocks (a creeper) | Poison II, 7 s |

Potatoes fly like real projectiles: they arc under gravity, slow down
sharply in water, pass through grass and flowers, and carry some of your own
momentum, so a shot fired while running goes a little further.

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

## The Poison enchantment

Works the same way: craft a **Poison Enchantment** and combine it with a
gun. Poison potatoes are green and leave a green trail. A mob they hit takes
the gun's normal impact damage and is poisoned. They **never hurt players**:
a poison potato that hits a player splats harmlessly, with no damage, no
knockback, and no poison. Like vanilla poison, it cannot kill on its own (it
stops at half a heart), and undead mobs such as zombies and skeletons are
immune to the poison, though not to the impact.

A gun takes one enchantment. There is no explosive poison gun.

## How the flight works

The potato's flight is simulated by the script, not by the game's built-in
projectile physics, which changed under this add-on on Bedrock 1.26.50. Each
tick the script looks ahead along the potato's path for a block or mob, and
otherwise steers the potato entity along the path with an impulse, which the
game renders smoothly. If a game build ignores the impulses, the script falls
back to placing the potato each tick; `status` reports when that happens.
Because hits are worked out by the script, damage is credited to the shooter
the same way as before, and the potato cannot drift off course between
game versions.

## Chat commands

These are script events. Type them in chat with a leading slash. They are
the only way to see what the add-on is doing on a Realm, where there is no
content log.

| Command | What it does |
|---|---|
| `/scriptevent steveo:potato give` | Puts all six guns and both enchantments in your inventory. |
| `/scriptevent steveo:potato status` | Reports potatoes in flight, how many are on the teleport fallback, and whether explosions break blocks. |
| `/scriptevent steveo:potato demo` | Fires a crossbow potato from your view with no gun, to check the projectile renders. |
| `/scriptevent steveo:potato` | Prints the usage line. |

Messages from the add-on are prefixed `[Potato Gun]`.

## Troubleshooting

- **Using the gun does nothing, not even a sound**: the script is not
  running. Check the version triple in the root `CLAUDE.md`.
- **You hear the shot but see nothing fly**: the resource pack is not
  rendering. Run `demo`; if that is invisible too, bump the RP version in
  its manifest and re-upload (Realm clients cache old packs). The damage
  still lands, since hits are worked out by the script, not the render.
- **Potatoes look jerky in flight**: run `status` right after a shot. If it
  reports potatoes on the teleport fallback, the game is ignoring impulses
  on the potato entity and the script is placing it tick by tick instead.
- **Potatoes hang in the air**: the script stopped. They are cleared within
  5 seconds of it starting again, and their 8-second fuse removes them
  either way.
- **Explosions do not break blocks**: `mobGriefing` is off. That is a
  choice, not a bug.
- **No "Explosive" or "Poison" line on a freshly crafted gun**: it appears
  the first time you hold the gun, not in the crafting output slot.
- **Pack icons missing in the Realm's Edit World screen**: expected on
  Realms for every add-on; not a bug in this pack.

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/potato_crossbow*.json`, `potato_launcher*.json` | The six guns (plain, explosive, poison), no durability, per-gun cooldown |
| `behavior_pack/items/*_enchantment.json` | The glinting enchantment books |
| `behavior_pack/recipes/*.json` | One recipe per item above |
| `behavior_pack/entities/potato.json` | The potato entity: launcher size as `mark_variant`, explosive/poison as `variant`, no gravity or block collision (the script flies it), 8 s self-destruct fuse |
| `src/main.ts` | Firing, flight simulation and hit detection, damage, poison, explosions, lore, hints, chat commands |
| `resource_pack/entity/potato.entity.json` | Client entity: textures by variant, spin, smoke and flame trails |
| `resource_pack/models/entity/potato.geo.json` | A lumpy three-cube potato |
| `resource_pack/animations/potato.animation.json` | Tumble, plus particle trails for explosive, poison, and launcher potatoes |
| `resource_pack/particles/potato_splat.json` | Potato chunks on impact, sampled from the vanilla potato texture |
| `resource_pack/particles/poison_*.json` | Green trail and impact puff for poison potatoes |
| `resource_pack/textures/items/*.png`, `textures/entity/*.png` | Item icons and potato skins |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

The icons, potato textures, and pack icon are generated pixel art;
`assets/generate.mjs` regenerates them (run it from the repo root with the
add-on folder as its argument).
