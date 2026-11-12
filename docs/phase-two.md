# Phase 2: shared game board

## Enable the feature

Apply `supabase/migrations/202611120002_game_board.sql` once in the Supabase SQL Editor, after the Phase 1 migration. Existing rooms receive an independent sample board on their next authorized read; existing started sessions attach to that board. No new environment variables are required. Keep private Realtime authorization enabled. The migration has been executed in local PostgreSQL tests, not applied to the hosted project by this implementation.

## Experience and files

- `src/features/game/board-editor.tsx`: host-only, five-category editor with 25 questions and answers; validates and saves the complete board. Unsaved or stale edits prevent starting. Reload saved explicitly replaces the local draft.
- `src/features/game/game-view.tsx`: responsive 5×5 board, read-only player view, active clue, host reveal/complete controls, early-end confirmation, and final participant list. Completed tiles cannot be selected again. Existing reduced-motion styles apply.
- `src/features/lobby/lobby.tsx`: integrates preparation and gameplay into the existing room page and session lifecycle.
- `src/types/board.ts`, `src/lib/game-validation.ts`: typed phases, safe snapshots, and strict request validation.
- `src/app/api/rooms/[code]/game/route.ts`, `src/lib/services/game.ts`: same-origin, cookie-authenticated game API and server-only database boundary. The existing start endpoint also requires a board version.
- `src/features/lobby/room-sync.ts`: ignores game snapshots older than an already accepted mutation response.
- `src/app/globals.css`, shared confirmation dialog, landing copy: matching midnight-blue, gold, responsive styling and labeled confirmations.
- `tests/game-database.test.ts`, `tests/game-validation.test.ts`, `tests/room-sync.test.ts`: database authorization/state-machine, input validation, and stale-response regressions.

## Persistence and authorization

Normalized `game_boards`, `game_categories`, `game_clues`, and `game_progress` tables extend existing rooms and sessions. Categories and clues have fixed positions; point values derive from clue position. Completion records are unique per clue. Composite foreign keys prevent linking records across boards or rooms. The existing session's `current_clue_id` and new `phase` are the authoritative current state; there is no second client-owned state machine.

Every command authenticates the credential and locks the room row. Every mutation compares `expectedVersion` against the board version, validates its phase and target, updates atomically, and increments that version. Replaying a request fails rather than advancing the game twice. A stale host tab must refresh/reload before retrying.

Browser database roles cannot read the game tables or invoke internal functions. Only the host editor endpoint returns the full answer set, and only before starting. Normal room snapshots contain tile metadata, the active question, and an answer only during `answer_revealed`. Sample content lives in the database migration, not browser bundles. A reveal intentionally makes that answer available to participants; clients cannot be made to forget information already revealed.

## API and transitions

POST `/api/rooms/:code/game` using the existing room cookie. All actions require host authorization:

| Action     | Body in addition to `action`             | Allowed state → result                               |
| ---------- | ---------------------------------------- | ---------------------------------------------------- |
| `editor`   | none                                     | lobby → host editor snapshot                         |
| `save`     | `expectedVersion`, `board: {categories}` | lobby → validated saved board                        |
| `start`    | `expectedVersion`                        | lobby → board (requires a connected player)          |
| `select`   | `expectedVersion`, `clueId`              | board → clue_active                                  |
| `reveal`   | `expectedVersion`, `clueId`              | clue_active → answer_revealed                        |
| `return`   | `expectedVersion`, `clueId`              | clue_active → board; cancels an unrevealed selection |
| `complete` | `expectedVersion`, `clueId`              | answer_revealed → board, or completed after clue 25  |
| `end`      | `expectedVersion`                        | any started, unfinished phase → completed            |

Editor replies are `{editor}`; mutations return `{room}` with the safe game snapshot. Save uses existing category/clue IDs and positions, five distinct category names, and exactly five nonblank question/answer pairs per category. Bounds are 40 characters for category names, 1,000 for questions, and 300 for answers. Answers are not exposed by the save response.

Returning before reveal leaves that clue available. Once revealed, completing it is the route back to the board; completed clues stay disabled. Ending early cannot be undone. Completed-room host departure revokes only that host credential, leaving the final screen accessible to other participants until expiry.

