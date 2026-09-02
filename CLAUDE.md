# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

A monorepo of custom Minecraft Bedrock Edition add-ons. Each add-on is a folder
under `addons/<slug>/` containing a behavior pack, an optional resource pack,
and TypeScript sources that are bundled into the behavior pack at build time.
`tools/` holds the build scripts; `shared/` holds TypeScript reused across
add-ons. Everything is TypeScript, the package manager is pnpm, and the target
runtime is Node 24 LTS.

See [README.md](README.md) for user-facing docs, including deployment.

## Commands

```bash
pnpm check                 # validate + typecheck + build — run before committing
pnpm build [<slug>]        # build into dist/
pnpm watch <slug>          # rebuild on change (add --deploy to copy into the game)
pnpm deploy [<slug>]       # build, then copy into Minecraft's dev pack folders
pnpm package [<slug>]      # release-build, then zip .mcaddon into dist/_packages/
pnpm realm <slug> --world <path>  # bake add-ons into a world -> upload-ready .mcworld
pnpm realm <slug> --realm <id>    # same, pulling the world off a live Realm
pnpm test                  # node --test over tools/**/*.test.ts
pnpm validate              # manifest checks
pnpm typecheck             # type-check add-on code and tooling
pnpm new <slug>            # scaffold a new add-on from tools/template
```

Every command defaults to all add-ons and accepts a slug list to narrow it.
pnpm forwards arguments straight through, so do not add npm's `--` separator
(the parser tolerates a stray one, but it is noise).

Use pnpm, never npm — the repo has a `pnpm-lock.yaml` and a pinned
`packageManager`. `corepack enable` installs the right pnpm version.

`pnpm check` is the gate: it is what CI runs, and a change is not done until it
passes. Tests use the built-in `node:test` runner and cover the Realms client
only — everything else is verified by `validate` and `typecheck`. Add tests when
code cannot be exercised by hand, which in practice means the Realms API layer.

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
| `tools/build.ts` | Copy packs, bundle scripts. `buildAddon()` is reused by watch/deploy/package |
| `tools/lib/addons.ts` | Add-on discovery and the descriptor every tool consumes |
| `tools/lib/mojang.ts` | Locating `com.mojang` per platform and target |
| `tools/validate.ts` | Manifest checks — extend this when a new class of mistake bites |
| `tools/realm.ts` | Applies add-ons to a world and writes a `.mcworld` for Realms |
| `tools/lib/world.ts` | Reading/writing Bedrock world folders and their pack lists |
| `tools/lib/realms/` | Client for the undocumented Realms service (auth, REST, types) |
| `tools/template/` | Skeleton for `pnpm new`, with `{{PLACEHOLDER}}` tokens |
| `shared/env.d.ts` | Ambient globals the script runtime provides (`console`) |

## Two TypeScript projects, on purpose

`tools/*.ts` runs on Node via native type stripping — `node tools/build.ts`,
no compile step, no build output for the tooling. Two consequences:

- Relative imports inside `tools/` **must** carry the `.ts` extension
  (`./lib/log.ts`), because that is what Node's loader resolves.
- Only erasable syntax is allowed: no `enum`, no `namespace`, no parameter
  properties. `erasableSyntaxOnly` in `tools/tsconfig.json` enforces this, so
  tsc catches it before Node does.

The two configs are separate because the halves target different runtimes:

| Project | Covers | `types` |
|---|---|---|
| `tsconfig.json` | `addons/*/src`, `shared/` | *(empty)* — Minecraft's engine has no Node globals |
| `tools/tsconfig.json` | build tooling | `node` |

Keeping Node types out of the add-on project is deliberate: it makes a stray
`setTimeout` or `Buffer` in game code a compile error instead of a runtime
failure inside Minecraft. Do not merge the two configs, and do not add `"types":
["node"]` to the add-on project.

`pnpm typecheck` runs both. Shared strictness lives in `tsconfig.base.json`.

