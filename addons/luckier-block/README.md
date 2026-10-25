# Luckier Block

Adds the **Luckier Block**: a rainbow question block. Break it and roll the dice:

- **62%**: a random item, 1 to 8 of it (1 for anything that doesn't stack).
- **8%**: a jackpot of 3 to 5 random items.
- **30%**: something bad happens.

"Any item" means every item the game knows about, including items from other
add-ons in the world, except ones a survival player can't get: command
blocks, barriers, bedrock, structure blocks, spawners, spawn eggs, light
blocks, technical blocks, Education Edition items, and so on. The list is in
`src/items.ts`. If an illegal item ever drops, add it there.

The bad outcomes: a mob ambush, primed TNT, a lightning strike, a set of
nasty potion effects, getting launched into the air, a cobweb trap with cave
spiders, a silverfish swarm, being set on fire, a creeper right behind you,
evoker fangs, phantoms, dropping the item in your hand, and a fake jackpot of
junk.

Only breaking the block by hand opens it. Luckier Blocks can't be blown up,
so a TNT outcome won't destroy (or open) any others nearby.

## Crafting

8 gold ingots around a dropper (shaped). It's also in the creative inventory
under Construction.

## Checking it is installed

Run `/scriptevent steveo:luckier`. It lists the debug commands: `give` (16
blocks), `lucky`, `jackpot`, `unlucky [name]` to force one outcome, and `items`
to show how big the prize pool is.

## Art

`assets/generate.mjs` draws the block texture and pack icons. The texture is a
flipbook strip, so the rainbow slowly cycles. Regenerate with
`node addons/luckier-block/assets/generate.mjs addons/luckier-block`.
