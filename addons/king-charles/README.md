# King Charles

A Cavalier King Charles Spaniel pet for Minecraft Bedrock. It comes in four
coats, shadows its human everywhere, refuses to leave home or go down a mine,
heals you when you feed it well, and dies if you feed it badly. It never
attacks anything. Its purpose is to love. Optionally, it wears a crown.

## Finding and taming one

Spaniels spawn on grass in plains biomes, alone or in packs of up to three.
In creative there is a **Spawn Cavalier King Charles Spaniel** egg, and the
debug command below can spawn one of each coat in front of you.

Tame one by feeding it any **cooked meat or fish**: cooked beef, chicken,
porkchop, mutton, rabbit, cod, or salmon. Each attempt has a 50% chance.
Spaniels are food-motivated: they beg at anyone holding these foods and will
follow a held piece around.

| Coat | Look | Spawn chance |
|---|---|---|
| Blenheim | White with chestnut patches, chestnut ears, a lozenge spot on the head | 40% |
| Tricolor | White with black patches and tan cheeks and eyebrows | 25% |
| Black and tan | Black with tan muzzle, chest, eyebrows, lower legs, and ear feathers | 15% |
| Ruby | Solid rich red | 20% |

## How it behaves

**It follows you like a shadow.** A tamed spaniel starts moving when you are
three blocks away and stops at arm's length. If it falls behind it teleports
to catch up. Interact with an empty hand to make it sit and stay; interact
again to release it. When it is at your side it occasionally shows a heart.

**It will not leave home.** A tamed spaniel adopts the nearest bed within
12 blocks as its home and remembers it. It follows you up to 32 blocks from
that bed. Past that it stops, trots or teleports back to the bed, and tells
you in chat. It comes bounding back as soon as you return within range. If
it has never seen a bed it simply follows you anywhere, and adopts the first
bed it finds.

To move house, **put it on a lead**. A leashed spaniel forgets its old bed
and adopts a new one wherever you take the lead off. Picking up its bed also
clears its home.

**It will not go into the mines.** If you drop below **Y=50** the spaniel
stays behind at its bed and waits. If your bed is itself underground, the
line is eight blocks below the bed instead, so an underground base works.

**It heals its human.** Feed a tamed spaniel cooked meat or fish and it heals
itself and, if you are its owner, refills all of your hearts. Feeding
someone else's spaniel only makes it happy.

**Bad food kills it.** Rotten flesh, spider eyes, poisonous potatoes, or
pufferfish make any spaniel sick. It slows down, droops, glows green with
poison, and dies 30 seconds later. Good food cannot cure it. Don't.

**It is afraid of monsters** and runs from anything hostile within eight
blocks, and it panics when hurt. It cannot fight back.

## The crown

Craft a **Spaniel Crown** at a crafting table:

```
G _ G
G E G
G G G
```

`G` is a gold ingot, `E` an emerald, `_` empty.

- **Use the crown on a spaniel** to crown it.
- **Sneak and interact with an empty hand** on a crowned spaniel to take the
  crown back. Interacting without sneaking still toggles sit.
- A crowned spaniel that dies drops its crown.

## Chat commands

These are script events. Type them in chat with a leading slash. They are
the only way to see what the add-on is doing on a Realm, where there is no
content log.

| Command | What it does |
|---|---|
| `/scriptevent steveo:dog spawn` | Spawns one wild spaniel of each coat in front of you, left to right: blenheim, tricolor, black and tan, ruby. |
| `/scriptevent steveo:dog tame` | Tames every wild spaniel within 8 blocks to you, skipping the 50% chance. |
| `/scriptevent steveo:dog status` | Lists every spaniel you own in your dimension: its state (following, homebound, or sick), whether it is crowned, its home bed and how far it is from it, and how far it is from you. |
| `/scriptevent steveo:dog crown` | Puts a Spaniel Crown in your inventory. |
| `/scriptevent steveo:dog` | Prints the usage line. |

Chat messages from the add-on are prefixed `[King Charles]`. A named
spaniel is referred to by its name tag; an unnamed one as "Your spaniel".

## Troubleshooting

- **Spaniel visible but nothing happens on feeding, no chat messages**: the
  script is not running. Check the version triple in the root `CLAUDE.md`.
- **Nothing visible at all, but `status` reports dogs**: the resource pack
  is not rendering. On a Realm this usually means the client cached an
  older resource pack; bump the RP version in its manifest and re-upload.
- **"Only heals its own human" for your own dog**: the dog was tamed by a
  pack version before 1.0.1. Spawn and tame a fresh one.
- **It stays behind unexpectedly**: run `status` and look at the home bed.
  It is probably a bed you did not think of, such as one in a village you
  passed through. Lead it away to reset.
- **Pack icons missing in the Realm's Edit World screen**: expected on
  Realms for every add-on; not a bug in this pack.

## Files

| Path | Role |
|---|---|
| `behavior_pack/entities/king_charles.json` | The dog: coats, taming, behaviors, component groups for following, homebound, sick, and crowned |
| `behavior_pack/spawn_rules/king_charles.json` | Natural spawning in plains |
| `behavior_pack/items/dog_crown.json`, `recipes/dog_crown.json` | The crown item and its recipe |
| `behavior_pack/loot_tables/entities/dog_crown.json` | Drops the crown on death |
| `src/main.ts` | Home tracking, follow/stay decisions, feeding, sickness death, crown, chat commands |
| `resource_pack/entity/king_charles.entity.json` | Client entity: textures, animations, spawn egg |
| `resource_pack/models/entity/king_charles.geo.json` | Custom dog model with a crown bone |
| `resource_pack/animations/king_charles.animation.json` | Walk, look, tail wag, sit, beg head tilt, sick droop |
| `resource_pack/render_controllers/king_charles.render_controllers.json` | Picks the coat texture by variant, shows the crown by skin id |
| `resource_pack/textures/entity/king_charles/*.png` | The four coats |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

The model, coat textures, item icon, and pack icon are generated pixel art;
`assets/generate.mjs` regenerates them (run it from the repo root with the
add-on folder as its argument).
