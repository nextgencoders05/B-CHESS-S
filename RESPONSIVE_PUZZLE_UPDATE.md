# Responsive moves, premoves, friend requests and puzzle journey

Source: the uploaded B_Chess_Multiplayer_Update.zip. This is an update of that source, not a rebuild.

## Install this update

1. Keep a backup of your current website files.
2. In the SAME Supabase project used by config.js, open SQL Editor and run only `supabase/friend_requests_update.sql`. It adds an authenticated friend-request RPC and protects friend/request fields from direct client writes. It uses the existing profile documents and preserves existing friends, pending requests and other saved data. It is safe to run again.
3. Extract this ZIP. Upload the contents of `B-CHESS-S-main` to your website repository's existing publishing folder, replacing matching files. Do not put an extra nested folder around index.html. Include the new interaction-update.js and interaction-update.css files.
4. Wait for your usual GitHub Pages deployment, then reload the app. For an already-open installed app, close and reopen it or refresh. The service worker cache version was updated.
5. Test with two different signed-in accounts before treating this release as live-multiplayer verified.

No Edge Function was changed. Do NOT redeploy bchess-secure for this update. Do NOT rerun schema.sql or older migrations. Existing project configuration, credentials, storage policies, puzzle database functions and game-validation backend remain as provided.

If your database differs from the uploaded source's migrations, check the SQL migration against that database before applying it; this work did not access your live database.

## Changes

- Local online moves previously waited for the secure request AND subsequent room fetch before advancing visually. A locally legal move now previews immediately. Game history, clocks, captures and result authority still commit from the server. Input is guarded while submission is pending; stale shorter histories are ignored, and rejected/timed-out previews roll back. Realtime confirmation can recover a move whose HTTP acknowledgement failed.
- Settings now includes Premove, initially Off, persisted alongside the existing browser settings. Quick Match human games, Friends and bot games support a single queued move, click/tap or drag input, clear source/destination highlighting, Cancel premove, replacement, Escape/right-click cancellation and promotion choice. The queued move is legally rechecked after the opponent moves and uses the normal submission path. Puzzles and Analysis do not use premoves. Tournament gameplay is unchanged.
- Friend requests were attempting cross-user writes blocked by database authorization. The new RPC sends, accepts or declines requests atomically under the authenticated user's identity. It deduplicates requests, locks both profiles consistently, rejects stale request actions and updates reciprocal friendship records.
- Incoming requests use a normal-flow top banner so the board and audio controls are not covered. It shows sender details, Accept/Decline and a 10-second countdown. Unanswered requests remain pending in the bell; existing Friends request lists also support Decline. Existing challenge handling remains intact. Realtime updates have a lightweight visible-page refresh fallback; previously shown request IDs are remembered per account/browser.
- Published puzzles appear on a teal-and-gold scrolling journey: actual stage IDs, existing unlock logic, numbered nodes, completion marks, chess-piece current-stage marker, completion pulse, marker transition and subtle cloud motion. Current stage brings the marker into view. Reduced-motion preferences suppress animations. Stage list redraws only when its data/selection changes.
- Puzzles retain drag-and-drop and now have selected-square highlighting, click/tap selection, reselection/deselection and duplicate drag/click suppression. Both input paths use the original puzzle validator, replies, promotion, hints and completion saving.

## Verification actually performed

JavaScript syntax checks passed for changed runtime scripts.

`cd tests` then `npm install` and `npm test` runs the included automated tests. The full local suite passed:

- Existing DOM/settings/navigation, theme persistence, admin close and review tests.
- Existing mocked Quick Match 30-second fallback, cancellation, time controls and increment tests.
- Existing puzzle import, legal/incorrect move, automatic reply, saved completion/unlock and resume tests.
- Existing SQL regression tests using embedded PostgreSQL (PGlite), including puzzle IDs/progress, hints, admin deletion and tournament rules.
- Existing secure move-rule tests.
- New controlled-network DOM tests: immediate online board preview, unchanged authoritative history until acceptance, duplicate submission guard, stale history, rejection and 15-second timeout rollback.
- New premove tests: opt-in persistence, click and drag input, cancellation, replacement, invalid discard, promotion and bot/online submission paths.
- New 100-stage map tests with explicitly mocked puzzle RPC data: selection/reselection/deselection, solution submission, current marker and completion identity after deleting a stage.
- New mocked friend-subscription UI tests: popup, countdown expiry, bell persistence, duplicate suppression, Accept/Decline and account reconnect.
- New SQL tests: migration applied twice, authentication, protected friendship fields, request deduplication, persisted inbox, stale-action rejection, reciprocal accept, decline and preservation of existing history.

The supplied older DOM test expected seven sidebar entries and an obsolete match-found element. The source already has nine entries and a match-found toast. These expectations were updated to match the supplied app, and fixture readiness now waits for DOM initialization instead of a fixed sleep.

## Not verified / requires your deployment

- Real two-account Quick Match and Friends move synchronization, network latency and server clock accuracy.
- Live friend-request Realtime delivery across devices, simultaneous multi-session actions and offline return using your Supabase instance. The database and transport were tested locally/mocked, not against production.
- Physical Android/iOS touch input, drag gestures, sound, promotion UX and reconnect behavior.
- Desktop/narrow-mobile visual layout, overflow, square geometry and animation smoothness in a real browser. A Chromium test was prepared for 1440, 390 and 320 px, but browser launch failed in this environment (socket permission denied). No visual browser pass is claimed. DOM tests at desktop/mobile configurations do not prove rendered geometry.
- A browser test is included as `tests/browser-update.cjs`. It needs Playwright and an installed Chromium; run `npm install --no-save playwright`, `npx playwright install chromium`, then `npm run test:browser`. CHROMIUM_PATH can select an existing browser. It uses mocked data and does not sign into live accounts.

Live smoke test: enable Premove in Settings; play a human Quick Match and Friends game, queue/cancel moves and test reconnect; send a friend request and wait 10 seconds before accepting it from the bell; open Puzzles, solve by tap and drag, reopen and confirm saved progress. Test narrow phone widths and promotion dialogs before release.

## Scope review

Runtime changes are limited to script.js, puzzles.js, index.html, sw.js, and the new interaction-update.js/CSS. One friend-request SQL migration and test/documentation files were added. Other existing files are unchanged, including config.js, voice/WebRTC implementation, Edge Functions, bot engine configuration, matchmaking, puzzle solution/SQL logic, tournaments and theme assets. No Vada Chennai characters or dialogue audio were added.
