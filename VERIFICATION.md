# Verification results

## Automated checks passed

- JavaScript syntax checks for the changed scripts.
- Interaction tests using the full HTML and application scripts with mocked authentication, database and engine transport, under 1440px and 390px DOM configurations.
- Header menu, independent Sound/Engine Arrows toggles, refresh persistence, Board/Coins storage, active board position and orientation preservation.
- Server-verified admin opening and dashboard close without calling sign-out or changing the current position.
- Six main navigation modes, including Puzzles.
- Immediate time-card search, duplicate-tap guard, no bot before 30 seconds, one fallback after the cutoff, nearest available bot Elo, Bot label, exact 10+5 base time and increments for both colors.
- Cancellation before cutoff; cancellation while cutoff resolution is pending; human assignment returned by cutoff resolution takes priority over bot fallback.
- PGN main-line parsing, bulk PGN, bulk FEN, SAN/UCI solutions, custom black-to-move starting position, invalid position/move feedback.
- Incorrect move retry, automatic opponent reply, stage completion, sequential unlocking, progress reload.
- Real SQL execution in an isolated PGlite PostgreSQL runtime: original schema plus migration, migration rerun, 100 ordered stages, repeat-import deduplication, distinct stage allocation for repeated entries in one batch, unauthorized admin rejection, own-progress RLS, direct progress-write rejection, locked-stage rejection and exact-solution completion.
- SQL matchmaking tests for matching time controls, mismatched controls, cancellation, late retries, bot resolution, assigned-human priority and 10+5 room payload.

## Limits and remaining deployment checks

No production Supabase data or configuration was changed. SQL tests use simulated Supabase auth functions; frontend tests mock network responses. They do not constitute two live Google users playing against the deployed Supabase project or real network concurrency testing.

Visual PC/mobile browser verification could not be completed: local Chromium launch was blocked by the execution environment, and the remote browser could not connect to the local test server. DOM configurations do not verify rendered layout or real touch behavior. No visual pass is claimed.

After applying the migration and deploying, check these in a PC browser and a phone browser:

1. Open/close the verified Admin Dashboard during an active match; confirm the match and Google session remain active.
2. Open the top-right menu and both preference pages; verify tap targets, layout, selected states and persistence after refresh.
3. With two test users, select identical controls and verify human pairing. Select different controls and verify separate searches. Test an opponent arriving just before 30 seconds, fallback with nobody online, cancellation and rapid repeat taps. Confirm only one game starts per search.
4. In a 10+5 fallback, confirm the moving side gains five seconds after each completed move and the result's New Quick Match action preserves 10+5.
5. Import a small PGN/FEN batch with an invalid entry, then 100 valid entries. Check proposed stages, repeat-import behavior, unlocks and resume using the same user on a second device.

## Rerunning the tests

Node 24 or newer recommended. From `tests/`, run `npm install`, then `npm test`. Tests are isolated; they never connect to your Supabase project. The vendored chess.js 0.10.3 and chessboard.js 1.0.0 are the same libraries referenced by the app's existing CDN tags and are used only by the test harness.
