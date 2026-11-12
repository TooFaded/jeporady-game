# QuizArena

QuizArena includes secure multiplayer lobbies and a synchronized, host-controlled 5×5 trivia board. Hosts can edit 25 clues before starting, select clues, reveal answers, complete tiles, and end games. Competitive buzzers, Classic/Casual scoring, answer deadlines, and live/final rankings are implemented in Phase 3. AI generation remains future work. See [Phase 3 implementation and testing](docs/phase-three.md) and the earlier [Phase 2 notes](docs/phase-two.md).

## Local setup

Use Node.js 22 or newer and npm. The lockfile pins the installed Next.js 16 / React 19 App Router stack.

```sh
npm ci
# Create .env.local with the variables listed below.
npm run dev
```

Open http://localhost:3000. The landing page and entry forms render without credentials; room operations return a helpful configuration error until setup is complete. There is no fake multiplayer or in-memory production fallback.

## Supabase setup

1. Create a Supabase project (use a separate project for development/testing).
2. Run `supabase/migrations/202611120001_phase_one.sql` in the Supabase SQL Editor, or link the project with the Supabase CLI and run `supabase db push`. Then apply `supabase/migrations/202611120002_game_board.sql` and `supabase/migrations/202611120003_competition.sql`. Apply each migration once, in order. It expects Supabase's `auth` and `realtime` schemas.
3. In Realtime settings, disable **Allow public access**, enforcing private channels. This implementation uses private Broadcast and Presence, not Postgres Changes; no table publication is needed.
4. Add the following environment variables to `.env.local` and your deployment environment:

| Variable                        | Purpose                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project API URL                                                                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key or publishable key; used only for Realtime                                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only service role key for guarded database RPCs                                              |
| `SUPABASE_JWT_SECRET`           | Project's **legacy HS256 JWT signing secret**, used to issue 60-second, room-scoped Realtime tokens |
| `RATE_LIMIT_SALT`               | Random secret, at least 32 characters; generate with `openssl rand -hex 32`                         |

The JWT secret is **not** an API key. This implementation requires a project that still accepts its legacy HS256 signing secret. If that signing key is unavailable or revoked, configure an accepted custom signing key and update the token signer before deployment; do not substitute a publishable, secret API, or service-role key for the JWT signing secret. Never prefix either server secret with `NEXT_PUBLIC_`.

Supabase anonymous Auth sign-ins are not needed. Players never create accounts. The server issues independent random host/player credentials, stores only SHA-256 digests in PostgreSQL, and keeps the raw credentials in HttpOnly, SameSite=Lax cookies (Secure in production).

