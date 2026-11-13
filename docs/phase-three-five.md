# Phase 3.5: Team Mode and production preparation

## Enable Team Mode

Apply `supabase/migrations/202611120004_teams.sql` once after migrations 001, 002, and 003. Do not rerun previous migrations. Existing rooms remain Solo Mode; no active sessions or scores are reset. This migration was tested locally, not applied to the hosted Supabase project by this implementation.

Hosts can save Solo/Team Mode, create 2–4 teams, rename teams, choose distinct colors from eight accessible labeled options, set per-team capacity, assign/unassign players, distribute players evenly, and lock/unlock selection. Changing team count resets assignments; renaming or changing colors preserves them. Saving mode/capacity unlocks selection. Capacity cannot exceed the room's player limit, and the room limit still caps total participants. An impossible balance or capacity reduction rolls back without partial assignment changes.

Players can select teams only while in the lobby and selection is unlocked. Host assignment controls remain available while selection is locked. Starting Team Mode requires locked selection, every active player assigned, and at least two populated teams. A player joining a locked lobby remains unassigned until the host assigns them. All membership/configuration changes freeze when gameplay starts. Disconnected seats remain assigned and consume capacity until explicit leave.

## Authority, scoring, and recovery

`game_teams` belongs to a room. A nullable `game_players.team_id` represents at most one membership per player; composite foreign keys prohibit cross-room assignments. Accepted attempts persist `team_id` from the authenticated player's database membership, never a client claim. Membership cannot change after start, so contributions cannot migrate between teams mid-round.

The existing room-row lock still arbitrates all buzzes, assignments, starts, leaves, and judgments. First valid database processing order wins; client timestamps and Realtime arrival order do not affect it. The winning player's nickname and team name appear together, with the existing persisted deadline. Classic/Casual rules are unchanged.

Team scores are **derived from the authoritative `answer_attempts.score_delta` ledger**, updated atomically by the existing guarded judgment transaction. There is no second mutable team-score total. In Team Mode, `game_players.score` is not awarded points; member statistics show correct/incorrect contributions. Solo scoring remains unchanged. Unique `(clue_id, team_id)` and existing round/attempt constraints prevent multiple accepted attempts by teammates and duplicate awards. Stale judgment versions or wrong attempt IDs are rejected.

An incorrect attempt excludes the entire team for that clue. Other connected eligible teams can rebound. A confirmed no-penalty void also consumes the team's eligibility, matching Solo Mode's consumed-attempt recovery policy. Completion resets eligibility for the next clue. Refresh/reconnection restores the same team, deadline, exclusions, and scores. Explicit departures retain their scored contributions. Final rankings use competition ranks (1, 1, 3); tied populated leaders share victory. Empty teams are excluded from the gameplay leaderboard and cannot outrank participating teams with negative scores.

Team mutations emit the existing private `{changed:true}` invalidation and increment the board version. The existing authoritative refetch, token lifecycle, two-second competitive polling, ten-second ordinary polling, and cleanup remain unchanged. Host question drafts can become stale after lobby configuration/membership changes; the editor preserves local text and requires a saved-board reload before overwriting newer state.

## API and files

POST `/api/rooms/:code/game` adds these strict, versioned requests:

| Action          | Extra fields                  | Permission                           |
| --------------- | ----------------------------- | ------------------------------------ |
| `team_setup`    | `mode`, `count`, `capacity`   | Host, lobby                          |
| `team_edit`     | `teamId`, `name`, `color`     | Host, lobby                          |
| `team_lock`     | `locked`                      | Host, lobby                          |
| `balance_teams` | none                          | Host, lobby                          |
| `assign_team`   | `playerId`, nullable `teamId` | Host, lobby                          |
| `choose_team`   | nullable `teamId`             | Authenticated player, unlocked lobby |

All include `expectedVersion`. `choose_team` derives identity from the room credential. Forged player IDs, scores, and extra fields are rejected at the HTTP boundary. Database validation independently enforces roles, room membership, capacity, and frozen assignments.

Main changes:

