# Lantern

Adds the **Hand Lantern**. Put it in your off-hand (or hold it in your main
hand) and it lights up the area around you as you walk: caves, the Nether, the
night — the light follows your head at full brightness, like a placed lantern.

## Crafting

A lantern and a piece of string, anywhere on a crafting table (shapeless). The
recipe unlocks in the recipe book once you have picked up a lantern.

## How it works

Bedrock has no moving light sources, so the add-on keeps an invisible
`light_block_15` in the air cell at your head and moves it as you go. It only
ever replaces air and only ever removes its own light blocks, so it never
touches blocks you placed. Underwater (no air at your head or feet) the
lantern gives no light.

Placed lights are recorded in the world. If the world closes or a player logs
off while lit, the leftover light blocks are cleared on the next load, once
their chunks are loaded.

## Checking it is installed

Run `/scriptevent steveo:lantern`. If the add-on is active it puts a Hand
Lantern in your inventory and reports how many lanterns are lit.

## Art

The item and pack icons come from `assets/generate.mjs`:

    node addons/lantern/assets/generate.mjs addons/lantern
