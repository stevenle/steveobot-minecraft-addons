# Golden Snitch

A tiny winged gold ball for Minecraft Bedrock. Release it in the Nether and
it flies off to find the nearest nether fortress, trailing fire behind it.
Tap it to catch it again.

## Crafting

At a crafting table:

```
F . F
. G .
. . .
```

`F` is a feather, `G` a block of gold, `.` empty.

## Using it

Hold the snitch and **use** it (right-click / tap) while in the Nether. It
pops out of your hand and starts circling you while it searches. Outside
the Nether it stays in your hand and tells you so in the action bar.

| Phase | What you see |
|---|---|
| **Searching** | Circles you, flickering fire. It keeps looking as you explore. |
| **Found** | A burst of flame and a chat line with the distance. Then it flies straight at the fortress, leaving a trail of fire. |
| **Returning** | If you fall more than 24 blocks behind, it turns around and comes back to you before setting off again. |
| **Arrived** | It circles above the fortress until someone catches it. |

The snitch flies in a straight line and passes through anything. Follow its
trail and dig where you have to; the fortress is where the fire leads.

**Catching it.** Tap or hit the snitch and it goes back into your inventory,
or drops at your feet if your inventory is full. Anyone can catch it, not
just whoever released it.

### How it finds fortresses, and how far it can see

Bedrock's Script API has no way to locate a structure, so the snitch does
what you would do: it looks for nether brick. Fortresses are the only
natural source of it. The snitch scans the loaded chunks around you for
nether brick and flies to the nearest piece it finds.

That means its reach is the game's loaded-chunk range around you, which
depends on the server. It is a few chunks on a Realm and up to your render
distance in a local world. When nothing is in range, the snitch says how far
it could see and keeps rescanning as you move, so leave it loose and keep
exploring. The moment a fortress comes into range it darts off.

Player-built nether brick counts as a fortress, so the snitch will also
lead you to your own nether brick house.

**Snitches persist.** One that gets unloaded mid-flight picks up where it
left off when the chunk loads again. If its owner logs out it hovers in
place until they return, or until someone catches it. A snitch the script
has lost track of fades on its own after 60 seconds instead of lingering
forever.

## Chat commands

These are script events. Type them in chat with a leading slash. They are
the only way to see what the add-on is doing on a Realm, where there is no
content log.

| Command | What it does |
|---|---|
| `/scriptevent steveo:snitch give` | Puts a Golden Snitch in your inventory. |
| `/scriptevent steveo:snitch status` | Lists your snitches: phase, position, and distance to target. |
| `/scriptevent steveo:snitch scan` | Runs the fortress scan from where you stand, in any dimension, and reports how many chunks were loaded, how far it reached, and the nearest nether brick. |
| `/scriptevent steveo:snitch recall` | Catches all of your loaded snitches back into your inventory. |
| `/scriptevent steveo:snitch demo` | Spawns a snitch that circles you for 30 seconds without searching, to check rendering. |
| `/scriptevent steveo:snitch` | Prints the usage line. |

Messages from the add-on are prefixed `[Golden Snitch]`.

## Troubleshooting

- **Nothing happens on use, no action-bar text**: the script is not
  running. Check the version triple in the root `CLAUDE.md`.
- **It says it is released but you cannot see it**: the resource pack is
  not rendering. Run `demo`; if that is invisible too, bump the RP version
  in its manifest and re-upload (Realm clients cache old packs). The fire
  trail is a vanilla particle and shows either way.
- **It never finds anything**: run `scan` and read the reach. On a Realm
  the loaded range is small, so you may need to be within a hundred blocks
  or so of a fortress. Place a nether brick nearby and `scan` again to
  confirm the scan itself works.
- **It flew into a wall and stopped**: it is waiting for you. Get within
  24 blocks and it will carry on.
- **Pack icons missing in the Realm's Edit World screen**: expected on
  Realms for every add-on; not a bug in this pack.

## Files

| Path | Role |
|---|---|
| `behavior_pack/items/golden_snitch.json`, `recipes/golden_snitch.json` | The snitch item and its recipe |
| `behavior_pack/entities/snitch.json` | The flying snitch: no gravity, no collision, damage-immune, 60 s self-destruct fuse |
| `src/main.ts` | Fortress scan, flight phases, catching, persistence, chat commands |
| `resource_pack/entity/snitch.entity.json` | Client entity: texture, material, flutter animation |
| `resource_pack/models/entity/snitch.geo.json` | Three overlapping cubes for a rounded ball, plus two wing planes |
| `resource_pack/animations/snitch.animation.json` | Wing flutter and body bob |
| `resource_pack/render_controllers/snitch.render_controllers.json` | Plain single-texture controller |
| `resource_pack/textures/entity/snitch.png` | Ball faces and both wings |
| `resource_pack/textures/items/golden_snitch.png` | Item icon |
| `resource_pack/texts/en_US.lang` | Every player-facing string |

The textures and pack icon are generated pixel art; `assets/generate.mjs`
regenerates them (run it from the repo root with the add-on folder as its
argument).
