# Uncrafting

The Uncrafting Table breaks a crafted item back down into the ingredients
its crafting recipe used.

## The Uncrafting Table

Craft it from a crafting table surrounded by four iron ingots (one above,
below, left and right):

```
 I
ICI
 I
```

Hold the item you want to take apart and use the table. Using it never uses
the item itself, so armor stays in your hand instead of equipping and food is
not eaten. The menu is a crafting table run backwards: your item on the left,
an arrow, and a 3×3 grid showing the ingredients where a crafting table would
hold them. Below are **Uncraft once** and, when you hold a stack, **Uncraft
all**. The ingredients go into your inventory; anything that does not fit
drops on top of the table. Items cannot be dragged in or out of the grid; it
always shows the item in your hand.

Items that craft in batches have to be uncrafted in the same batches: four
torches give back one coal and one stick, sixteen rails give back six iron
ingots and a stick.

## Rules

- **Wear does not count.** Tools and armor give back their full recipe
  however damaged they are, so a nearly broken diamond pickaxe still returns
  three diamonds and two sticks.
- **Enchantments are lost.** The menu warns before you uncraft an enchanted
  item.
- **Any-wood and any-stone recipes give back the plain one.** A spruce
  pickaxe returns oak planks; a stone sword made from blackstone returns
  cobblestone.
- **Netherite gear** gives back the diamond piece, the netherite ingot, and
  the smithing template.

## What it can uncraft

The Script API cannot read the game's recipe book, so the table knows a
fixed list, written out with their crafting-grid shapes in `RECIPES` in
`src/recipes.ts` and checked against Mojang's `bedrock-samples` recipes:

- Wooden, stone, iron, golden, diamond and netherite swords, pickaxes, axes,
  shovels and hoes
- Leather, iron, golden, diamond and netherite armor
- Storage blocks: iron, gold, diamond, emerald, lapis, redstone, coal,
  copper, netherite, raw iron/gold/copper, hay, slime, bone, dried kelp,
  honey
- Bow, crossbow, shield, mace, fishing rod, flint and steel, shears, brush,
  spyglass, bucket, compass, clock
- Crafting table, chest, furnace, blast furnace, smoker, anvil, cauldron,
  hopper, bookshelf, book, enchanting table, jukebox, beacon
- Piston, sticky piston, TNT, minecart, rail, iron bars
- Torch, lantern, golden apple, golden carrot, eye of ender, stick

Anything else gets "The table does not know how to uncraft ...". To add an
item, add its recipe to `RECIPES` and its icon to `ICONS`.

## The menu layout

Bedrock add-ons cannot open a custom slot-based screen for a block, so the
menu is a script form that `resource_pack/ui/server_form.json` redraws.
It redefines the vanilla `long_form` as a wrapper holding two dialogs: the
vanilla one, copied from Mojang's 1.26.50 `server_form.json`, and the
crafting layout. A form whose title starts with the invisible marker
`§u§n§c§r` gets the crafting layout; every other form, from any add-on,
gets the vanilla one. The button order is the contract between that file
and `src/main.ts` (`SLOT`): 0 is the held item, 1-9 the grid in reading
order, 10 Uncraft once, 11 Uncraft all.

Two things to know:

- Another pack that also redefines `long_form` (some marketplace UI packs
  do) will fight this one; whichever loads last wins.
- If a game update changes the vanilla `long_form`, re-copy its fields from
  `bedrock-samples` into `vanilla_long_form`.

## Debug

```
/scriptevent steveo:uncraft table   # place a table on the block you are looking at
/scriptevent steveo:uncraft check   # confirm every item id in the recipe list exists in this game version
/scriptevent steveo:uncraft held    # show what the held item uncrafts into
```

Run `check` after a game update: a renamed item id breaks only that one
recipe, and on a Realm there is no content log to show it.

## Regenerating art

The block textures and pack icons come from `assets/generate.mjs`:

```
node addons/uncrafting/assets/generate.mjs addons/uncrafting
```
