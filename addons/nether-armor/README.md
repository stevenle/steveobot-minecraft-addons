# Nether Armor

A four-piece set forged from blaze rods, blaze powder, and netherrack, in
fiery orange, red, and yellow with a little brown. It is as tough as iron, and
a blaze rod repairs a quarter of a piece's durability on an anvil.

## What it does

- **A few pieces: fire protection.** Each piece you wear stops 25% of the hits
  from fire, lava, magma, and campfires, so one piece stops 25%, two 50%, and
  three 75%.
- **The full set: fire resistance.** You get the real Fire Resistance effect
  while all four pieces are on. It is topped up automatically, survives milk
  and death, and goes away when you take a piece off. A Fire Resistance potion
  you drank yourself is left alone.

## Recipes

`N` is netherrack, `R` a blaze rod, `P` blaze powder, and `.` an empty slot.

```
Helmet     Chestplate   Leggings   Boots

N P N      N . N        R N R      P . N
R . R      R P R        P . P      N . R
           N R N        P . P
```

## Debug

```
/scriptevent steveo:nether_armor give     the full set
/scriptevent steveo:nether_armor status   pieces worn and current protection
```
