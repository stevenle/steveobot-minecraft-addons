# Cloud Dimension

A world of floating islands above the clouds. Hop along the islands on Gust
Pads to the Sky Castle, find the Floatatoes, and call the Nimbus King. Beat
him for the Cloud Staff.

## Getting there

Craft a **Cloud Portal**:

```
F W F      F = feather
W G W      W = white wool
F W F      G = glass
```

Place it, then step on it or tap it. You land on the starter island next to
its own Cloud Portal; step on that one to go home, back to where you left. The
island's portal cannot be broken, so there is always a way home.

Fall off any island and you will not die: you drop out of the clouds above
where you left, on Slow Falling.

## The islands

Look where you want to go and step on a **Gust Pad** to be launched toward the
next island (with a little Slow Falling for the landing). Five islands lead
from the starter island to the Sky Castle. The islands and the castle are built
the first time someone visits after installing this version; it takes a minute
or so, and chat says when the castle has appeared.

## The Sky Castle

- **Charges** (small breezes, 10, 15, 20 or 25 health) guard the courtyard.
  More turn up while players are near. They drop breeze rods.
- Each **corner tower** has a chest. The back-left one holds a **Storm Crystal**.
- Climb the stairs inside the keep to the **throne room** on its roof.
- Behind the throne, in a glass case, are four **Floatatoes**.

## Floatatoes

Flying potatoes, found only in the castle's glass case. Break the glass (it is
normal glass) and tap one with a potato or baked potato to tame it. One in ten
is golden. A tamed Floatato follows you, comes along through Cloud Portals,
and catches you when you fall (Slow Falling). They cannot be hurt.

## The Nimbus King

Hold a Storm Crystal and tap the **Storm Altar** on the throne-room roof. The
Nimbus King is a giant cloud-white breeze with 1500 health and a boss bar. He
fires wind charges on his own, plus volleys of 3 (5 once he is below half
health), and summons 2 to 4 Charges every 15 seconds. He cannot leave the
roof. When he is beaten he drops the **Cloud Staff**, diamonds, golden apples
and breeze rods, and his Charges vanish.

More Storm Crystals can be crafted (a diamond in the middle, glass on the
sides, feathers in the corners), so he can be fought again.

## The Cloud Staff

Use it to fire a wind charge, which pushes mobs back and hits for extra damage.
It rests for 3 seconds between shots and never breaks. Fire it at your feet to
launch yourself.

## How it works

The dimension is registered with `registerCustomDimension()` at startup and
uses the void generator, so every block in it is placed by the script, from the
plans in `src/layout.ts`. `src/build.ts` splits each plan into 32x32 tiles,
loads each with a ticking area, places it and releases it; finished tiles are
saved in a world dynamic property, so a restart resumes and nothing (mobs
included) is placed twice. If ticking areas fail, tiles are built whenever a
player happens to have them loaded.

The Nimbus King and the Charge are generated from the vanilla breeze by
`assets/entities.mjs` (see that file), keeping its format version and
component shapes, with their own copies of the breeze render controllers. The
Floatato's components follow Blub's, which load at the same format version.
Textures come from `assets/generate.mjs`.

## Debug

`/scriptevent steveo:clouds <command>`

| Command | Does |
|---|---|
| `check` | Whether the dimension, blocks and entities loaded, and what is built. Players also get a chat note on joining if something failed to load. |
| `go` / `home` | Travel without a portal. |
| `castle` / `arena` | Teleport to the castle gate or the throne room. |
| `build` | Finish building now. |
| `rebuild [start\|start_pad\|chain\|castle]` | Build a section again (the castle's mobs are spawned again too). |
| `boss` | Call the Nimbus King without a crystal. |
| `floatato [golden]` | Spawn a Floatato next to you. |
| `floatatoes` | Count the Floatatoes in the glass case. |
| `padpower [forward up]` | Show or set the Gust Pad launch strength (default 1.5 and 1.1). |
| `portal`, `pad`, `crystal`, `staff` | Give yourself one. |
