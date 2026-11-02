# Blub the Axolotl

A pet axolotl that swims through the air beside you and grows with every fish
until it is big enough to ride.

## Getting a Blub

Craft a **Blub Egg** from an egg, a raw cod, and kelp, then place it. The coat is
rolled when it hatches:

| Coat | Chance |
|---|---|
| Pink | 28% |
| Cyan | 24% |
| Gold | 20% |
| Brown | 20% |
| Blue | 5% |
| Rainbow (colors cycle) | 3% |

Feed it any fish, raw or cooked, and it is yours. Blub cannot be hurt by
anything except the void.

## Growing

| Stage | Fish to reach it |
|---|---|
| Tiny | hatched this way |
| Little | 2 |
| Big | 3 more |
| Huge | 4 more |
| Giant | 5 more (14 in all) |

## Riding

A Giant Blub seats two. Tap it with an empty hand to climb on. Look where you
want to go and hold forward; hold jump to climb. Sneak to hop off. If you get off
in midair you float down on Slow Falling.

Riding speed is `minecraft:flying_speed` in the `steveo:stage_4` group of
`behavior_pack/entities/blub.json`: about 11 blocks per second at the current
0.05, by calculation.

## Other controls

- **Sneak + tap with an empty hand:** stay here, or follow me again.
- **Blub Crown:** craft with seven gold ingots around a prismarine shard (the same
  shape as the Spaniel Crown), then use it on Blub. Shears take it back.
- **Name tag:** rename it. Blub starts out named Blub.

## Debug

`/scriptevent steveo:blub <egg|crown|coats|tame|giant|baby|status|dismiss>`

`giant` is the quick way to test riding: it takes the nearest Blub (or spawns
one), tames it to you, and makes it Giant. `dismiss` is the only way to remove a
Blub, since nothing else can hurt it.
