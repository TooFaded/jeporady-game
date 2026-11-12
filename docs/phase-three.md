# Phase 3: buzzers, judging, timers, and scoring

## Migration and startup

Apply `supabase/migrations/202611120003_competition.sql` **once**, after migrations `001` and `002`, in the Supabase SQL Editor or through your existing migration workflow. It is additive: existing rooms, boards, sessions, credentials, and scores are retained. Boards default to Classic scoring and a 10-second answer duration. Existing started games can continue from their saved phase. No environment variables or public database permissions are added.

The migration was tested locally in PGlite. It has not been applied to the hosted project by this implementation. Before applying it to a shared environment, use the normal database backup/migration process. Restart the app after deploying the corresponding code. Until migration application, the existing Phase 2 flow remains usable and preparation shows a migration hint.

## Implemented experience

The host selects a clue, optionally consults a private answer reference, and opens buzzers. Players see a large mobile-friendly BUZZ button, disabled outside eligible rounds. Pressing shows “SENDING…”; winning is never optimistic. Only an accepted server response can show “You’re up!” All devices show the accepted winner and countdown.

The host marks correct or incorrect. Correct awards the clue value, reveals the answer, and closes competition for that clue. The host still explicitly completes it to return to the board. Incorrect applies the configured penalty, records the attempt, and automatically opens a rebound for connected eligible players. An attempted player cannot buzz again for that clue. If nobody is eligible, buzzers close; the host can wait for a reconnect, reopen, or reveal and complete.

Hosts can close accidentally opened buzzers before a winner is accepted. During an abandoned answer, **Void attempt · no penalty** requires confirmation, awards/deducts nothing, consumes that player's eligibility, and closes buzzers. This is intentionally different from judging incorrect. Once a clue has attempts, returning it unplayed is prohibited: reveal and complete it instead, preserving scores and preventing repeated awards. Ending the game early voids any unjudged attempt without a penalty.

The preparation panel saves Classic/Casual scoring and answer duration before start. Classic awards +value for correct and −value for incorrect; Casual awards +value and zero respectively. Negative scores are valid. Duration is bounded to 3–60 seconds in the API/database; the UI offers common choices and displays any saved supported value.

The compact leaderboard shows nickname, rank, score, correct count, and incorrect count. Equal scores share competition rank (1, 1, 3), with stable joined-time/ID ordering for display. Final results highlight all tied leaders. Departed players with attempts remain in rankings; spectators who left without playing are excluded.

## Authoritative arbitration and fairness

`competition_command` authenticates the existing HttpOnly room credential through `room_command`, which takes a PostgreSQL `FOR UPDATE` lock on the room row. Joining, leaving, gameplay, and competitive actions share that lock across server instances.

A buzz contains only the active clue ID and a server-issued round UUID. Player identity comes from the credential, never the request body. While holding the lock, PostgreSQL checks room/phase/round identity, active membership, the existing 45-second connection lease, and per-clue attempt eligibility. It inserts the attempt and changes the single session phase to `player_answering` in the same transaction. Subsequent requests see the closed phase and cannot steal the lock. Closing/reopening or starting a rebound creates a new round UUID, so delayed taps from an earlier opening are rejected.

**The first valid request processed under the authoritative database lock wins.** Device timestamps, button-animation timing, and Realtime arrival order play no part. Network latency and server scheduling affect who reaches that lock first; this is not a physically simultaneous, latency-compensated competition. No promise of equal geographic latency is made.

Unique constraints enforce one accepted attempt per round, one attempt per player/clue, and one unjudged attempt per room. Composite foreign keys prevent cross-room or cross-board references. Repeated judgments must identify the current attempt and exact board version. The outcome, score delta, `game_players.score`, new phase, and version commit atomically; retries cannot apply points twice.

## State and timer

There is still one game state machine, in `game_sessions.phase`:

| Action                   | From                              | To                                                 |
| ------------------------ | --------------------------------- | -------------------------------------------------- |
| Select                   | board                             | clue_active                                        |
| Open                     | clue_active                       | buzzers_open or rebound_open                       |
| Close                    | buzzers_open / rebound_open       | clue_active                                        |
| Accepted buzz            | buzzers_open / rebound_open       | player_answering                                   |
| Deadline observed        | player_answering                  | answer_judging                                     |
| Correct, before deadline | player_answering                  | answer_revealed                                    |
| Incorrect                | player_answering / answer_judging | rebound_open, or clue_active if nobody is eligible |
| Void                     | player_answering / answer_judging | clue_active                                        |
| Reveal                   | clue_active                       | answer_revealed                                    |
| Complete                 | answer_revealed                   | board, or completed after clue 25                  |
| End                      | any started unfinished phase      | completed                                          |