- `supabase/migrations/202611120004_teams.sql`: relationships, team commands/snapshots, start guards, team-aware arbitration, ledger-derived rankings.
- `src/features/game/team-lobby.tsx`: mode/settings, grouped roster, self-selection and host management.
- `src/features/game/competition.tsx`: team winner labels, team exclusion text, team standings and final victory.
- `src/features/game/board-editor.tsx`, `game-view.tsx`, `src/features/lobby/player-list.tsx`: start readiness and score presentation.
- `src/types/board.ts`, `src/lib/game-validation.ts`, `src/lib/services/game.ts`, `http.ts`: typed snapshots, strict requests, RPC routing, production-origin/HTTPS enforcement, friendly errors.
- `src/lib/invitations.ts`, `public-origin.ts`, `src/features/lobby/invitation.tsx`, `room-code.tsx`, `lobby.tsx`, `src/app/room/[code]/page.tsx`: canonical invitation URL and consistent QR/copy/link rendering.
- `src/app/globals.css`: responsive teams, readable colors, and QR sizing/quiet zone.
- `vercel.json`, `.env.example`, `scripts/check-production.mjs`, `.gitignore`, `package.json`: deployment configuration and validation without secret output.
- `tests/team-database.test.ts`, `invitations.test.ts`, updated competition/HTTP tests: SQL, security, Solo regression, rankings and URL/QR consistency.
- `scripts/test-competition-live.mjs`: optional Team Mode multi-connection race test using `TEST_TEAM_MODE=true`.

## Invitation behavior

Production uses server configuration `APP_PUBLIC_ORIGIN`, passed to the lobby as a public origin string. It is never constructed from a request Host or forwarding header. The value must be an HTTPS origin without a path, query, fragment, or embedded credentials. Missing/invalid production configuration fails closed. Requests must also originate from the configured origin and match the request origin; arbitrary matching Host/Origin headers cannot authorize another domain. All production mutation/session endpoints reject HTTP.

Development leaves `APP_PUBLIC_ORIGIN` blank and uses the browser's current origin, preserving localhost and LAN testing. A single generated URL is passed to the displayed anchor, copy control, and QR encoder. A URL change remounts those controls; QR uses a four-module quiet zone, white background, 192px size, medium error correction, and responsive sizing. If clipboard access fails, the selectable URL remains available.

Cookies remain per-room, host-only, HttpOnly, SameSite=Lax, Secure in production. There is no cross-domain cookie sharing. Opening a link on a new device creates its own player identity; refreshing on the same browser resumes that identity. A cookie for another room is ignored. Existing server code/credential checks reject wrong-room credentials, closed rooms, and expired sessions. Invalid code formats show the friendly not-found page. Joining remains limited to the lobby and retains the existing hashed-IP rate limits.

Use the canonical domain for hosting and joining. Preview must have its **own** configured origin and corresponding test Supabase project; never point a preview invite at production while using a different database. If domains change, redeploy the configuration and reload pages; old-domain cookies do not transfer. Configure alternate-domain redirects in Vercel before creating sessions, rather than sharing cookies across domains.

## Vercel setup and environment

The repository uses Next.js's normal Vercel adapter, Node runtime API routes, and direct private Supabase Realtime connections. No custom WebSocket server or process-local game state is introduced. `vercel.json` runs `npm ci` and `npm run check:production && npm run build`, and sets HSTS, no-sniff, frame-denial, and referrer-policy headers. It does not hardcode a domain or deployment region.

| Variable                        | Visibility / purpose                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `APP_PUBLIC_ORIGIN`             | Server configuration; exact canonical HTTPS origin for this environment; only its public origin string is sent to the lobby |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public target Supabase project HTTPS API origin                                                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public publishable/anon key for Realtime, never a secret or service-role key                                                |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only secret/service-role API credential for guarded RPCs                                                             |
| `SUPABASE_JWT_SECRET`           | Server-only accepted legacy HS256 signing secret for short-lived room Realtime JWTs; **not** an API key                     |
| `RATE_LIMIT_SALT`               | Server-only random secret, at least 32 characters; generate with `openssl rand -hex 32`                                     |

The existing signer requires Supabase to accept that HS256 signing key. Projects without an accepted legacy key need a separately implemented supported signer before deployment; never substitute an API key. Disable public Realtime access, preserve private Broadcast/Presence policies, and apply all four migrations to the target project. Browser roles retain no application-table access. New team tables have RLS and no browser grants. No app account signup is required.

`check:production` checks presence, HTTPS-origin shape, secret length, and accidental placement of a service-role JWT or secret key into the public key variable. It does not validate credentials against Supabase or prove migrations/Realtime work. API creation/join abuse protection remains 5/20 per minute per hashed IP on Vercel; tune upstream protection for public traffic without relaxing session authorization.

