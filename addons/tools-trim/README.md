# Tools Trim

Armor trims, for tools. The Better Smithing Table adds a colored trim to any
sword, pickaxe, axe, shovel, or hoe, from wood to netherite, using the same
eleven materials as vanilla armor trims. With the Paxel add-on also on, it
trims paxels too.

## The Better Smithing Table

Craft it from a smithing table with a gold ingot above, below, left, and
right:

```
 G
GSG
 G
```

Hold a tool and use the table. A menu lists the trim materials (quartz, iron,
netherite, redstone, copper, gold, emerald, diamond, lapis, amethyst, resin)
with how many of each you carry. Pick one: it takes one of that material and
your tool comes back trimmed. A trimmed tool's menu also offers **Remove
trim**, which is free. Re-trimming with a different material costs one of the
new material. Creative players trim for free.

The trim shows as a binding where the head meets the handle and a wound grip
on digging tools and paxels, and as an inlaid fuller and a colored pommel on
swords. As
with armor, a trim in the tool's own material (gold on a golden pickaxe) uses
the darker shade of that material.

## What carries over

Trimming swaps the tool for a trimmed twin and copies everything across:
enchantments, durability, custom name, lore, and data other add-ons keep on
the item (Super Enchantments' custom enchantments come along). If the trimmed
tool cannot carry one of the enchantments, the table refuses and leaves the
tool alone rather than dropping it.

Trimmed tools match the vanilla tools of the same material for mining speed,
the blocks they can harvest, attack damage, durability, and enchantability.
They also:

- Repair on an anvil with their material, or by combining with the same tool,
  trimmed or not.
- Upgrade from diamond to netherite at a vanilla smithing table (netherite
  upgrade template + netherite ingot), keeping the trim.
- Strip logs (axe), make paths (shovel), and till farmland (hoe). A trimmed
  paxel strips and makes paths.

Trimmed swords enchant in the `melee_spear` slot rather than `sword`: since
spears were added, Looting only goes on items in that slot, and a `sword`-slot
trimmed sword refused to take it from the vanilla sword.

## Why a separate table

Bedrock gives every item type one texture, so a trimmed tool has to be its own
item: `steveo:<tier>_<tool>_<material>_trim`, 462 of them, hidden from the
creative inventory. The vanilla smithing table cannot make them: its base slot
only accepts items tagged `minecraft:transformable_items`, vanilla gives that
tag to diamond tools alone, and an add-on cannot tag vanilla items. The Better
Smithing Table does the swap in a script instead, which also lets it work on
every tier, change a trim, and remove one.

## Debug

```
/scriptevent steveo:tools_trim table                      # place a table on the block you are looking at
/scriptevent steveo:tools_trim give                       # a gold-trimmed diamond pickaxe
/scriptevent steveo:tools_trim give netherite sword lapis # any tier, tool, and material (or "none")
/scriptevent steveo:tools_trim held                       # the held tool's trim, durability, and enchantment count
/scriptevent steveo:tools_trim check                      # confirm every item id exists in this game version
```

## Layout

The items, recipes, icons, table textures, pack icons, and the item-name block
of `en_US.lang` are generated from the tables in `assets/generate.mjs`. To
change a stat or add a material, edit the table (and `src/trims.ts` to match),
rerun the script, and commit the output. Trimmed paxels copy the paxel
add-on's item JSON, names, and icons, so rerun it after regenerating that
add-on too:

```
node addons/tools-trim/assets/generate.mjs addons/tools-trim
```

| Path | Purpose |
|---|---|
| `assets/vanilla/` | Unmodified tool textures, trim palettes, and smithing table textures from Mojang/bedrock-samples v1.26.50.4 |
| `assets/generate.mjs` | Tier, tool, and material tables, trim regions, and the generator |
| `behavior_pack/items/*_trim.json` | The 462 trimmed tools (77 of them paxels) |
| `behavior_pack/recipes/` | The table recipe and the 66 trim-keeping netherite upgrades |
| `behavior_pack/blocks/better_smithing_table.json` | The table block |
| `resource_pack/textures/items/trimmed/` | Trimmed tool icons |
| `resource_pack/texts/en_US.lang` | Chat and menu strings; item names between the generated markers |
| `src/trims.ts` | The same tables for the script, and item id parsing |
| `src/main.ts` | The table menu, the swap, mining wear, strip/path/till fallbacks, and debug |
