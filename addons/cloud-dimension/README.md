# Cloud Dimension

A world of floating islands above the clouds, reached through a Cloud Portal.

This first release is the test of the foundations: the dimension, the portal,
the starter island, and the safety net. The rest of the plan (more islands,
the Sky Castle, Floatatoes, the Nimbus King, the Cloud Staff) is tracked in the
repo's `TODO.md`.

## Getting there

Craft a **Cloud Portal**:

```
F W F      F = feather
W G W      W = white wool
F W F      G = glass
```

Place it, then step on it or tap it. The first trip builds the starter island,
which takes a moment. You land on the island next to its own Cloud Portal;
step on that one to go home, back to where you left.

Fall off the edge and you will not die: you drop out of the clouds above where
you left, on Slow Falling.

The island's own portal cannot be broken, so there is always a way home.

## How it works

The dimension is registered with `registerCustomDimension()` at startup and
uses the void generator, so every block in it is placed by the script. Blocks
can only be placed in loaded chunks, so the first trip creates a ticking area
over the island, waits for it to load, builds, and removes it. If ticking areas
fail, it falls back to sending the player up high on Slow Falling and building
once their chunk has loaded.

## Debug

`/scriptevent steveo:clouds <check|go|home|portal|rebuild>`

- `check` reports whether the dimension and blocks registered and whether the
  island has been built. Players also get a chat note on joining if the
  dimension failed to load.
- `go` / `home` travel without a portal.
- `portal` gives you a Cloud Portal.
- `rebuild` builds the starter island again.
