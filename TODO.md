# TODO

## Done: AXOLOTL SURVIVAL (Realm 34568298, slot 2) updated with add-ons

- [x] Pull slot 2 and bake `hello-world` in → `dist/_realm/my-world.mcworld`
- [x] Confirm slot 2 is "AXOLOTL SURVIVAL" (Realm slot names live server-side;
      `levelname.txt` inside the archive still says "My World")
- [x] Capture stage 2 of the upload protocol: the upload host answers
      `Allow: HEAD, POST, GET, OPTIONS` and serves `application/x-mcworld`,
      so the write is a POST of the archive with the Bearer token
- [x] Implement the upload: `uploadWorldArchive()` in the client, `--upload`
      flag (gated behind `--yes`) in `realm.ts`, tests against the stand-in
      server
- [x] First live run: stage 1 refused with 403 "Could not set upload state" —
      the session-minting endpoint is stateful; two probe-minted sessions were
      likely still pending. Added `--close` (close Realm -> upload -> reopen,
      routes from prismarine-realms) and a proper explanation for that 403
- [x] Retry live with `--close`: POST answered 201 Created with an SSE stream
      ending VALIDATION_SUCCEEDED -> ARCHIVING_SUCCEEDED. Captured in
      CLAUDE.md. The immediate reopen failed (service likely mid-swap); CLI
      now prints the reopen error
- [x] Verified in-game (2026-09-01): world replaced, packs active. `--upload`
      promoted from experimental in README/CLAUDE.md

## Next deploy: remove the backpack add-on from the Realm

The backpack add-on was deleted from the repo on 2026-09-12 (the form-based
tap-to-move interaction was not good enough), but version 1.1.2 is still
applied to Realm 34568298 "Blub the Axolotl". `pnpm realm` can only add or
update packs, so removing it takes these steps, in this order:

- [ ] In-game, before the upload, clean up what the script left behind:
      `/tickingarea remove steveo_backpack_vault` and
      `/kill @e[type=steveo:backpack_storage]`. Backpack items in inventories
      and chests turn into unknown items once the pack is gone; take out
      anything stored in a backpack first, or it is lost with the entity.
- [ ] Remove the packs from the world. Either add a `--remove <slug>` flag to
      `tools/realm.ts` (delete the pack folders and drop the entries from
      `world_behavior_packs.json` / `world_resource_packs.json` by UUID), or
      deactivate them from the client's Realm world settings. The UUIDs, which
      are no longer in the repo: behavior pack
      `426faf68-ac27-46f5-bb0e-8dd48aef373a`, resource pack
      `6eb5e5f5-7790-4770-9fd1-6cc063af7827`.
- [ ] Verify with `pnpm realm --realm 34568298 --list` after someone has joined
      (the download lags the upload until then).

## Later

- [ ] Parse the upload SSE events for progress and a clean failure signal
      (`VALIDATION_FAILED`?) instead of dumping the raw stream
- [ ] Reopen handling: confirm why the immediate `PUT /worlds/{id}/open`
      fails after upload (mid-swap?) — the CLI now prints the error — and
      decide on a short wait-and-retry
- [ ] `--slots` flag: `GET /worlds/{id}` returns per-slot `options` JSON with
      `slotName`, game mode, enabled packs — print a table so identifying a
      slot doesn't need a one-off script (endpoint verified against
      prismarine-realms and captured live 2026-09-01)
- [ ] Replace the placeholder 128×128 `pack_icon.png` in `hello-world`
