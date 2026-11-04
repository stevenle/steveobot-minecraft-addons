# Battle Arena

A block that starts an arena battle. Place it, use it (right-click or tap),
pick a length, and every player within 24 blocks joins the fight against
escalating waves of mobs, with a boss at the end of each round.

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
  waves, 12 s before a boss. The last three seconds flash on screen. Everyone
  nearby gets a few seconds of Regeneration II between fights.
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
- **Bosses** wear full kit a tier above the waves, carry Resistance (and often
  Strength and Speed), and bring escorts: Zombie Warlord, Frost Marksman,
  Evoker Archmage, Storm Caller, The Ravager, Wither Skeleton King, The
  Warden. The boss's health shows in the action bar. A boss that vanishes
  without dying (a Warden digging away) comes back.
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
break it. Mobs that wander more than 32 blocks off are pulled back into the
ring, and after 90 s in one fight stragglers are pulled back every 20 s.

Battles live in memory. If the world reloads mid-battle, the battle is gone
and its leftover mobs are removed as they load.

## Debug

```
/scriptevent steveo:arena status              fights, phase, mobs left, fighters
/scriptevent steveo:arena start [quick|standard|epic]   arena block at your feet, start
/scriptevent steveo:arena skip                end the countdown, or clear the fight
/scriptevent steveo:arena boss                jump to the next boss's countdown
/scriptevent steveo:arena stop                end the nearest battle
/scriptevent steveo:arena give                one arena block
```

## Notes

- Gear goes on through `replaceitem` commands run on each mob, which work on
  any armor-wearing mob regardless of what the script API's equipment
  component supports.
- Boss name tags are literal English: name tags cannot be translated.
- Creepers, piglins, and spiders are left out on purpose: creepers blow up the
  arena, piglins turn into neutral zombified piglins in the Overworld, and
  spiders are neutral by day, any of which could leave a wave unfinishable.
- Textures and the pack icon come from `assets/generate.mjs`.
