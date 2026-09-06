# Freeze Ray Gun

A ray gun that freezes the first mob it hits for a random **8 to 20
seconds**. A frozen mob cannot move, turn, or hurt you in melee, and it
still takes damage, so you can walk away or finish it off. The gun never
freezes players, needs no ammo, and never breaks.

## Crafting

At a crafting table:

```
I I P
S R B
S . .
```

`I` is an iron ingot, `P` packed ice, `S` a stick, `R` redstone dust, and
`B` blue ice.

## Using it

Hold the gun and **use** it (right-click / tap). A frost beam shoots out
along your view up to 32 blocks and freezes the first mob it touches. Your
action bar tells you what was frozen and for how long, then counts down.

| | |
|---|---|
| Range | 32 blocks |
| Freeze | 8 to 20 seconds, rolled per shot |
| Cooldown | 1.5 seconds |
| Players | Never frozen. The ray stops at them and tells you so |

Shooting an already frozen mob rolls a new duration and keeps the longer
one, so a follow-up shot never shortens a freeze. A mob frozen mid-jump
hangs in the air until it thaws.

### What "frozen" means

Bedrock has no freeze effect for mobs, so the gun builds one:

- **Slowness and Weakness** at maximum strength, for the whole freeze.
  Movement speed and melee damage both drop to zero. Because these are
  real status effects, they wear off on their own even if the script is
  reloaded mid-freeze. Nothing stays stuck forever.
- **Every tick, the mob is put back** where it stood, facing the way it
  faced. That is what stops it from turning to track you or sliding away
  from a hit.
- **Frost particles** around the mob, so everyone can see it is frozen.

Two things the freeze does not stop, because vanilla mobs give a script no
handle on them: ranged mobs such as skeletons and blazes can still shoot,
and a creeper you stand next to can still swell. Freezing them still buys
you the distance to get out of range.

## Chat commands

These are script events. Type them in chat with a leading slash. They are
the only way to see what the add-on is doing on a Realm, where there is no
content log.

| Command | What it does |
|---|---|
| `/scriptevent steveo:freeze give` | Puts a Freeze Ray Gun in your inventory. |
| `/scriptevent steveo:freeze status` | Reports how many mobs are frozen and your remaining cooldown. |
| `/scriptevent steveo:freeze thaw` | Releases every frozen mob. |
| `/scriptevent steveo:freeze demo` | Freezes the nearest mob within 8 blocks without a gun, to check the freeze and the particles. |
| `/scriptevent steveo:freeze` | Prints the usage line. |

Messages from the add-on are prefixed `[Freeze Ray]`.

## Troubleshooting

- **Using the gun does nothing, not even a sound**: the script is not
  running. Check the version triple in the root `CLAUDE.md`.
- **The mob freezes but there are no frost particles or beam**: the
  resource pack is not rendering. Run `demo`; if the mob stops but shows
  no frost, bump the RP version in its manifest and re-upload (Realm
  clients cache old packs). The freeze itself comes from the script and
  works regardless.
- **The gun says "Nothing to freeze" while aiming at a mob**: the ray
  stops at the first block, and it ignores anything without health
  (dropped items, arrows). Step to where there is a clear line.
- **A frozen skeleton still shoots me**: expected; see above.
- **Pack icons missing in the Realm's Edit World screen**: expected on
  Realms for every add-on; not a bug in this pack.

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/freezeray_gun.json` | The gun: no durability, 1.5 s cooldown |
| `behavior_pack/recipes/freezeray_gun.json` | The crafting recipe |
| `src/main.ts` | Ray casting, the freeze (effects, per-tick hold, thaw), countdown, hints, chat commands |
| `resource_pack/particles/freeze_beam.json` | The beam, one mote per 0.75 blocks along the ray |
| `resource_pack/particles/frost_burst.json` | The puff of frost when a mob freezes or thaws |
| `resource_pack/particles/frost_aura.json` | Motes drifting off a frozen mob |
| `resource_pack/textures/items/freezeray_gun.png`, `textures/particle/frost.png` | Item icon and the particle texture |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

The icon, particle texture, and pack icon are generated pixel art;
`assets/generate.mjs` regenerates them (run it from the repo root with the
add-on folder as its argument).