The deadline uses `clock_timestamp()` **after acquiring the lock**, plus the saved duration. It is persisted with the accepted attempt. The UI derives a countdown from that deadline and the response's server time, then uses a monotonic elapsed clock. Device wall-clock changes and refresh cannot extend the server deadline. Network transit/render delays can cause small visual differences; server enforcement decides whether a correct judgment is on time.

Expiry is materialized on the next authorized read or action under the same room lock. It changes to `answer_judging`, increments the version, and emits one invalidation. The client requests a refresh when its display reaches zero; polling also observes expiry. A correct judgment separately rechecks the database clock and is rejected after expiry, even if the displayed phase was stale. Incorrect or a confirmed void remains available after expiry. **No automatic timeout penalty is configured:** the host decides incorrect versus no-penalty recovery. If every browser is offline there is no background worker to emit an expiry event at that instant; the saved deadline still expires, and the next connection observes it.

## Synchronization, recovery, and secrecy

Every successful competitive mutation sends the existing private `{changed: true}` invalidation transactionally. No question answers, credentials, score commands, or trusted winner identities are taken from Realtime events. Clients fetch an authenticated snapshot with phase, attempt, deadline, attempted-player IDs, configuration, and ranked scores. Lower-version responses cannot overwrite newer game state.

The existing token renewal, channel lifecycle, abort/leave cleanup, and terminal authentication handling are retained. Shared polling speeds up from 10 seconds to **2 seconds during open/answering/judging phases**, then returns to 10 seconds. Realtime remains the normal low-latency path. A transport outage may delay a device's view until its next successful poll; a fully offline device cannot participate.

Refresh restores the same attempt and deadline. A disconnected winner retains the attempt; the host can judge incorrect or void without resetting the clue. A disconnected host retains their session on ordinary tab closure and can reconnect to judge. Explicit host room closure retains the established cancellation behavior. Failed players remain ineligible after reconnect. Connection eligibility is the existing server lease, not an assertion that a physical network link is instantaneously observable.

Only the host gets `game.host_answer` for the current clue. Player state/heartbeat/mutation responses omit it; players see `active_clue.answer` only after reveal/correct. Browser database roles have no table access or execute access to internal helpers. Server-only service credentials remain server-side. All HTTP actions retain same-origin validation, strict schemas, session-cookie authentication, and no-store responses.

## API and changed files

The existing POST `/api/rooms/:code/game` now accepts:

- `buzz`: `clueId`, `roundId`; player-only, no client timestamp/player ID/score/version.
- `configure`: `expectedVersion`, `mode` (`classic`/`casual`), `seconds`; host-only in lobby.
- `open` / `close`: `expectedVersion`, `clueId`; host-only.
- `correct` / `incorrect` / `void`: `expectedVersion`, `clueId`, `attemptId`; host-only.

Existing editor/start/select/reveal/complete/return/end requests remain supported with the additional competitive guards. The response remains `{room}`. Host judging references are not present in player responses.