## Live synchronization and recovery

Each successful transaction emits one private `room_changed` notification containing only `{changed: true}`. Supabase delivers transactional notifications after commit. The existing shared room subscription fetches an authorized snapshot rather than trusting broadcast state. All host actions, including save, use this path. Mutation responses update the host immediately; lower-version delayed responses cannot roll it back.

The existing 10-second heartbeat/polling recovery, token renewal, visibility refresh, reconnect behavior, and leave cleanup remain in place. Refresh restores the persisted board, active question, revealed answer, or completed screen without creating another participant. Connection loss may delay a device's display until transport recovery or polling; the server remains authoritative.

## Verification and acceptance

Automated tests run the real migrations in PGlite, with small Supabase authorization/transport stubs. They cover board creation, malformed and atomic saves, host-only commands, stale/replayed actions, answer filtering, broadcast payload secrecy, all transitions, all 25 completions, early ending, cross-room access, final-state preservation, and reconnect snapshots. The transport stub does not verify hosted Supabase WebSocket delivery.

Implementation verification: **90 tests passed across 8 files; ESLint, TypeScript checking, production build, and `git diff --check` passed.**

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. The optional `npm run test:db` requires an explicitly configured dedicated test project and checks genuinely concurrent starts against the current version.

Manual acceptance after applying the migration:

1. Run `npm run dev:lan`. Use `http://<Mac-LAN-IP>:3000` on both Mac and phone on the same Wi-Fi. Production requires HTTPS; cookie security has not been weakened.
2. Create a room in browser A. Join in browser B (a separate browser/profile) and on a phone. Confirm all rosters agree. Tabs in one profile share the same room credential.
3. As host, review all five sample categories, change a question/answer and save. Verify players have no editor. Attempt an empty answer; saving must fail. Start with a connected player.
4. Select a tile. Check every device shows its category, value, and question. Inspect the player's state/heartbeat JSON: it must not contain the answer. Player game commands must return 403.
5. Reveal, then complete. Every device must reveal together and return to the board with that tile disabled. Refresh each device during each phase and verify recovery. Return before revealing another clue and verify it remains available.
6. Disconnect B, progress on A, then reconnect B. It must recover the latest phase and completed tiles. Confirm backup polling recovers if WebSocket transport is interrupted.
7. Open another host tab, submit competing actions, and verify only one succeeds; stale actions show a recoverable error. Create another room and verify independence.
8. End early, cancel once, then confirm. Check the participant list and completed count everywhere. Host leave must not remove the other participants' final screens. A full 25-clue game must complete automatically.
9. Check keyboard operation, dialog focus, touch target sizes, long edited content, 320px-wide layouts, rotation, reduced motion, and background/foreground transitions on a real phone.

Browser-control tooling was unavailable during implementation; independent interactive browser contexts and real mobile behavior have not been verified. The hosted Phase 2 migration and game WebSocket flow also remain to be verified after migration application. No scores, buzzers, accounts, AI generation, Daily Doubles, or Final Jeopardy were added.

## Sample content references

Questions are original wording based on stable factual references, including [National Archives: Magna Carta](https://www.archives.gov/exhibits/featured-documents/magna-carta), [UNESCO: Machu Picchu](https://whc.unesco.org/en/list/274), [US Senate: New York City](https://www.senate.gov/about/historic-buildings-spaces/meeting-places/new-york-city.htm), [NASA: Titan](https://science.nasa.gov/saturn/moons/titan/), [Royal Society of Chemistry: tungsten](https://periodic-table.rsc.org/element/74/Tungsten), [NHGRI: mitochondria](https://www.genome.gov/genetics-glossary/Mitochondria), [BIPM: candela](https://www.bipm.org/en/committees/cg/cgpm/16-1979/resolution-3), [GKIDS: Spirited Away](https://gkids.com/films/spirited-away/), [Cannes: Parasite at the Oscars](https://www.festival-cannes.com/en/press/press-releases/parasite-the-2019-palme-d-or-winner-triumphs-at-the-oscars-2020/), and [Web Japan: origami](https://web-japan.org/kidsweb/virtual/origami/exploring01.html). Hosts can adapt difficulty and wording before starting.
