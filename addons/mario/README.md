# Mario

Mario comes to Minecraft Bedrock: Goombas, Koopa Troopas, and Bob-ombs roam
at night, Bowser waits in his castle, question blocks float over the land,
three power-ups let you fly, swim, and throw fireballs, and you can drive
a Mario Kart.

## Mobs

All three small mobs spawn on the surface in the dark, like zombies, and
share the vanilla monster cap. Each has a spawn egg in creative.

| Mob | Health | What it does |
|---|---|---|
| **Goomba** | 8 | Walks at you and bites for 1 heart. Usually comes out at night, but a confused one sometimes wanders out early at sunset. |
| **Koopa Troopa** | 20 | Hits for 1.5 hearts. When hurt it may duck into its shell (once per life) for 8 seconds. The shell adds 20 health, so you have to deal 20 more damage to finish it. |
| **Bob-omb** | 12 | A creeper: walks up to you, its fuse hisses, it swells and flashes, and it explodes (power 3, like a creeper). It never sets fires. |

**Stomping works.** Land on a Goomba from above and it is squashed. Land on
a Koopa and it is knocked into its shell. Either way you bounce off.

**Sunset Goombas.** Between time 11500 and 13000 (sunset), each player in the
Overworld has a 20% chance every 10 seconds of a Goomba wandering in 10 to 20
blocks away, up to 3 nearby. Spawn rules cannot filter on time of day, so the
script does this.

Bob-omb explosions follow the `mobGriefing` game rule, as creeper
explosions do. **On a Realm with `mobGriefing` off (like the family Realm),
Bob-ombs hurt players but break no blocks.**

## Bowser's Castle

Bowser's Castles are rare. They generate on the surface of plains, desert,
savanna, and badlands biomes, roughly one per 400 chunks. Each one is a
23×31 stone-brick keep with corner towers. Inside:

- **Entrance hall:** a nether-brick path between two lava pools, with a row
  of question blocks overhead.
- **Throne room:** lava channels along both walls, a gold-and-blackstone
  throne, and the **Bowser Seal** in the middle of the floor.

When a survival or adventure player comes within 14 blocks of the seal,
**Bowser rises** (a chat message and a roar announce him) and the seal turns
to nether brick, so each castle gives one Bowser. He has 300 health and a
boss bar. He hits for 5 hearts, shrugs off knockback, fire, and lava, and
every few seconds breathes a fan of 3 big fireballs at the nearest player.
Below a third of his health he gets angry and breathes 5 at a time, more
often.

Defeating him drops 3-6 diamonds, 2-4 gold blocks, emeralds, golden apples,
netherite scrap, a Fire Flower, a 25% chance of an enchanted golden apple,
and 200 XP.

Castles only appear in chunks generated **after** the add-on is installed.
To get one on land you have already explored, use
`/scriptevent steveo:mario castle`.

## Question blocks

Question blocks float four blocks above the ground in rows of brick, ?,
brick, ?, brick, about one row per 33 chunks on land, plus the row in each
castle. Mine one (it breaks fast with anything) and it pops out one random
prize: usually gold nuggets ("coins"), sometimes ingots, emeralds, XP
bottles, food, or fireworks. Rarely it drops a diamond, a golden apple, a
Fire Flower, a Squirrel Suit, a Frog Suit, or a Totem of Undying (a 1-Up).

## Power-ups

All three are also craftable.

| Power-up | Recipe | What it does |
|---|---|---|
| **Squirrel Suit** (chestplate) | 7 leather around a phantom membrane, in the chestplate shape | **Fly.** In the air, hold jump to fly up, hold forward to fly where you look, let go to glide down slowly, and sneak to drop. No fall damage while you wear it. |
| **Frog Suit** (chestplate) | 7 slime balls around a pufferfish, in the chestplate shape | **Swim.** You can always breathe underwater. In water you also get Dolphin's Grace (fast swimming) and Night Vision. |
| **Fire Flower** | A poppy surrounded by 4 blaze powder (a plus shape) | **Fireballs.** Use it (right-click / tap) to throw a bouncing fireball that deals 2.5 hearts. Up to 3 can be in the air at once. It never runs out. Fireballs fizzle on walls and in water, and **never set anything on fire**. |

