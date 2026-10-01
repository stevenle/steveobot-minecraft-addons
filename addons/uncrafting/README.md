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
not eaten. A menu shows what one uncraft gives back, with a button to uncraft
once and, when you hold a stack, another to uncraft the whole stack. The
ingredients go into your inventory; anything that does not fit drops on top
of the table.

Items that craft in batches have to be uncrafted in the same batches: four
torches give back one coal and one stick, sixteen rails give back six iron
ingots and a stick.

## Rules

- **Wear counts.** Damaged tools and armor give back ingredients in
  proportion to the durability left, rounded down. A half-worn diamond
  pickaxe returns one diamond and one stick; a badly worn one may return
  nothing, and the table says so instead of eating it.
- **Enchantments are lost.** The menu warns before you uncraft an enchanted
  item.
- **Any-wood and any-stone recipes give back the plain one.** A spruce
  pickaxe returns oak planks; a stone sword made from blackstone returns
  cobblestone.
- **Netherite gear** gives back the diamond piece, the netherite ingot, and
  the smithing template.

## What it can uncraft

The Script API cannot read the game's recipe book, so the table knows a
fixed list, written out in `RECIPES` in `src/main.ts`:

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
item, add a line to `RECIPES`.

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
