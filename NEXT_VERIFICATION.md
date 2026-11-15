# New update: changes and verification

This report applies to this ZIP. Earlier verification documents are retained as historical project files.

## Changed areas

- Admin puzzle previews, individual/selected/batch deletion, stable IDs and consecutive displayed stage numbers.
- Puzzle turn/status banner and server-limited IST daily hints.
- Engine-backed move-quality badges in puzzles, Analysis and existing/PGN game review.
- Compact avatar/Elo header, header Analysis shortcut, B Chess title and mobile More navigation.
- Database-enforced normalized unique usernames with duplicate preflight.
- Persistent admin-uploaded board textures and complete twelve-piece sets.
- Single round-robin tournaments with authoritative move verification, clocks, registration, pairings, results and standings.
- Incremental SQL, theme storage policies, secure Edge Function and cache version update.

## Local checks performed

Automated checks use the actual project scripts and SQL. Browser behavior tests use JSDOM with controlled backend responses, not a real browser or deployed service. Database tests use PGlite PostgreSQL with an auth/storage metadata fixture, not the user's production Supabase project.

- Original and incremental SQL load; incremental migration and storage policies rerun successfully.
- 100-entry puzzle preview/publication, order, repeat-import protection, invalid import rejection, sequential completion and own-progress isolation.
- Admin-only deletion, individual and batch deletion, remaining progress, gap-free stage display and continued unlocking. DOM deletion confirmation/active-puzzle removal paths exercised.
- White/Black turn display, intended move rejection, automatic opponent reply, completion and resume.
- Hints: repeat retrieval, three-use exhaustion, private usage records, five parallel submitted requests yielding only three grants, server-day rollover simulated by moving usage records to the previous server day, and no refund after puzzle deletion.
- Username case/whitespace conflicts, unchanged own username, competing submitted claims, and duplicate preflight stopping migration without renaming accounts.
- Tournament duplicate registration/start protection, three-player round-robin pair coverage/byes, permissions, version conflict rejection, illegal/wrong-side move rejection, increments, draw offers/acceptance, resignations, round advancement, final standings, timeout, disconnect, double forfeit and cancellation.
- Edge pure rules: replayed checkmate, repetition draw, position-integrity checks, valid PNG decoding and invalid file/CRC/truncation/dimension/pixel-data rejection.
- Storage policy syntax and admin/private/published permission behavior against a PostgreSQL metadata fixture; published theme catalog visible to another user.
- DOM fixtures at desktop/mobile widths: Settings persistence, board state/orientation preservation, admin close without sign-out, compact profile/menu, PGN review, incomplete coin-set rejection, published theme choices, independent saved selections, and tournament registration/gameplay transport using controlled backend responses.
- Badge classification thresholds, controlled UCI stale-result rejection, destination-square attachment after orientation change, and suppression during tournament play.
- Actual downloaded Stockfish 10.0.2 worker exercised through the badge pipeline for before/after evaluation and destination-square badge output. This is a Node worker integration check, not a phone performance or rendering test.
- Quick Match controlled interactions: immediate search, duplicate tap guard, 30-second bot fallback, nearest available Elo, Bot name, both clock increments, cancellation including delayed cutoff response, and a human result winning cutoff resolution. Bot result panel and New Quick Match action exercised.

Run the bundled tests with Node 22+:

```sh
cd tests
npm install
npm test
```

Optional real-engine check: download the existing CDN's Stockfish 10.0.2 JS, then run `STOCKFISH_JS=/absolute/path/stockfish.js node real-engine.cjs` from `tests`. The engine binary is not newly bundled in this ZIP.

## Not verified live

- **Desktop/mobile visual rendering:** Chromium launch was attempted but the workspace rejected its socket operation. JSDOM assertions do not prove layout, animation appearance, tap-target geometry, safe-area behavior or lack of overflow. No screenshot verification is claimed.
- Production Google OAuth, voice-chat media/permissions, two-account human matches, live Supabase Realtime and cloud match-history persistence.
- Edge Function deployment/auth gateway, real Storage uploads/downloads and CDN delivery on the user's account.
- True multi-connection PostgreSQL lock contention, cross-device hint synchronization, and an actual midnight IST boundary. Submitted-request tests use a single local PostgreSQL instance and simulated previous-day records.
- Full multi-device tournament play over the network, promotion dialog on touchscreens, background-tab disconnection behavior, and all real-device engine performance cases.

## Live acceptance checklist

1. Apply the preflight/migrations, deploy the secure function, then sign in as an admin and as a separate player.
2. Import puzzles; delete one, multiple selected entries and a whole batch. Leave a deleted puzzle open on the second device and verify the message/return to stages. Check remaining completed stages and next unlock.
3. Use three hints across devices/tabs; retry an already-revealed hint; refresh/sign out/in; verify no fourth grant. Check midnight IST reset with server time.
4. Upload complete Board/Coins PNGs; reject wrong files, oversize, missing pieces and non-admin upload attempts. Confirm publication on the second device and independent persisted selections during an active match.
5. Try conflicting username claims concurrently and unchanged own username. Confirm only one account can claim the normalized name.
6. Conduct two- and three-player tournaments. Check registrations, schedule, pairings/byes, clocks/increments, promotion, resign/draw/checkmate/timeout, disconnect/reconnect, cancellation, rankings and final winner. Try duplicate moves/results and confirm rejection.
7. On a narrow phone and desktop, inspect header/profile, More menu, safe areas, board/promotion/actions, badge colors/position/animation and reduced motion. Check no live competitive analysis assistance appears.
8. Recheck Google sign-in, admin close/session retention, voice in both directions, Quick Match human pairing and cutoff/cancel behavior, bot result and New Quick Match.

## Existing issue found, intentionally not changed

The supplied `supabase/schema.sql` protects legacy room fields (`gameFen`, `gameOver`, move history, clocks/results) and profile ratings from client writes. The supplied legacy multiplayer/bot-result code still attempts some such client updates. Depending on the policies/functions actually deployed in the user's database, human move synchronization and result/rating writes can therefore fail with “Protected room field” or “Profile rating is server-managed.” This conflict existed in the source ZIP. It was not relaxed or repaired because unrelated fixes were explicitly excluded. The new tournament implementation uses separate tables and a trusted move-verification function instead.

The original Google auth, voice code and legacy gameplay are otherwise preserved. Local mocked regressions are not evidence that this existing deployment conflict is resolved.
