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
