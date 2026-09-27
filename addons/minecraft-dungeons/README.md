# Minecraft Dungeons

Four cards from the Minecraft Dungeons Arcade, brought into Bedrock: the
**Firebrand** axe, the **Ender Armor** set, the **Corrupted Beacon**, and
**Tim**. Each item follows what its card says; the quotes below are the
card text.

## Firebrand (melee)

> Crafted in the blackest depths of the Fiery Forge and enchanted with fiery
> powers.

A diamond-grade axe that never breaks. Every swing sweeps an arc of flame
through the air in front of you, and everything it hits burns for 5
seconds. It chops wood like a diamond axe and takes axe enchantments.

```
F F
F R
. R
```

`F` is a fire charge, `R` a blaze rod.

## Ender Armor (armor)

> Increase your hit points with armor that is truly otherworldly!

A four-piece set, each piece as tough as diamond, and none of it ever
breaks. Wearing **all four**:

- **+4 hearts.** You get Health Boost II while the set is on. It shows up as
  the potion effect, is topped up automatically, survives milk and death,
  and goes away when you take a piece off. A stronger Health Boost potion
  is left alone.
- **Ender blink.** Like an enderman, a hit from a mob or an arrow has a 1 in
  4 chance to miss you entirely: you teleport 4 to 8 blocks away, usually
  away from the attacker, in a puff of purple. At most once every 3
  seconds. If there is no safe ground nearby you still dodge the hit, you
  just stay put.

Each piece is crafted by upgrading the matching diamond piece:

```
O P O
P D P
O P O
```

`O` is obsidian, `P` an ender pearl, `D` the diamond helmet, chestplate,
leggings, or boots.

## Corrupted Beacon (range)

> The Corrupted Beacon holds immense power within. It waits for the moment
> to unleash its wrath.

Use it (right-click, or tap on touch screens) to unleash a pink laser for 5
seconds. The laser follows wherever you look, reaches 20 blocks or the
first wall, and hits **every** mob along it for 3 hearts four times a
second. You are slowed while it fires, and switching items stops it. Then
it recharges for 4 seconds; the hotbar sweep shows when it is ready. It
never breaks.

Players and tamed pets (Tim, wolves, cats) are never hit.

```
C E C
E B E
C E C
```

`C` is crying obsidian, `E` an eye of ender, `B` a beacon.

## Tim (skin)

> Tim is a dancer at heart. Their grace both in and out of battle is simply
> unrivaled.

Add-ons cannot change a player's skin, so Tim comes to life as a companion
instead, in the outfit from the card: red mask, red and white gear, and a
blue gauntlet.

Use a **Tim's Card** to summon Tim next to you. Tim:

- follows you, and teleports to you if left behind,
- fights monsters near you and anything that attacks you or that you
  attack (but leaves creepers alone, like a wolf),
- sits or stands when you tap them,
- **dances** when standing still with no fighting around, with music notes,
- **dodges** 1 in 4 attacks gracefully,
- has 20 hearts and heals with bread or cake.

The card is used up (except in Creative).

```
R P R
P J P
R P R
```

`R` is red dye, `P` paper, `J` a jukebox.

The Creative inventory also has a Tim spawn egg. An egg-spawned Tim is wild:
they wander and dance but do not follow anyone. Feed one cookies to
befriend them.

## Chat commands

Chat is the only console on a Realm, so the add-on answers to a script
event:

```
/scriptevent steveo:dungeons give     # Firebrand, all four Ender pieces, the Beacon, 3 Tim's Cards
/scriptevent steveo:dungeons status   # armor pieces, Health Boost, max health, beacon cooldown, Tims
/scriptevent steveo:dungeons blink    # teleport as if the Ender Armor dodged a hit
/scriptevent steveo:dungeons beam     # fire the held Corrupted Beacon, ignoring the cooldown
/scriptevent steveo:dungeons tim      # summon a Tim as your companion, no card needed
```

## Troubleshooting

- **Nothing happens on hit, use, or wearing the full set**: the script is
  not running. Check the version triple in the root `CLAUDE.md`.
- **The beam hurts mobs but you cannot see it**, or the blink has no purple
  puff: the resource pack is not rendering. Bump the RP version and
  re-upload; Realm clients cache old packs.
- **The laser shows as a row of bright dots, not a line**: the game did not
  pass the beam's direction to the particle (`variable.dir` /
  `variable.len`), so each stretch collapsed to its starting point. The
  damage is unaffected.
- **Ender Armor worn but no extra hearts**: run `status`. It must be all
  four pieces. The new hearts start empty and fill as you heal.
- **Tim appears but does not follow**: run `status`. If Tim shows as not
  tamed, the game refused the tame; please report it.

## Files

| Path | What it is |
|---|---|
| `behavior_pack/items/` | Firebrand, the four Ender pieces, Corrupted Beacon, Tim's Card |
| `behavior_pack/recipes/` | One recipe per item |
| `behavior_pack/entities/tim.json` | Tim: wild and tamed groups, companion goals, the synced `steveo:dancing` property |
| `resource_pack/attachables/` | How the Ender pieces look when worn |
| `resource_pack/entity/`, `models/`, `animations/`, `render_controllers/` | Tim's model, walk, punch, sit, and dance |
| `resource_pack/particles/` | Laser core and glow, beam impact, fire swipe, ender puff, all tinting one spark texture |
| `resource_pack/textures/` | Item icons, armor layers, Tim's skin, the spark (generated) |
| `resource_pack/texts/en_US.lang` | Every player-facing string |
| `src/firebrand.ts` | The flame arc on each swing, setting targets alight |
| `src/ender_armor.ts` | The set bonus: Health Boost and blink |
| `src/corrupted_beacon.ts` | The beam: aiming, drawing, damage, cooldown |
| `src/tim.ts` | Summoning from the card, dancing, dodging |
| `src/main.ts` | Wiring and the chat commands |

Regenerate the textures and pack icons with
`node addons/minecraft-dungeons/assets/generate.mjs addons/minecraft-dungeons`.