The suits are both chestplates, so you wear one at a time. Each gives
leather-level protection (3), has 240 durability, and can be repaired (the
Squirrel Suit with leather, the Frog Suit with slime balls).

## Mario Kart

Craft a **Mario Kart** at a crafting table: a lever (steering wheel) on
top, iron ingot / redstone block / iron ingot across the middle, and coal
blocks (wheels) in the two bottom corners. Use it on the ground to place
the kart. Right-click / tap it (**Drive**) to get in.

- Move forward to drive and look where you want to go. It steers like a
  horse, and it is faster than one.
- It climbs one-block steps, takes no fall, fire, lava, or drowning
  damage, and stays where you leave it.
- Sneak to get out. Punch it a few times to break it back into the item.

## Debug commands

```
/scriptevent steveo:mario give     # Fire Flower, both suits, a Mario Kart, 8 question blocks
/scriptevent steveo:mario castle   # build Bowser's Castle in front of you (gate 2 blocks ahead)
/scriptevent steveo:mario row      # a question-block row above you
/scriptevent steveo:mario goomba   # spawn a Goomba in front of you
/scriptevent steveo:mario koopa    # spawn a Koopa Troopa
/scriptevent steveo:mario shell    # send the nearest Koopa into its shell
/scriptevent steveo:mario bomb     # spawn a Bob-omb
/scriptevent steveo:mario bowser   # raise Bowser in front of you
/scriptevent steveo:mario breath   # make the nearest Bowser breathe fire at you
/scriptevent steveo:mario kart     # place a Mario Kart in front of you
/scriptevent steveo:mario sunset   # set the time to sunset and spawn a confused Goomba
/scriptevent steveo:mario status   # nearby mob and kart counts, Bowsers, fireballs, time, your suit
```

The castle seal only wakes for survival and adventure players. In creative,
use `bowser` to spawn him directly.

## Files

| Path | What |
|---|---|
| `src/mobs.ts` | Sunset Goombas, Koopa shells, stomping |
| `src/bowser.ts` | The Bowser Seal block component, Bowser's fire breath, the defeat message |
| `src/fireball.ts` | Script-simulated fireballs (bounce, hit, fizzle) for the Fire Flower and Bowser |
| `src/suits.ts` | Squirrel Suit flight and fall-damage cancel, Frog Suit effects |
| `src/items.ts` | Fire Flower throwing, the question block's coin sound |
| `src/kart.ts` | The Mario Kart's first-ride hint (driving itself is data-driven) |
| `behavior_pack/entities/` | The four mobs, the fireball, and the kart |
| `behavior_pack/spawn_rules/` | Night spawning for Goombas, Koopas, and Bob-ombs |
| `behavior_pack/features/`, `feature_rules/` | Scatters castles and question-block rows |
| `behavior_pack/structures/steveo/` | The castle and the question row (generated) |
| `behavior_pack/loot_tables/` | Mob drops, Bowser's treasure, question-block prizes |

Regenerate the models, skins, block and item textures, armor layers, pack
icons, and both structures with
`node addons/mario/assets/generate.mjs addons/mario`. The castle layout lives
in that script. Edit it there, rerun, and commit the new `.mcstructure`.

## Not yet verified in-game

Everything here has only passed `pnpm check`. Things to check first:

- Models and skins for all four mobs, the Koopa's shell-only look, and the
  Bob-omb's swell and flash (`query.swell_amount` copied from the vanilla
  creeper).
- The Bowser Seal ticking in a world-generated castle (it has a scheduled
  tick and a random-tick fallback).
- Squirrel Suit flight feel. It is driven by `applyKnockback` every tick,
  which may feel laggy on a Realm.
- Natural generation of castles and question rows, as opposed to the debug
  commands. The rows use a `block_intersection` air-only constraint.
- Fireball movement (the impulse-steered entity, with a teleport fallback,
  as in potato-gun).
- The Mario Kart: driving speed (`minecraft:movement` 0.4 in
  `entities/kart.json`; horses top out near 0.34), where the driver sits
  (the seat position), which way the wheels roll, and that the item places
  it.
