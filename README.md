# steveobot-minecraft-addons

A monorepo for a series of custom **Minecraft Bedrock Edition** add-ons.

Each add-on lives in its own folder under [`addons/`](addons) and is built,
validated, deployed, and packaged by a small set of Node scripts in
[`tools/`](tools). Behaviour is written in TypeScript against the
[`@minecraft/server` Script API](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/)
and bundled into each behavior pack at build time.

The goal is that adding the tenth add-on is exactly as cheap as adding the
first: one command to scaffold it, one command to get it into the game.

## Requirements

| | |
|---|---|
| **Node.js** | 20 or newer (22 recommended) |
| **Minecraft Bedrock Edition** | 1.26.40 or newer, for the `@minecraft/server` 2.9.0 script module |
| **Editor** | Anything; VS Code plus the Blockception *Minecraft Bedrock Development* extension is a good pairing |

Deploying straight into the game needs a local Bedrock install — Windows,
Minecraft Preview, or Minecraft Education. On macOS and Linux you can still
build, validate, and package `.mcaddon` files; see
[Deploying](#deploying) for the options there.

## Quick start

```bash
npm install                    # once
npm run deploy -- hello-world  # build + copy into Minecraft's dev pack folders
```

Then in Minecraft: create or edit a world → **Behavior Packs** → **My Packs** →
activate **Hello World BP**. The resource pack is pulled in automatically
because the behavior pack depends on it. Join the world and you should be
greeted in chat; run `/scriptevent steveo:hello` and the add-on answers.

While iterating, leave a watcher running:

```bash
npm run watch -- hello-world --deploy
```

Every save rebuilds and re-copies the pack. Re-enter the world to load the
change — Bedrock reloads development packs on world entry.

## Repository layout

```
addons/                  One folder per add-on; this is where you work.
  hello-world/
    addon.json             Build config (display name, description, entry points).
    src/                   TypeScript sources. Entry point: src/main.ts.
    behavior_pack/         Server-side content: manifest, entities, items, recipes,
                           loot tables, functions. Copied verbatim into the build.
    resource_pack/         Client-side content: manifest, textures, models, sounds,
                           UI, texts. Copied verbatim into the build.
shared/                  TypeScript shared by every add-on, imported as `@shared/*`.
tools/                   Build, validate, deploy, package, and scaffold scripts.
  template/                Skeleton copied by `npm run new`.
dist/                    Build output (git-ignored).
  <slug>/<slug>_bp/        Built behavior pack — the folder Minecraft loads.
  <slug>/<slug>_rp/        Built resource pack.
  _packages/               Distributable .mcaddon / .mcpack files.
```

Two rules keep this predictable:

- **Pack folders are copied byte-for-byte.** Whatever you put in
  `behavior_pack/` is what the game sees. There is no JSON preprocessing, so
  anything you can look up in the Bedrock docs works unchanged.
- **Manifests are the source of truth** for UUIDs, pack versions, and
  `min_engine_version`. `addon.json` only carries build settings.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Build every add-on into `dist/` |
| `npm run build:release` | Same, with the script bundle minified |
| `npm run watch` | Rebuild on change; add `--deploy` to also copy into the game |
| `npm run deploy` | Build, then copy into Minecraft's development pack folders |
| `npm run package` | Release-build, then zip `.mcaddon` files into `dist/_packages/` |
| `npm run validate` | Static checks over every manifest (see below) |
| `npm run typecheck` | `tsc --noEmit` across all add-ons and shared code |
| `npm run check` | validate + typecheck + build — what CI runs |
| `npm run new -- <slug>` | Scaffold a new add-on |
| `npm run clean` | Delete `dist/` |

Every command takes an optional list of add-on slugs and operates on all of
them when you pass none. Remember npm's `--` separator:

```bash
npm run build -- hello-world
npm run deploy -- hello-world --target preview
npm run package -- hello-world --mcpack   # also emit standalone .mcpack files
```

`npm run validate` catches the mistakes that make a pack silently fail to
appear in-game: malformed or duplicate UUIDs, a bad `min_engine_version`, a
missing script module, a script `entry` that does not match what the build
writes, and a behavior pack whose resource-pack dependency points at the wrong
UUID or version.

## Deploying

### Development deploy (the fast loop)

`npm run deploy` copies each built pack into Minecraft's `com.mojang` data
folder, under `development_behavior_packs/` and `development_resource_packs/`.
Packs in those folders are re-read every time you enter a world, so there is no
import step and no version bumping while you iterate.

```bash
npm run deploy                                  # every add-on, release Minecraft
npm run deploy -- hello-world                   # just one
npm run deploy -- --target preview              # Minecraft Preview
npm run deploy -- --target education            # Minecraft Education
npm run deploy -- --dir "/path/to/com.mojang"   # explicit location
```

The `com.mojang` folder is found automatically. In resolution order:

1. the `--dir` flag,
2. the `MINECRAFT_COM_MOJANG` environment variable,
3. the standard location for the chosen `--target`:

| Target | Location |
|---|---|
| `stable` (Windows) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang` |
| `preview` (Windows) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\LocalState\games\com.mojang` |
| `education` (Windows) | `%APPDATA%\Minecraft Education Edition\games\com.mojang` |
| WSL | the same paths under `/mnt/c/Users/<you>/…`, detected automatically |
| Linux/macOS launcher | `~/.local/share/mcpelauncher/games/com.mojang` |

If detection fails, the error lists every path it checked. Point it at the
right one:

```bash
export MINECRAFT_COM_MOJANG="/mnt/c/Users/you/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang"
```

Then, in Minecraft:

1. **Play → Create New World** (or edit an existing one).
2. **Behavior Packs → My Packs** → activate the add-on's BP. Bedrock will offer
   to activate the matching resource pack; accept it, or activate it yourself
   under **Resource Packs**.
3. Nothing to toggle under **Experiments** — this repo targets the *stable*
   `@minecraft/server` module. Only turn on **Beta APIs** if you deliberately
   depend on a `-beta` script module.
4. To see `console.log` output and script errors, enable **Settings → Creator →
   Content Log GUI** (and **Content Log File** if you want it on disk).

Deploy replaces the destination folder rather than merging into it, so files
you delete locally also disappear from the game's copy.

### Sharing a build

```bash
npm run package
# -> dist/_packages/hello-world-v1.0.0.mcaddon
```

A `.mcaddon` is a zip containing every pack in the add-on. Opening one imports
it into Minecraft on Windows, Android, and iOS; the packs then show up in
**My Packs** for any world. This is the file to hand to other players, attach
to a release, or upload to a pack site. `--mcpack` additionally writes one
`.mcpack` per pack, for the rarer case where someone wants only the behavior or
only the resource pack.

Version numbers in the filename come from the behavior pack manifest's
`header.version`, so bump that before cutting a release. CI builds these on
every push and uploads them as workflow artifacts.

Consoles cannot sideload packs. To play an add-on there, apply it to a world
and upload that world to a Realm, or import the world on a device that can.

### Bedrock Dedicated Server

BDS reads packs from its own `behavior_packs/` and `resource_packs/` folders
and activates them per world:

```bash
npm run build:release -- hello-world
cp -r dist/hello-world/hello-world_bp /path/to/bds/behavior_packs/
cp -r dist/hello-world/hello-world_rp /path/to/bds/resource_packs/
```

Then add the pack UUID and version (from its `manifest.json` header) to
`worlds/<world name>/world_behavior_packs.json` and
`world_resource_packs.json`:

```json
[{ "pack_id": "2bdba555-b0e4-4044-af7f-f9fe3cca6a20", "version": [1, 0, 0] }]
```

Restart the server to load them.

## Creating a new add-on

```bash
npm run new -- frost-walker --description "Freezes the water you walk on."
```

This copies `tools/template/` into `addons/frost-walker/` and generates fresh
UUIDs for all five manifest identifiers, so the new packs can never collide
with an existing one. Useful flags: `--name "Display Name"`,
`--no-resource-pack`, `--no-scripts`.

Afterwards:

1. Replace the placeholder `pack_icon.png` in each pack (128×128 PNG).
2. Write your behavior in `src/main.ts`.
3. `npm run deploy -- frost-walker`.

Slugs are lowercase, with `-` or `_` separators. The slug names the folder, the
built pack folders (`frost-walker_bp`), and the `.mcaddon`.

## Script API versions

Three version numbers have to agree, and disagreement is the most common cause
of "my script silently does nothing":

| Where | Current value | Meaning |
|---|---|---|
| `package.json` devDependency | `@minecraft/server` `2.9.0` | The TypeScript typings you code against |
| `behavior_pack/manifest.json` dependency | `"version": "2.9.0"` | The module version the game hands your script at runtime |
| `behavior_pack/manifest.json` `min_engine_version` | `[1, 26, 40]` | The oldest game build allowed to load the pack |

`@minecraft/server` 2.9.0 ships with Minecraft 1.26.40. To move to a newer API,
bump all three together; to support older game builds, lower all three. Setting
`min_engine_version` *above* your installed game hides the pack from **My
Packs** entirely, which looks like the pack failing to install.

The script runtime is neither Node nor a browser: there is no `setTimeout`, no
`fetch`, and no filesystem. Use `system.run`, `system.runTimeout`, and
`system.runInterval` from `@minecraft/server` instead. `shared/env.d.ts`
declares the handful of extra globals that do exist.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Pack missing from **My Packs** | `min_engine_version` newer than your game, a duplicate UUID, or invalid manifest JSON — run `npm run validate` |
| Pack loads, script never runs | Manifest script `entry` does not match the built path, or the declared `@minecraft/server` version is newer than your game provides. Check the content log |
| Chat shows `hello_world.welcome` literally | The resource pack is not active — translations are resolved client-side from `resource_pack/texts/*.lang` |
| Edits do not take effect | Re-enter the world; development packs reload on world entry, not live |
| Deploy cannot find `com.mojang` | Set `MINECRAFT_COM_MOJANG` or pass `--dir` |

## License

[MIT](LICENSE) © Steven Le
