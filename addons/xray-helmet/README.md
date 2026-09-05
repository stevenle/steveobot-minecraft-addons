# X-Ray Helmet

A craftable helmet that makes valuable ores glow through solid stone while
you mine. Put it on, head underground, and nearby diamonds, ancient debris,
emeralds, gold, lapis, redstone, iron, and coal light up as colored crystals
you can see through the rock.

## Crafting

At a crafting table:

```
I R I
I G I
```

`I` is an iron ingot, `R` redstone dust, `G` a gold ingot.

The helmet is a real piece of armor: 4 protection, 165 durability, repaired
with gold ingots on an anvil, and it takes helmet enchantments. In creative
it is in the Equipment tab with the other helmets.

## How it works

**Wear it below Y=60.** The helmet only works "in the mines". Above that
height it stays quiet, so it does not clutter your base or the surface. When
you first put it on, a chat message confirms it is active.

**It scans around you every two seconds** and lights up ores within 8 blocks
horizontally and 6 blocks vertically of your head. Each ore gets a glowing
crystal of its own color, drawn on top of everything so it shows through
walls:

| Ore | Includes |
|---|---|
| Diamond | Diamond ore, deepslate diamond ore |
| Ancient debris | Ancient debris |
| Emerald | Emerald ore, deepslate emerald ore |
| Gold | Gold ore, deepslate gold ore, nether gold ore |
| Lapis | Lapis ore, deepslate lapis ore |
| Redstone | Redstone ore, deepslate redstone ore, lit or not |
| Iron | Iron ore, deepslate iron ore |
| Coal | Coal ore, deepslate coal ore |

**At most 16 ores glow at once.** In an ore-rich cave the most valuable ones
win, in the order of the table above, and closer ones beat farther ones. Iron
and coal sit at the bottom of that order, so they never crowd out a diamond.

**The glow follows the ore, not you.** A crystal disappears about six seconds
after its ore leaves your scan range, the moment you mine the block, or as
soon as you take the helmet off. The crystals are harmless marker entities
that cannot be hit or pushed and never affect gameplay.

## Chat commands

Script events. Type them in chat with a leading slash. On a Realm, where
there is no content log, they are the only way to tell which half of the
add-on is misbehaving.

| Command | What it does |
|---|---|
| `/scriptevent steveo:xray` | Spawns one test crystal of each color in the air in front of you (they fade after about six seconds), then runs a scan and reports in chat how many ores it found, your current Y, and the Y limit. Works with or without the helmet on. |

How to read the result:

- **Crystals appear and the scan reports ores**: everything works. If ores
  still do not glow while mining, you are probably above Y=60.
- **Crystals appear but the scan reports 0 ores**: the script and the
  resource pack are fine; there is simply no ore in range.
- **No crystals but a chat reply arrives**: the behavior pack runs but the
  resource pack is not rendering the marker entity. On a Realm this is
  usually a stale cached resource pack; bump the RP version in its manifest
  and re-upload.
- **No reply at all**: the script is not running. Check the version triple
  in the root `CLAUDE.md`.

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/xray_helmet.json` | The helmet item: armor stats, durability, repair, enchantability |
| `behavior_pack/recipes/xray_helmet.json` | The crafting recipe |
| `behavior_pack/entities/ore_marker.json` | The glow marker entity: one color variant per ore, a six-second self-destruct timer |
| `src/main.ts` | Helmet detection, the ore scan, marker lifecycle, the chat command |
| `resource_pack/attachables/xray_helmet.json` | How the helmet looks when worn |
| `resource_pack/entity/ore_marker.entity.json` | Client entity for the marker |
| `resource_pack/materials/entity.material` | The material that draws markers through walls (`depthFunc: Always`, translucent) |
| `resource_pack/models/entity/ore_marker.geo.json` | The crystal model |
| `resource_pack/animations/ore_marker.animation.json` | The spin, bob, and pulse |
| `resource_pack/render_controllers/ore_marker.render_controllers.json` | Picks the marker texture by ore variant |
| `resource_pack/textures/entity/ore_marker_*.png` | One texture per ore color |
| `resource_pack/textures/items/xray_helmet.png`, `textures/models/armor/xray_helmet.png` | Item icon and worn texture |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

## Tuning

The numbers live at the top of `src/main.ts` as named constants: the Y
limit, scan radius and interval, the marker cap, and the ore priority list.
Change them there, run `pnpm check`, and redeploy.