Environment changes require a new deployment, and Preview/Production variables are separately scoped. See [Vercel environment variables](https://vercel.com/docs/environment-variables) and [deployment environments](https://vercel.com/docs/deployments/environments).

### Exact remaining deployment steps

The saved Vercel token was rejected by `vercel project ls --json` as **invalid**. This checkout has no `.vercel/project.json`, and no production project/domain was confirmed. No deployment was performed and no deployment URL is claimed.

1. Run `vercel login` and complete authentication yourself, then `vercel whoami` to verify it.
2. Run `vercel link` from this repository and choose the intended QuizArena project/team (or create the intended project in the dashboard). Do not select another application's project. `.vercel/` is ignored by Git.
3. Configure Node.js 22 or 24 in the project. Add the intended production domain under project settings and complete DNS/TLS verification. Use its exact HTTPS origin for `APP_PUBLIC_ORIGIN`; for an initial `vercel.app` deployment, use the project's assigned stable domain, not an invented URL.
4. Apply migrations 001–004 once and in order to the corresponding Supabase project. Verify private Realtime configuration and the accepted JWT signing key. Use a separate test project for Preview.
5. Add all six variables to the intended Vercel environments through Settings → Environment Variables (or `vercel env add NAME production` interactively). Do not paste secrets into source control, chat, command-line arguments, or public variables. For Preview, configure a stable preview/branch domain as its own origin and use only that origin when testing.
6. Deploy a preview with `vercel`. Run the checklist below against its configured origin. Preview deployment protection may require Vercel login and can prevent camera-scanned anonymous access; use a deliberately public test deployment or test the final public domain for account-free invitations.
7. Deploy production with `vercel --prod` after preview verification. Record the actual returned URL, confirm the canonical domain resolves to it, and test it over HTTPS. Confirm Vercel redirects HTTP to HTTPS. No success should be reported until those checks pass.

Do not run `vercel env pull` over your existing `.env.local` without preserving it. Use a separate ignored environment file if you need to pull deployment variables for local validation.

## Verification and production acceptance

Verification completed November 12, 2026: **145 tests passed across 12 files; ESLint, TypeScript, production build, and diff whitespace checks passed.** The deployment preflight accepted valid test configuration and rejected missing/insecure origins and a secret key in the public-key variable. Configured server secrets were absent from production browser JavaScript.

Local tests execute the real migrations/RPCs in PGlite and cover teams, host/player permissions, balancing, capacity, frozen membership, no unassigned start, Classic/Casual team scoring, negative scores, whole-team exclusion, duplicate judgments, simultaneous submitted buzzes, departed contributions, victory/ties, and empty-team ranking. The Phase 3 Solo suite now also runs migration 004. HTTP tests cover forged fields and cross-room cookies; invitation tests render the actual shared invitation component and check QR/copy/display URL consistency, unsafe-origin rejection, LAN behavior, and forged production Host/Origin rejection.

PGlite queues on a single database connection. For actual independent Supabase transactions on a **dedicated test project**, after applying migrations:

```sh
ALLOW_DATABASE_TESTS=true npm run test:competition:live
TEST_TEAM_MODE=true ALLOW_DATABASE_TESTS=true npm run test:competition:live
```

These scripts create/delete only their own test room. Each races eight buzzers and four duplicate judgments for five clues, asserting one winner and exact score totals. They have not been run for this migration against the hosted project. Physical-phone QR scans and deployed WebSocket behavior remain unverified.

Production checklist:

1. Open the canonical HTTPS origin in independent browser profiles; host in A, join as players in B and C. Check Secure/HttpOnly/SameSite=Lax cookies without Domain, correct room membership, and no secrets in browser bundles/network payloads.
2. Compare the displayed invite with the copy result and decoded QR URL. Open it from a message and scan with iPhone/Android cameras. Test one phone on Wi-Fi and another on cellular; a public production URL must work without LAN access or an app account.
3. Enter nicknames, confirm the host roster updates live, then refresh each phone. Player IDs must persist without duplicates. A second room must not consume the first room's cookie. Invalid, closed, and expired room links must fail clearly.
4. Switch to Team Mode, create 2–4 teams, edit names/colors, adjust capacity, and balance. Let players choose; lock selection and verify they cannot move. Move a player as host. An unassigned player or fewer than two populated teams must block start.
5. Start, buzz on multiple teammates and opponents, and verify exactly one winning player/team. Judge incorrect in Classic and Casual; verify team penalty rules, teammate exclusion, and opponent rebound. Replay judgments and attempt cross-room assignments; both must fail.
6. Check team leaderboard scores, individual contribution counts, ties, and final celebration. Empty teams must not beat negative-scoring participants. Confirm Solo Mode still awards individuals and shows its original leaderboard.
7. Refresh during an answer, disconnect the winner or host, and restore the connection. Check saved deadline, team eligibility and score recovery. Disable WebSocket transport while HTTP remains available and check fallback synchronization. Leaving must stop polling.
8. Test phone widths/rotation, keyboard focus, long names, reduced motion, copy-link fallback, readable QR quiet zones, and invitation links opened by mobile scanners/in-app browsers. These are manual acceptance steps, not claims of completed physical-device testing.

AI generation, typed answers, payments, and unrelated features were not added.