## Conventions

- **Slugs** are lowercase with `-` or `_` separators. The slug names the folder,
  the built pack folders (`<slug>_bp`), and the `.mcaddon`.
- **UUIDs** are always generated, never hand-written or copied. `pnpm new`
  does this; if you add a pack by hand use `crypto.randomUUID()`. Every UUID in
  the repo must be unique — `pnpm validate` enforces it.
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

## Realms

Realms has no public API for installing packs. Do not add code that tries to
talk to one, and do not tell the user a Realm can be deployed to directly — the
only supported route is uploading a world that already has the packs applied,
via the client's *Replace World*. `tools/realm.ts` produces that world.

Applying a pack to a world means two things, and both are required: the pack
folder under `behavior_packs/` or `resource_packs/`, **and** an entry in
`world_behavior_packs.json` or `world_resource_packs.json` keyed by the pack's
header UUID. A pack present in only one of the two is silently ignored by the
game. `upsertPackEntry` in `tools/lib/world.ts` matches on `pack_id` so
re-applying updates the entry instead of duplicating it.

`realm.ts` defaults to non-destructive: it stages a copy and writes a new
`.mcworld`. Only `--in-place` touches the user's world folder. Keep it that way
— the destructive counterpart on the Realm side (*Replace World*) is
irreversible without a backup.

## The Realms API layer

`tools/lib/realms/` talks to the undocumented Bedrock Realms service at
`pocket.realms.minecraft.net`. Endpoints and headers were taken from
PrismarineJS/prismarine-realms, the reference implementation — check there
before adding a call, and do not invent endpoints.

**No upload endpoint is known.** No open-source client implements one, and
`PUT /worlds/{id}/backups` only restores a backup Realms itself made. That is
strong evidence, not proof — so the position is "unproven", not "impossible".

`--probe-upload` exists to settle it empirically against a real Realm. It tries
a list of candidate routes and reports exactly what comes back. Two rules:

- **Do not implement an upload flow on a guess.** Uploading means inventing a
  multi-step protocol against a live Realm, where a half-right guess writes to
  someone's world. Implement it only from a real captured response.
- **Probe GET before PUT** for any new candidate. A 404 says the path is absent;
  a 405 proves it exists without invoking it. Calling a real upload endpoint may
  close the Realm and disconnect players, as the Java equivalent does.
- **Keep the controls.** The probe runs a known-good Bedrock route (if it fails,
  the run is inconclusive, not evidence of absence) and the Java download route
  (which shows whether this host serves Java-shaped paths at all). Without them
  a wall of 404s proves nothing.

Descriptions of a Bedrock upload pipeline are usually the **Java** flow
relabelled — the tell is `/worlds/{id}/slot/{slot}/download` for the download
step, which is Java's route, where Bedrock uses
`/archive/download/world/{id}/{slot}/{backupId}`. Check that before believing
one.

Until that lands, uploading is manual via *Replace World*, and docs and CLI
output must not imply otherwise.

Three things constrain changes here:

- **It cannot be tested against the real service.** CI has no Microsoft account,
  and `xboxlive.com` / `pocket.realms.minecraft.net` are firewalled in the dev
  container. `tools/lib/realms/client.test.ts` and `tools/realm.test.ts` drive a
  stand-in HTTP server instead; `REALMS_API_HOST` and `REALMS_AUTHORIZATION`
  exist for that. Extend those tests rather than assuming a change works.
- **prismarine-auth is CommonJS** and assembles `module.exports` with inline
  `require()` calls, which Node's CJS-to-ESM lexer cannot see. `import
  { Authflow } from 'prismarine-auth'` type-checks and then throws at runtime,
  so `auth.ts` goes through `createRequire`. Do not "tidy" that back to a named
  import.
- **`.realms-auth/` holds live Xbox tokens.** It is git-ignored; keep it that
  way, and never log token contents.

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
