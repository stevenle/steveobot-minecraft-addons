# Battle Arena

A block that starts an arena battle. Place it, use it (right-click or tap),
pick a length, and every player within 24 blocks joins the fight against
escalating waves of mobs, with a boss at the end of each round.

## The block

The Altar of Blades: a stepped stone dais with a gold trim and three swords
driven point-first into a cracked slab on top. While a battle runs, the block
switches to its battle look (the `steveo:active` block state): a ring of
flame tongues burns along the gold trim, the cracks and blade edges glow, the
light rises from 6 to 12, and embers drift up off the trim. It catches with a
whoosh and a clang when a battle starts and goes out when it ends. A block
left lit with no battle behind it (the world reloaded mid-battle) puts itself
out within two seconds of loading.

The hilts reach about 1.4 blocks up, but you only collide with the bottom
block. The flames are decoration: they burn nothing and hurt no one.

## Crafting

```
S G S     S = iron sword
G D G     G = gold ingot
S G S     D = diamond
```

Or `/scriptevent steveo:arena give`.

## How a battle runs

| Mode | Waves | Bosses | Final boss |
|---|---|---|---|
| Quick | 6 (3 per boss) | 2 | The Ravager or Wither Skeleton King |
| Standard | 12 (4 per boss) | 3 | The Ravager or Wither Skeleton King |
| Epic | 20 (4 per boss) | 5 | The Warden |

- **Countdown** before every fight: 10 s before the first wave, 8 s between
  waves, 12 s before a boss. The last three seconds flash on screen. Then
  the fight's title shows, and its mobs spawn 2.5 s later, once the title is
  off the screen.
- **Intermission** after each cleared wave or round: a 6 s pause first, with a
  "Wave cleared!" title naming the top damage dealer. In a multiplayer battle,
  chat gets a damage leaderboard for that wave (or the whole round after a
  boss), and the full-battle leaderboard is posted when the battle ends.
  Everyone nearby gets a few seconds of Regeneration II.
- **Waves** each get a random theme: The Restless Dead (zombies, husks),
  Bone Archers (skeletons, strays, bogged), Illager Raid, Witchcraft
  (witches, breezes), Nether Legion (wither skeletons, blazes), and The Horde
  (a bit of everything). The harder themes unlock as the battle goes on. The
  first wave is always three zombies in leather caps.
- **Gear** rises evenly from the first fight to the last: leather and wood,
  chainmail and stone, iron, diamond, netherite. Each mob rolls its own
  pieces, so a wave looks mismatched rather than uniformed. Later mobs also
  carry Speed, Strength, or Resistance. Waves grow with the battle and add two
  mobs per extra fighter.
- **Bosses** are one big creature each, alone, with a boss bar: giant
  versions of vanilla mobs with their own health. Two per tier, picked at
  random, easiest first:

  | Tier | Boss | Based on | Size | Health | Notes |
  |---|---|---|---|---|---|
  | 1 | Zombie Titan | zombie | 2.5× | 280 | hits for 10 |
  | 1 | The Executioner | vindicator | 2.4× | 280 | swings a giant axe for 13 |
  | 2 | Bone Colossus | skeleton | 2.5× | 250 | rapid slowness arrows |
  | 2 | Iron Tyrant | iron golem | 1.6× | 400 | hits for 10–24, flings you |
  | 3 | Alpha Ravager | ravager | 1.5× | 450 | hits for 16, roars |
  | 3 | Wither King | wither skeleton | 2.2× | 375 | hits for 12 plus Wither |
  | Epic final | The Warden | vanilla | 1× | 500 | |

  The final boss of Quick and Standard is a tier 3 boss. Each extra fighter
  gives the boss more Resistance (I for two players, II for three, III for
  four or more), since
  its health is fixed. All are knockback-proof and fall-proof, and never
  despawn. A boss that vanishes without dying (a Warden digging away) comes
  back. One that cannot spawn at all is skipped with a note in chat.
- **Rewards** drop at the arena block when a boss dies: diamonds, emeralds,
  golden apples, experience bottles. The final boss adds an enchanted golden
  apple, a totem of undying, and netherite (scrap, or an ingot on Epic). The
  mobs' armor and weapons are swept up when they die, so the arena is not a
  free netherite farm.

## How it ends

- **Victory**: the final boss dies.
- **Defeat**: every player who was there at the start has died at least once.
  A fallen player can respawn and keep helping, but they still count as
  fallen. Leaving the game counts as falling.
- **Abandoned**: no fighter within 64 blocks of the block for a minute.

The block cannot be mined while its battle is running, and explosions do not
break it. Mobs spawn on a ring 5 to 9 blocks from the block, so an arena
about 10 blocks in radius holds them. Mobs that wander more than 32 blocks off are pulled back into the
ring, and after 90 s in one fight stragglers are pulled back every 20 s.

Battles live in memory. If the world reloads mid-battle, the battle is gone
and its leftover mobs are removed as they load.

## Debug

```
/scriptevent steveo:arena status              fights, phase, mobs left, fighters
/scriptevent steveo:arena start [quick|standard|epic]   arena block at your feet, start
/scriptevent steveo:arena skip                end the countdown, or clear the fight
/scriptevent steveo:arena boss                jump to the next boss's countdown
/scriptevent steveo:arena summon <boss>       one boss on its own, outside any battle
/scriptevent steveo:arena stop                end the nearest battle
/scriptevent steveo:arena give                one arena block
```

## Notes

- Gear goes on through `replaceitem` commands run on each mob, which work on
  any armor-wearing mob regardless of what the script API's equipment
  component supports.
- The boss entities come from `assets/bosses.mjs`, which patches the vanilla
  entity files in `assets/vanilla/` (Mojang/bedrock-samples, tag
  `v1.26.50.4`). Each keeps its vanilla file's `format_version` and shapes,
  and its client entity is the vanilla one renamed, so it reuses vanilla
  models, textures and animations. To change a boss, edit the script and
  rerun it rather than editing the generated JSON.
- Creepers, piglins, and spiders are left out on purpose: creepers blow up the
  arena, piglins turn into neutral zombified piglins in the Overworld, and
  spiders are neutral by day, any of which could leave a wave unfinishable.
- The block's model, textures and flame flipbook, and the pack icon (a render
  of the lit model), come from `assets/block.mjs`. Edit it and rerun it
  rather than editing the generated files.
