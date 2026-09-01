# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

A monorepo of custom Minecraft Bedrock Edition add-ons. Each add-on is a folder
under `addons/<slug>/` containing a behavior pack, an optional resource pack,
and TypeScript sources that are bundled into the behavior pack at build time.
`tools/` holds the Node build scripts; `shared/` holds TypeScript reused across
add-ons.

See [README.md](README.md) for user-facing docs, including deployment.

## Commands

```bash
npm run check                  # validate + typecheck + build — run before committing
npm run build [-- <slug>]      # build into dist/
npm run watch -- <slug>        # rebuild on change (add --deploy to copy into the game)
npm run deploy [-- <slug>]     # build, then copy into Minecraft's dev pack folders
npm run package [-- <slug>]    # release-build, then zip .mcaddon into dist/_packages/
npm run validate               # manifest checks
npm run typecheck              # tsc --noEmit
npm run new -- <slug>          # scaffold a new add-on from tools/template
```

Every command defaults to all add-ons and accepts a slug list to narrow it.
Note npm's `--` separator before any argument.

There is no test suite. `npm run check` is the gate: it is what CI runs, and a
change is not done until it passes.

## Architecture

**The build does three things and nothing more:** it copies `behavior_pack/`
and `resource_pack/` into `dist/<slug>/<slug>_bp` and `<slug>_rp` byte-for-byte,
bundles `src/main.ts` into the behavior pack with esbuild, and stops. There is
no JSON preprocessing or code generation. If a Bedrock doc says to put a file at
a path, put it at exactly that path.

**Manifests are the source of truth** for UUIDs, pack versions, and
`min_engine_version`. `addon.json` carries only build settings (display name,
description, `scriptEntry`, `scriptOut`). Never duplicate manifest fields into
`addon.json`.

**Scripts are bundled, not module-resolved.** `@minecraft/server`,
`@minecraft/server-ui`, and `@minecraft/server-gametest` stay external because
the game provides them; everything else — including `@shared/*` — is inlined
into a single `scripts/main.js`. Add-ons therefore have no runtime dependency on
each other.

Key files:

| File | Role |
|---|---|
| `tools/build.mjs` | Copy packs, bundle scripts. `buildAddon()` is reused by watch/deploy/package |
| `tools/lib/addons.mjs` | Add-on discovery and the descriptor every tool consumes |
| `tools/lib/mojang.mjs` | Locating `com.mojang` per platform and target |
| `tools/validate.mjs` | Manifest checks — extend this when a new class of mistake bites |
| `tools/template/` | Skeleton for `npm run new`, with `{{PLACEHOLDER}}` tokens |
| `shared/env.d.ts` | Ambient globals the script runtime provides (`console`) |

## Conventions

- **Slugs** are lowercase with `-` or `_` separators. The slug names the folder,
  the built pack folders (`<slug>_bp`), and the `.mcaddon`.
- **UUIDs** are always generated, never hand-written or copied. `npm run new`
  does this; if you add a pack by hand use `crypto.randomUUID()`. Every UUID in
  the repo must be unique — `npm run validate` enforces it.
- **Identifiers and script events** use the `steveo:` namespace
  (`/scriptevent steveo:hello`). Always pass a namespace filter to
  `system.afterEvents.scriptEventReceive.subscribe`.
- **Player-facing strings** go in `resource_pack/texts/en_US.lang` and are sent
  as `RawMessage` `{ translate: 'key' }`, not as hardcoded literals. Add new
  languages to `texts/languages.json`.
- **Shared code** goes in `shared/` and is imported as `@shared/log`, not by
  relative path across add-ons. Add-ons never import from each other.
- TypeScript is strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Do not loosen `tsconfig.json` to make an error
  go away.

## Script runtime constraints

The Bedrock script runtime is neither Node nor a browser. There is no
`setTimeout`, no `fetch`, no filesystem, and no npm at runtime. Use
`system.run`, `system.runTimeout`, `system.runInterval`. `console.*` writes to
the game's content log. If you need a global that is genuinely provided by the
runtime and is missing from types, declare it in `shared/env.d.ts` rather than
adding a DOM or Node lib to `tsconfig.json`.

## The version triple

These three must agree, and a mismatch is the most common cause of a script
that loads but does nothing:

1. `@minecraft/server` in `package.json` devDependencies — the typings.
2. The `@minecraft/server` dependency version in `behavior_pack/manifest.json` —
   what the game hands the script at runtime.
3. `min_engine_version` in both manifests — the oldest game build allowed to
   load the pack.

Currently `2.9.0` / `2.9.0` / `[1, 26, 40]`. Bump or lower all three together,
in every add-on. Raising `min_engine_version` above the installed game hides the
pack from the in-game list entirely.

## Gotchas

- `dist/` is generated. Never edit it, and never commit it.
- Adding a behavior pack script module means the manifest `entry` must match
  `addon.json`'s `scriptOut` (default `scripts/main.js`). `validate` checks this.
- A behavior pack that ships a resource pack should declare a dependency on the
  RP's header UUID *and* matching version, so players cannot enable one without
  the other. `validate` checks this too.
- Bedrock reloads development packs on world entry, not live. After deploying,
  re-enter the world.
- Placeholder `pack_icon.png` files are 128×128 and intentionally generic;
  replacing them is a real task, not a nicety.
