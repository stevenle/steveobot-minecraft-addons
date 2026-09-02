---
name: deploy-addon
description: Get a built add-on into Minecraft - local dev deploy, .mcaddon packaging, or uploading to a Realm. Use whenever asked to deploy, ship, install, or push an add-on so someone can play it, or to debug a Realm upload that did not take.
---

# Deploying an add-on

Run `pnpm check` first; never deploy a build that has not passed it.

## Pick the route

1. **Local Bedrock install** (fast loop): `pnpm run deploy <slug>` — note the
   `run`: bare `pnpm deploy` is a pnpm builtin and fails with
   `ERR_PNPM_CANNOT_DEPLOY`. Needs a `com.mojang` folder; on this macOS machine
   there is none unless mcpelauncher is installed, so this route usually fails
   here — check before promising it.
2. **Another device**: `pnpm package <slug>` → `dist/_packages/<slug>-v*.mcaddon`;
   the user opens it on Windows/iOS/Android to import.
3. **Realm** (what "deploy it" means in this repo when there is no local
   install): see below. Confirm with the user before the first upload of a
   session — it briefly closes the Realm and replaces the live world.

## Realm upload

```bash
pnpm realm --list-realms                                    # find the id; needs cached login (.realms-auth/)
pnpm realm <slug> --realm <id> --upload --close --yes       # pull live world, bake packs, upload
```

The tool downloads the *current* live world each time, so re-deploying never
loses in-game progress. The pre-upload bake is written to `dist/_realm/*.mcworld`
and doubles as a restore point.

### The event stream is the verdict, not the HTTP status

A `201` means only that the archive arrived. `VALIDATION_SUCCEEDED` →
`ARCHIVING_SUCCEEDED` in the streamed events means the world actually swapped;
`ARCHIVING_FAILED` means the Realm kept its old world (the CLI now says so
explicitly). Known cause of `ARCHIVING_FAILED`: the same pack uuid under two
folders in the world — see below.

### What Realms does to a world you uploaded (observed 2026-09-01)

- Pack folders get **renamed** (e.g. `behavior_packs/xray-helmet_bp` → `behavior_packs/0`).
- `world_*_packs.json` entries get `version` re-encoded as a **string** (`"[1,0,0]"`).

The tooling compensates (applyPack sweeps same-uuid folders; readPackList
parses string versions) — keep both behaviors in mind when inspecting a
downloaded world by hand, and do not "fix" those code paths away.

### After a successful upload

The immediate reopen is usually refused (503) while the service swaps the
world in. That is normal: tell the user to open the Realm from the client's
Realm settings, and verify with `pnpm realm --list-realms` (shows OPEN/CLOSED).
Do not script extra Realms API writes outside `tools/realm.ts` — implement
missing operations as flags there instead.

## Verifying and debugging a deploy

- `pnpm realm --realm <id> --list` shows what the live world has applied and
  whether each listed pack's folder is actually present.
- On a Realm there is **no content log**: script errors are invisible. Use the
  add-on's `/scriptevent steveo:*` debug command in-game to isolate behavior
  pack vs resource pack failures.
- The pack showing up but the script "doing nothing" is almost always the
  version triple (CLAUDE.md) or a runtime throw — check both before touching
  gameplay code.
- Bedrock reloads development packs on world entry; on Realms, each iteration
  is a fresh upload. Batch changes before redeploying.
