# Rabbit Boy Power-Ups

Eight power-up items inspired by the book *Super Rabbit Boy Powers Up!*. Hold
one in your main hand or your off-hand and you get its power; hold two
different ones to combine them. The power fades about a second after you put
the item away.

| Item | While held | Use (right-click / tap, main hand) | Recipe (shapeless) |
|---|---|---|---|
| Super Carrot | Run fast, jump high | | Carrot, gold ingot, sugar |
| Bounce Boots Charm | No fall damage | Launch straight up (2 s cooldown) | Leather boots, slimeball |
| Fire Pepper | Fire resistance | Shoot a fire bolt, 24 blocks (0.75 s) | Blaze powder, red dye |
| Bubble Shell | Breathe underwater, swim fast | | Pufferfish, glass |
| Rock Fist | Strength, resistance, hits knock mobs back | Ground pound: throws mobs within 5 blocks (4 s) | 4 cobblestone, iron ingot |
| Feather Cape Token | Slow falling | Dash forward (2 s) | Feather, gold ingot |
| Ghost Radish | Invisibility | | Beetroot, fermented spider eye |
| Super Power Up | Carrot, Boots, Pepper, Shell and Fist powers at once, plus sparkles | Shockwave: throws mobs within 8 blocks (20 s) | All seven other power-ups |

Ground pound and shockwave push every mob but only damage monsters, and never
touch other players. The fire bolt sets what it hits on fire but does not
light blocks. The Super Power Up leaves out slow falling and invisibility on
purpose.

The Ghost Radish is the vanilla invisibility effect: mobs notice you from much
closer than usual, but armor you wear still shows and a mob right next to you
can still attack.

## Checking it is installed

Run `/scriptevent steveo:power_ups`. If the add-on is active it puts all eight
power-ups in your inventory and reports how many players are powered up.

## Art

The item and pack icons come from `assets/generate.mjs`:

    node addons/power-ups/assets/generate.mjs addons/power-ups