See the official [Realtime authorization guide](https://supabase.com/docs/guides/realtime/authorization) and [setAuth reference](https://supabase.com/docs/reference/javascript/setauth) for private-channel configuration and token refresh.

## Architecture

```text
src/app/                 App Router pages and POST API endpoints
src/components/          Shared UI, branding, accessible confirmation dialog
src/features/lobby/      Entry forms, room hook, roster, invitations, lobby
src/lib/db/              Server-only Supabase access
src/lib/services/        Room operations and HTTP security boundary
src/lib/utils/           Secure credentials and room-code generation
src/lib/validation.ts    Shared Zod input validation
src/types/               Typed room/player/state models
supabase/migrations/     Tables, transactional RPCs, permissions and RLS
scripts/test-db.mjs      Optional live Supabase concurrency smoke test
tests/                  PostgreSQL-backed and application unit tests
```

### API

All endpoints use POST, same-origin verification, and Zod-validated input. The room code is a locator, never an authentication credential. Phase 3 adds authenticated player buzzes and host competition actions to the existing game endpoint; see [the action contract](docs/phase-three.md).

- `/api/rooms`: create with `{ "name": "Alex" }`; returns a room code and sets the host cookie.
- `/api/rooms/:code/join`: join with `{ "name": "Sam" }`; sets an independent player cookie. An existing authorized participant resumes their current seat.
- `/api/rooms/:code/state`: fetch the authorized room state.
- `/api/rooms/:code/heartbeat`: refresh the participant's connection lease and return state.
- `/api/rooms/:code/start`: host-only start with `{ "expectedVersion": 0 }` (use the current board version).
- `/api/rooms/:code/leave`: revoke the participant credential; host departure cancels an unfinished room; leaving a completed game preserves it for the remaining participants.
- `/api/rooms/:code/game`: host-only editor, save, start, select, reveal, complete, return, and end actions. See the [request contract](docs/phase-two.md).
- `/api/rooms/:code/token`: exchange an HttpOnly session for a read/presence-only, short-lived Realtime JWT. The browser cannot use this token to mutate or read application tables.

Database operations are isolated in a service layer, providing the future boundary for game and AI services. Only the service role can invoke mutation RPCs. Browser roles have no application-table grants or permissive RLS policies. The Realtime policy validates active room membership from the credential ID in the signed JWT and restricts topic access; clients can publish Presence only, never authoritative state broadcasts.

### Concurrency and connection semantics

- Cryptographically random, unambiguous six-character codes use a partial unique index for active rooms. The server retries collisions up to eight times; expired codes are retired before reuse.
- Room-row locks serialize capacity checks, nickname checks, joining, leaving, and starting. A partial unique index also prevents case-insensitive duplicate nicknames; a unique game-session room ID prevents duplicate starts.
- Up to 16 players plus the host. Disconnected players retain their nickname and seat until they explicitly leave or the room expires. This allows reconnection without duplicate identities.
- Supabase private Broadcast delivers joins, starts, and explicit leaves; Presence join/leave/sync events trigger an authoritative refresh. Client-supplied Presence identities are never trusted.
- Each active page sends a heartbeat every 10 seconds. A player is considered disconnected after 45 seconds without a heartbeat, visible by the next refresh (normally within 55 seconds). This derived status is authoritative; the stored `is_connected` flag alone is not a live connection indicator. Background tabs may be throttled and temporarily show as reconnecting. Returning to the tab refreshes immediately.
- Realtime tokens renew after 30 seconds. Polling remains as a 10-second recovery path during transport interruption. Status labels distinguish a live channel from backup synchronization.
- Closing a tab does not revoke a session; a refresh or reopening on the same browser resumes it. Explicit **Leave room** revokes the session. HttpOnly cookies are per room and browser profile, so use separate browsers/devices to test distinct people.
- Rooms and cookies expire after 24 hours. On explicit host departure, all credentials are revoked and the room is cancelled. Already-authorized Realtime connections may retain access until their 60-second JWT expires; broadcasts contain only a change signal and Presence contains no private roster data. All API operations re-check membership immediately.
- PostgreSQL rate-limit buckets cap creation at 5 and joins at 20 per minute per hashed IP. Vercel's overwritten `x-vercel-forwarded-for` is trusted only on Vercel; other environments deliberately share a `local` bucket. Configure a trusted ingress strategy before hosting elsewhere. Add Vercel firewall/edge limits for high-volume public deployment. Failed attempts consume quota, and buckets older than a day are removed opportunistically.
- Application expiry denies access without requiring a persistent worker. Schedule deletion of expired rooms in Supabase if you need a retention policy (for example, delete rooms expired more than seven days ago; dependent records cascade). The app does not silently delete game history.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests execute the actual SQL migration and RPCs in PGlite (PostgreSQL compiled to WASM), with small stubs for Supabase's `auth.jwt`, Realtime topics, and broadcast transport. They cover room creation, database code collisions, retry limits, validation, duplicate nicknames, capacity, host-only start, one-time transitions, credential failures, disconnection/reconnection, leave/rejoin, room expiry, browser mutation denial, private topic authorization, and durable rate limiting. These tests do not replace a hosted Supabase Realtime integration check.

For a dedicated configured Supabase test project, set `ALLOW_DATABASE_TESTS=true` in `.env.local` and run:

```sh
npm run test:db
```

This optional test creates one test room, sends genuinely concurrent joins/starts through Supabase, checks capacity and access denial, then deletes its test room. Never point it at a shared production project. It does not test the WebSocket transport.

### Two-device manual acceptance test

1. Start the dev server with `npm run dev -- --hostname 0.0.0.0`. Use your computer's LAN address on both devices (same Wi-Fi), or use a Vercel HTTPS preview. Ensure the firewall allows port 3000. Use development mode for LAN HTTP; production cookies require HTTPS.
2. On device A, choose **Host a Game**, enter a display name, and create a room. Check the six-character code, host badge, QR, and copy-invite action. QR uses the current origin, so use the LAN URL rather than localhost when sharing locally. Clipboard may require HTTPS; a selectable invitation link is always available.
3. On device B, open that link or enter the code, choose a nickname, and join. Confirm both rosters update automatically and show a live connection. Join from another browser profile for a third participant.
4. Try the same nickname with different capitalization; expect a friendly duplicate-name error. Test an invalid/nonexistent room code. Set the room's max_players to a small number in your test database and verify a full-room error.
5. Disable B's network or close its tab. Within approximately 55 seconds it should show as reconnecting on A. Restore the network/reopen the room and confirm the original player returns without a duplicate entry.
6. Confirm B has no Start button and a direct start request with B's cookie fails with 403. A request without a session must fail with 401. Anonymous database reads and score updates must fail.
7. Start on A with a connected player. Both devices should show the 5×5 board; further joins are rejected. Select, reveal, and complete a clue, checking both devices at each step. Refresh both pages to verify persisted state.
8. In another lobby, leave as a player and rejoin with the same nickname. Close as host and confirm other sessions lose access. Test narrow mobile widths, keyboard focus, the confirmation dialog, and reduced-motion settings.

## Vercel deployment

Import this repository into Vercel using its Next.js preset. Select Node.js 22+ and configure all five environment variables for the intended environment. Apply the migration and private Realtime settings to that environment's Supabase project before inviting players. Use HTTPS; no custom WebSocket server is required. Run the checks and the two-device acceptance test against the preview deployment, then promote it. No deployment is performed by this repository itself.

## Next phase

AI generation and special rounds remain future work.

## Toolchain notes

Development and production builds explicitly use the supported Webpack builder because Turbopack’s worker port binding is restricted in the implementation environment. The optional macOS ARM64 Rolldown binding fixes an npm optional-dependency installation issue; other platforms use Vitest’s normal platform dependencies. A scoped `minimatch` override updates the ESLint dependency chain to the patched 11.x release.

## Original Phase 1 verification (historical)

- TypeScript strict check: passed.
- ESLint: passed without warnings.
- Vitest: 41 tests passed across PostgreSQL, validation/service, and HTTP security suites.
- Production build: passed using Webpack; all requested routes compiled.
- Dependency audit after the scoped lint-toolchain fix: zero known vulnerabilities reported.
- Local HTTP smoke checks: landing, host, and join pages returned 200; unconfigured room creation returned 503; missing participant credentials returned 401; a cross-origin mutation returned 403.
- Supabase credentials were not available. Hosted migrations, live concurrency testing, WebSocket delivery, and two-device acceptance remain unverified until the project is configured.
- Browser-control tooling failed during preview setup. Desktop/mobile visual inspection and interactive browser acceptance remain to be performed. The local preview server was stopped after HTTP verification.

## Lobby reliability fixes

See [Phase 1 stabilization](docs/phase-one-stabilization.md) for root causes, the new client/channel lifecycle, LAN development setup, regression coverage, and phone/two-browser retest instructions. Use `npm run dev:lan` for local phone testing.
