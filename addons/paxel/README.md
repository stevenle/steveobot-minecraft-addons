# Paxel

A multitool for Minecraft Bedrock in every vanilla tool material. One item
digs like a shovel, chops like an axe, mines like a pickaxe, and hits like a
sword, so a single hotbar slot covers everything but farming.

## Crafting

Three of the material across the top, one more on the middle right, and two
sticks down the middle, on a crafting table:

```
[ G ] [ G ] [ G ]
[   ] [ S ] [ G ]
[   ] [ S ] [   ]
```

`S` is a stick and `G` is the material:

| Paxel | Material |
|---|---|
| Wooden | Any planks |
| Stone | Cobblestone, cobbled deepslate, or blackstone |
| Copper | Copper ingots |
| Iron | Iron ingots |
| Golden | Gold ingots |
| Diamond | Diamonds |
| Netherite | Smithing table: Diamond Paxel + Netherite Upgrade template + netherite ingot |

Each recipe unlocks in the recipe book once you have picked up its material.

## What it does

Every tier matches the vanilla tools of the same material for speed,
durability, attack damage, and enchantability, and mines the same blocks that
material's pickaxe can:

| Paxel | Durability | Speed | Attack | Mines up to |
|---|---|---|---|---|
| Wooden | 59 | 2 | 4 | Coal, copper |
| Stone | 131 | 4 | 5 | Iron, lapis |
| Copper | 190 | 5 | 5 | Iron, lapis |
| Iron | 250 | 6 | 6 | Diamond, gold, emerald, redstone |
| Golden | 32 | 12 | 4 | Coal, copper |
| Diamond | 1561 | 8 | 7 | Obsidian, ancient debris |
| Netherite | 2031 | 9 | 8 | Obsidian, ancient debris |

Each one also:

- Breaks logs, planks, pumpkins, and plants at axe speed, and dirt, sand,
  gravel, grass, and snow at shovel speed.
- Cuts cobwebs and bamboo instantly, like a sword.
- Strips a log when you interact with it, and flattens dirt or grass into a
  path. Sneak while interacting to place blocks against those without
  converting them.
- Repairs on an anvil with its own material, or by combining two of the same
  tier.
- Enchants as a pickaxe: Efficiency, Fortune, Silk Touch, Unbreaking, and
  Mending apply and work on every block the paxel breaks. Sword enchantments
  do not fit; with the Super Enchantments add-on, the fountain offers
  **Keen Edge** instead, which adds Sharpness-style damage to paxels.

Log stripping and path making come from the game's own axe and shovel tool
tags. The script also checks after every interaction and does the conversion
itself if the game did not, so the feature works either way and never fires
twice.

## Debug commands

Chat is the only console a Realm has, so the add-on answers a script event:

```
/scriptevent steveo:paxel give              # a Diamond Paxel
/scriptevent steveo:paxel give netherite    # any tier by name
/scriptevent steveo:paxel give all          # one of each
/scriptevent steveo:paxel status            # the held paxel's durability
```

## Layout

The seven item files, seven recipes, and seven icons are generated from the
tier table in `assets/generate.mjs`. To change a number or add a material,
edit the table, rerun the script, and commit the output:

```
node addons/paxel/assets/generate.mjs addons/paxel
```

| Path | Purpose |
|---|---|
| `behavior_pack/items/<tier>_paxel.json` | The items: digger speeds, damage, durability, tool tags, enchant slot |
| `behavior_pack/recipes/<tier>_paxel.json` | Shaped recipes, plus the netherite smithing recipe |
| `resource_pack/textures/items/<tier>_paxel.png` | 16×16 icons, registered in `textures/item_texture.json` |
| `resource_pack/texts/en_US.lang` | Item names and chat strings |
| `src/main.ts` | Strip/path fallback and the debug command |
| `assets/generate.mjs` | The tier table and the generator |