| File                                                | Change                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/202611120003_competition.sql`  | Constraints, attempts ledger, settings, safe snapshots, expiry, locked arbitration, atomic judgments/scoring, protected legacy entry points |
| `src/types/board.ts`                                | Competitive phases, attempt/deadline/configuration/leaderboard types                                                                        |
| `src/lib/game-validation.ts`                        | Strict competitive request schemas                                                                                                          |
| `src/lib/services/game.ts`                          | Dispatch competitive actions to the server RPC                                                                                              |
| `src/lib/services/http.ts`                          | Friendly authorization, expiry, eligibility, and stale-action errors                                                                        |
| `src/features/game/competition.tsx`                 | Settings, buzzer states, countdown, host judging/recovery, live/final leaderboard                                                           |
| `src/features/game/game-view.tsx`                   | Competitive clue integration and private host answer reference                                                                              |
| `src/features/game/board-editor.tsx`                | Pre-game scoring/time settings                                                                                                              |
| `src/features/lobby/room-sync.ts`                   | Faster polling during competitive phases                                                                                                    |
| `src/app/globals.css`                               | Mobile buzzer, timer, ranking, and settings styles using the existing visual identity                                                       |
| `tests/competition-database.test.ts`                | Real migration/SQL arbitration, scoring, eligibility, expiry, secrecy, recovery, and isolation coverage                                     |
| `tests/competition-http.test.ts`                    | Authenticated RPC dispatch, input forgery rejection, session/origin checks, error mapping                                                   |
| `tests/room-sync.test.ts`                           | Competitive polling and cleanup regression                                                                                                  |
| `scripts/test-competition-live.mjs`, `package.json` | Opt-in independent-transaction Supabase concurrency test                                                                                    |
| `README.md`, this document                          | Setup, architecture, limitations, and acceptance instructions                                                                               |

## Verification

Verification completed November 12, 2026: **117 tests passed across 10 files; TypeScript, ESLint, production Webpack build, and `git diff --check` passed.** Configured service-role, JWT-signing, and rate-limit secrets were absent from production browser JavaScript.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.

The PGlite suite executes all three migrations and actual SQL, not mock arbitration. It includes competing submitted calls, exactly one persisted winner, duplicate/stale buzzes, Classic/Casual scoring, negative scores, rebound exclusions, timed expiry, no late correct award, replayed and mismatched judgments, host disconnect recovery, private host answer visibility, cross-room authorization, and final tied rankings. **PGlite queues on one connection; this is not proof of concurrent multi-connection lock contention.**

For a dedicated migrated Supabase test project:

```sh
ALLOW_DATABASE_TESTS=true npm run test:competition:live
```

The script creates its own labeled room and eight players, submits eight simultaneous independent RPCs over each of five clues, asserts one winner each, races four identical judgments per clue, verifies exact aggregate scores, and deletes only its own room in `finally`. It uses configured server credentials locally and never prints them. It does not test browser UI or WebSocket delivery.

The hosted concurrency script has not been run because the Phase 3 migration has not been applied there. A local multi-process PostgreSQL run was unavailable: the installed PostgreSQL 15 executable fails to load `libicui18n.73.dylib`. The browser tool also failed to attach to the local preview (`timeoutMs` tool error). No real-device or independent-browser UI testing is claimed.

## LAN acceptance checklist

1. Apply all three migrations. Run `npm run dev:lan`; find the Mac address with `ipconfig getifaddr en0`. Use `http://MAC_IP:3000` consistently on the Mac and phones on the same Wi-Fi. Production requires HTTPS. Do not switch a localhost session to the LAN hostname.
2. Host in browser A, join as different players in browser B/private profile and on a phone. Ordinary tabs in the same profile share one room identity. Confirm live connections and matching rosters.
3. In preparation, change Classic/Casual and duration; refresh to confirm persistence. Review a clue, start, select it. Only the host should see its private answer reference; check player state/heartbeat JSON contains no unrevealed answer.
4. Verify player buzzers are disabled until the host opens them. Tap both devices almost simultaneously. Exactly one winner should appear everywhere; repeated taps must not change the winner. Check winner text and timer on a narrow phone screen.
5. Mark incorrect. Verify the appropriate penalty, negative Classic score, one incorrect count, and immediate rebound for the other player. The first player must remain excluded even after refresh.
6. Mark the rebound correct before expiry. Verify +clue points exactly once, answer reveal, matching leaderboards, and no further buzz. Complete the clue and confirm eligibility resets on the next tile.
7. Let a winner's timer expire. Refresh mid-countdown and reconnect after expiry. Correct must be rejected after expiry; incorrect or confirmed void must work. Void must leave scores unchanged and that player ineligible.
8. Close/reopen an open round and verify delayed old-round requests fail. Try host-only actions from a player session, an invalid session, and IDs from another room. Confirm rejection without score changes.
9. Disconnect a winning player, then separately disconnect the host. Reconnect and verify the deadline and scores survive. Use void recovery for the abandoned answer. Interrupt only Realtime and confirm two-second fallback recovers active rounds; leaving must stop polls.
10. End early while an answer is pending, then check final tied/untied rankings and no award from a late judgment. Play all 25 clues in a separate test for automatic completion. Check keyboard navigation, screen-reader labels, reduced motion, background/foreground behavior, and long nicknames on phones.

AI generation, typed/voice answers, special Jeopardy rounds, paid plans, and matchmaking remain outside scope.
