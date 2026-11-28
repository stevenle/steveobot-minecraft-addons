# Super Rabbit

Characters, robot minions, crew bosses, and King Viking's 5-floor **Boom Boom Factory** tower inspired by the *Press Start!* (Super Rabbit Boy) book series. Separate from the `power-ups` add-on.

## Mobs

### Animal Town
| Mob | Health | Spawning | What it does |
|---|---|---|---|
| **Singing Dog** | 20 | Plains, forest, meadow (day) & spawn egg | Plays cheerful note-block jingles with music-note particles and gives nearby players brief **Regeneration** and **Speed**. Healable with carrots or bones. |

### King Viking & His Robot Army
Spawn naturally at night on the surface and via spawn eggs in Creative.

| Mob | Health | What it does |
|---|---|---|
| **Viking-Bot** | 18 | Classic blocky steel-and-orange robot minion with glowing red eyes. |
| **Robo-Crab** | 22 | Sturdy armored crab robot with knockback resistance. |
| **Robo-Lizard** | 16 | Fast ambush robot that darts in and spits energy bolts. |
| **Rocket-Robo** | 16 | Hovering jetpack robot with flame particles and thruster hops. |
| **King Viking** | 80 | Spawns rarely at night (and on Floor 5 of the Boom Boom Factory). Shouts *"NO FUN ALLOWED!"*, fires Boom Bolts, and summons Viking-Bot guards. |

### King Viking's Crew Bosses
Harder bosses with boss bars — spawn via Creative spawn eggs or by climbing the **Boom Boom Factory**.

| Boss | Health | Boom Boom Factory Floor | Signature Move |
|---|---|---|---|
| **Robo-Rabbit Boy** | 80 | Floor 1 — Assembly Line | Super fast, dashes and fires twin energy bolts. |
| **Billip** | 90 | Floor 2 — All-Stars Arena | Yellow cube boxer with red boxing gloves (*Super Rabbit All-Stars!*). Hitting a player inflicts **Slowness II** (draining their super speed/power). |
| **Super Rabbit Boss** | 110 | Floor 3 — Shadow Lab | Giant dark corrupted rabbit that leaps and slams a **ground-pound shockwave**. |
| **Mega-Robo** | 130 | Floor 4 — Rocket Forge | Towering factory mech that fires explosive splash rockets (safe for blocks) and summons Viking-Bots below half health. |

## Boom Boom Factory

King Viking's 5-story tower generates rarely in plains, desert, savanna, badlands, and hills chunks (or place one right in front of you with `/scriptevent steveo:super_rabbit factory`).

Each floor has a distinct theme and a glowing **Boss Pad** in the center — walk near it in Survival/Adventure or right-click/tap it to trigger that floor's boss fight:

1. **Floor 1 — Assembly Line:** Conveyor belts, hazard stripes, smelters → **Robo-Rabbit Boy**
2. **Floor 2 — All-Stars Boxing Arena:** Raised red-and-white boxing ring with ropes & spotlights → **Billip**
3. **Floor 3 — Upside-Down Shadow Lab:** Deepslate, amethyst pillars, crying obsidian & magenta consoles → **Super Rabbit Boss**
4. **Floor 4 — Rocket Forge:** Copper pipes, blast furnaces, glass-enclosed lava vats → **Mega-Robo**
5. **Floor 5 — King Viking's Throne Room:** Orange-and-purple carpet, gold-trimmed Viking throne with quartz horns → **King Viking** (+ 2 Viking-Bots)

## Debug Commands

```
/scriptevent steveo:super_rabbit factory            # place the Boom Boom Factory ahead of you
/scriptevent steveo:super_rabbit singing_dog        # spawn Singing Dog
/scriptevent steveo:super_rabbit billip             # spawn Billip
/scriptevent steveo:super_rabbit king_viking        # spawn King Viking
/scriptevent steveo:super_rabbit viking_bot         # spawn Viking-Bot
/scriptevent steveo:super_rabbit robo_crab          # spawn Robo-Crab
/scriptevent steveo:super_rabbit robo_lizard        # spawn Robo-Lizard
/scriptevent steveo:super_rabbit rocket_robo        # spawn Rocket-Robo
/scriptevent steveo:super_rabbit robo_rabbit_boy    # spawn Robo-Rabbit Boy
/scriptevent steveo:super_rabbit super_rabbit_boss  # spawn Super Rabbit Boss
/scriptevent steveo:super_rabbit mega_robo          # spawn Mega-Robo
/scriptevent steveo:super_rabbit status             # nearby mob & bolt counts
```

## Regenerating Assets & Structure

```bash
node addons/super-rabbit/assets/generate.mjs addons/super-rabbit
```
