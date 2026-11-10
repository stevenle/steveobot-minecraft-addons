# Rabbit Boy Power-Ups

Power-up items inspired by the book *Super Rabbit Boy Powers Up!*. Hold
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
| Water Diamond | Breathe underwater, puts you out if you catch fire | Shoot a water jet, 24 blocks: pushes mobs back and puts out fires (0.6 s) | Diamond, blue dye |
| Light Square | You sparkle and light up the area around you; monsters within 4 blocks catch fire | | Glowstone, gold ingot |
| Fire Triangle | Fire resistance | Shoot a fire bolt, 24 blocks (0.5 s) | Fire charge, redstone |
| Super Power Up | Carrot, Boots, Pepper, Shell and Fist powers at once, plus sparkles | Shockwave: throws mobs within 8 blocks (20 s) | All seven other power-ups |

Ground pound and shockwave push every mob but only damage monsters, and never
touch other players. The fire bolt sets what it hits on fire but does not
light blocks. The Super Power Up leaves out slow falling and invisibility on
purpose.

The Light Square's light is the Hand Lantern's trick (`@shared/light`): an
invisible light block that follows your head, so it gives no light underwater.
The Super Power Up does not include the three shape power-ups.

The Ghost Radish is the vanilla invisibility effect: mobs notice you from much
closer than usual, but armor you wear still shows and a mob right next to you
can still attack.

## Checking it is installed

Run `/scriptevent steveo:power_ups`. If the add-on is active it puts every
power-up in your inventory and reports how many players are powered up.

## Art

The item and pack icons come from `assets/generate.mjs`:

    node addons/power-ups/assets/generate.mjs addons/power-ups
