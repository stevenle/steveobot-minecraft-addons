# Extra Hearts

Heart Ore, Heart Fragments, and Heart Containers for Minecraft Bedrock, in
the spirit of Zelda's heart pieces. Mine the ore, gather fragments, craft
them into a Heart Container, and eat it for a permanent extra heart. You can
grow from the usual 10 hearts up to 30.

## Heart Ore

Heart Ore generates underground in every Overworld biome, from Y -58 up to
Y 24, about as common as iron in that band. Like vanilla ores it comes in
two looks that match the rock around it: grey stone flecked with red in
stone, granite, diorite and andesite, and a darker Deepslate Heart Ore in
deepslate and tuff. Both give off a faint glow, so they are easy to spot in
a dark cave, and both drop the same fragments.

It needs an **iron pickaxe or better**. Breaking it with anything else drops
nothing and the ore is gone, so bring the right tool. Each block drops 1–2
Heart Fragments plus a little experience; Fortune adds up to its level in
extra fragments, and Silk Touch drops the ore block itself.

Ore only appears in chunks generated **after** the add-on is installed. Land
you have already explored will not sprout any. To fill in old ground, stand
in it and run the seed command:

```
/scriptevent steveo:hearts seed        # the 5x5 chunks around you
/scriptevent steveo:hearts seed 4      # the 9x9 chunks around you (the max)
```

It places random veins in stone at the same depths and about the same rate
as world generation, in the chunks that are currently loaded around you,
and reports what it placed. Unloaded chunks are skipped, so on a Realm with
a small simulation distance a big radius will say so; walk on and run it
again. Running it twice in the same place adds ore twice.

## Crafting

At a crafting table, five Heart Fragments in a heart shape:

```
F _ F
F F F
_ F _
```

`F` is a Heart Fragment, `_` empty. The result is one Heart Container.

## Eating a Heart Container

Hold it and use it like food. It takes a moment to eat, then you gain one
heart, your health refills, and a chime plays. Hearts are permanent: they
survive death, logging out, and Realm uploads. At 30 hearts the container
refuses to be eaten, so nothing is wasted.

The extra hearts show as additional rows above the hunger bar, the same way
Health Boost does, but there is no potion effect involved and milk does not
remove them.

## Debug commands

Chat is the only console on a Realm, so the add-on answers to a script event:

```
/scriptevent steveo:hearts give      # 10 Heart Fragments and a Heart Container
/scriptevent steveo:hearts status    # your heart count and current health
/scriptevent steveo:hearts set 25    # jump straight to a heart count (10–30)
/scriptevent steveo:hearts reset     # back to 10 hearts
/scriptevent steveo:hearts ore       # turn the block you are looking at into Heart Ore
/scriptevent steveo:hearts seed 2    # seed random veins into the loaded chunks around you
```

## How it works

Bedrock scripts cannot set a player's maximum health, so the behavior pack
ships its own copy of the vanilla `minecraft:player` entity with one
component group per heart count (`steveo:hearts_11` through
`steveo:hearts_30`), each overriding `minecraft:health`. The script stores
your bonus hearts in a player dynamic property and triggers the matching
event on spawn, after eating, and in a sweep every five seconds in case the
game dropped the group.

Because the pack replaces `player.json`, it will conflict with any other
pack that also overrides the player entity. The vanilla copy in
`assets/vanilla/player.json` is from Mojang's `bedrock-samples`
v1.26.50.4; when the game updates, refresh that file and rerun the
generator.

## Files

| Path | What it is |
|---|---|
| `behavior_pack/blocks/heart_ore.json`, `deepslate_heart_ore.json` | The two ore blocks: texture, hardness, empty loot table |
| `behavior_pack/features/` and `feature_rules/` | Underground ore generation |
| `behavior_pack/items/` | Heart Fragment and Heart Container |
| `behavior_pack/recipes/heart_container.json` | The heart-shaped recipe |
| `behavior_pack/entities/player.json` | Vanilla player plus the heart component groups (generated) |
| `resource_pack/textures/` | Item icons and the ore texture (generated) |
| `resource_pack/texts/en_US.lang` | Every player-facing string |
| `src/main.ts` | Drops, eating, the heart count, and the debug command |

Regenerate the icons, textures, and `player.json` with
`node addons/extra-hearts/assets/generate.mjs addons/extra-hearts`.
