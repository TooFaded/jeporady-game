# Phase 1 lobby stabilization

## Findings and changes

### Host roster and live synchronization

The installed Supabase SDK passes an access-token callback from Supabase Auth to Realtime. Its callback remains the source of truth during connect/heartbeat/reconnect, even after `setAuth(customToken)`. Our previous client had no Supabase Auth session, so it could replace the room JWT with the public API key. Private channel authorization then failed. This is documented in [Supabase's setAuth reference](https://supabase.com/docs/reference/javascript/setauth) and confirmed in the installed SDK source.

There were additional lifecycle faults: `hasChannel` stayed true after errors, pending refreshes were dropped, and initial fallback polling called `connect()` rather than independently refreshing state. If token acquisition stalled, `connecting` prevented both reconnect and the fallback read. The old label claimed backup sync was active without knowing whether state requests succeeded.

`RoomSync` now serializes authoritative heartbeat/state reads, queues another read when an event arrives during one, and polls every 10 seconds regardless of transport setup. Broadcast and Presence events trigger the same server read. Failed channels are removed and recreated on a subsequent refresh. Visibility/online events request an immediate refresh. Old lifecycle responses and channel callbacks cannot update a replacement lifecycle. Status distinguishes successful backup synchronization from an API interruption.

The room-scoped client supplies `accessToken` directly, using the same cached room JWT for SDK refreshes and explicit authorization. The app renews that token after 30 seconds, well before its 60-second expiration. Each room owns its own token provider and client. Membership, roles, and scores still come exclusively from the authorized server response; Presence is only a refresh signal.

### Phone joining and sessions

The previous form could submit natively before hydration, which reloads the nickname page instead of executing its JavaScript join handler. This matches the reported form-reset symptom. The installed Next.js version blocks dev-only assets from unlisted origins, and no LAN allowlist was configured. `next.config.ts` now adds this machine's actual LAN IPv4 addresses to `allowedDevOrigins`, without a wildcard or relaxing API origin checks. The form stays disabled until hydrated, so failed JavaScript loading cannot masquerade as a successful join. Restart dev after switching Wi-Fi networks.

The previous client also assumed a 201 meant the browser had stored its cookie. It now makes a second same-origin, cookie-authenticated `/state` request before navigating. If that fails, it displays an explicit session-persistence error and does not navigate. A transient verification failure retries verification rather than creating another room/player. API requests explicitly include same-origin credentials and use AbortController with a normal timer instead of requiring newer `AbortSignal.timeout` browser support.

Development cookies remain HttpOnly, SameSite=Lax, path `/`, and host-only. Production cookies remain Secure. Production HTTP now fails before creating a room/player, explaining that HTTPS is required; it never downgrades Secure cookies. Cookies for `localhost` do not belong to a LAN IP and cannot be transferred by changing the URL. Use the same LAN origin throughout a phone test, and create a new host room there. The QR/link uses that origin.

The LAN API flow and cookie replay are verified by integration tests. A physical phone's hydration, cookie acceptance, privacy settings, and navigation have not been automatically observed, so the exact cause on the originally reported handset remains unconfirmed. Chrome automation's tab inspection currently fails with a tooling error.

### Multiple GoTrueClient warning

`createClient()` inside the old effect created a new Supabase Auth client on each mount/effect replay (including React Strict Mode), with the same default storage key. `persistSession: false` does not prevent constructing GoTrueClient or its duplicate-instance warning.

The replacement uses Supabase's custom `accessToken` option, which bypasses GoTrueClient construction entirely, appropriate for our own HttpOnly room sessions. A per-room store reuses its client; subscribers share one channel and timer. Cleanup is serialized before Strict Mode resubscription. No global token is shared across rooms, and no service-role key is imported into browser code.

### Heartbeats after leaving

Previously the leave handler waited for router navigation to unmount the hook; meanwhile polling continued, fetches were not abortable by the hook, and 401 responses were treated as retryable errors forever.

Leaving now pauses synchronization before sending `/leave`: timer cleared, pending HTTP requests aborted, token cleared, channel detached. A failed leave resumes synchronization. Unmount performs the same cleanup. HTTP status is preserved by `ApiError`; 401 and 404 terminate synchronization, clear the private roster, and show the session error. Network failures remain retryable. A request already processed by the server can still finish during cancellation, but its response is ignored and repeated unauthorized polling stops.

## Verification

Verification completed on November 12, 2026: TypeScript, ESLint, all **63 tests**, and the production Webpack build passed. The live test passed over the Mac’s LAN address with three isolated cookie jars and separate host/player private Realtime subscriptions, including delivery after an SDK heartbeat refresh. The configured service-role key, JWT signing secret, and rate-limit salt were absent from all production browser JavaScript files. Physical phone/browser UI acceptance remains a manual step because browser automation could not inspect the tab.

- Unit/integration suites execute real PostgreSQL migration logic, HTTP handlers, cancellation-aware API requests, room lifecycle transitions, and the actual Supabase SDK custom-auth initialization.
- Lifecycle regression coverage includes independent host/player stores, join/leave broadcasts, coalesced in-flight changes, a stalled token request, channel errors, shared subscribers, Strict Mode replay, cancellation, terminal 401/404, network recovery, and callback-token renewal.
- HTTP tests cover LAN-origin cookie attributes, production HTTPS enforcement before mutations, Secure production cookies, and preserving an existing host session on a join attempt.
- `scripts/test-lobby-live.mjs` exercises separate cookie jars against the running app and configured Supabase project. It creates only its own clearly named test room and closes it in `finally`. It verifies real private Broadcast delivery, state consistency, session persistence/reuse, channel recreation, SDK heartbeat authentication, role isolation, and revoked-session rejection. This is API/WebSocket integration coverage, not a substitute for browser cookie acceptance or UI automation.

Run local checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

With the development app running, run the live test:

```sh
node --env-file=.env.local scripts/test-lobby-live.mjs
# Mac Wi-Fi LAN test (en0, port 3000):
TEST_LAN=true node --env-file=.env.local scripts/test-lobby-live.mjs
# Or an explicit origin:
TEST_ORIGIN=http://YOUR_MAC_IP:3000 node --env-file=.env.local scripts/test-lobby-live.mjs
```

The script respects the app's creation/join rate limits. It deliberately sends one heartbeat after an explicit player leave to assert 401; that single test request is not the app's heartbeat timer. Test rooms are cancelled, not silently deleted from the database.

## Retest on a phone and two browsers

1. Stop the existing dev server and restart with `npm run dev:lan`. Do not use `npm start` over LAN HTTP; production requires HTTPS.
2. Run `ipconfig getifaddr en0`. On the Mac and phone, open `http://YOUR_MAC_IP:3000`. Both devices must be on the same Wi-Fi and the Mac firewall must permit the dev server. If the port changes, use the printed port everywhere.
3. In browser A on the Mac, create a new room. Wait for **Live connection**. In browser B (a different browser or private profile), join with a different nickname. Then join on the phone, using the host's QR/link. Separate ordinary tabs in one profile share the same room cookie and therefore the same participant.
4. Confirm all rosters show both players without reload. A temporarily unavailable socket should show **Backup sync active**, and membership should still update within approximately 10 seconds after a successful API request. The form must not submit while it says **Loading secure form…**; if it remains there, inspect dev-asset errors and restart the dev server with the current LAN address.
5. Reload a player page. The same nickname/player ID should remain; no new player is created. Navigate back to join in that same profile and confirm it resumes the existing seat. The host must remain the host in browser A.
6. Disable the phone's network, wait about 55 seconds, then restore it and foreground the page. The host should mark the player reconnecting, then ready again. The room roster should recover and private live synchronization should resume.
7. Leave from browser B while watching its Network panel. Pending calls may be cancelled, but recurring `/heartbeat` or `/token` calls must stop. The host should see the departure. Close the room as host and verify the other participant stops polling after receiving its session error.
8. If joining fails, record the visible error and the join/state HTTP status codes, browser/version, and URL hostname. Do not share cookies, JWTs, service keys, or `.env.local` contents. A successful join followed by a failed `/state` specifically identifies a session/cookie problem; a native page reload without a POST identifies a hydration problem.

No database migration, RLS relaxation, credential rotation, or Phase 2 gameplay change is required for these fixes.
