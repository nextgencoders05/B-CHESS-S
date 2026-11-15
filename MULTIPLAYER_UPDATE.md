# B Chess multiplayer update

## Deployment

1. Open the existing project in Supabase SQL Editor. Copy and run `supabase/multiplayer_sync.sql` from this ZIP once. This migration assumes the project's existing base, Five Updates, and Next Update schema have already been applied.
2. From the extracted project folder, run `supabase functions deploy bchess-secure --project-ref YOUR_PROJECT_REF`. This updates the existing Edge Function with the move validator and room member ICE endpoint.
3. For voice across restrictive networks, use working TURN credentials from the existing relay provider. In Supabase Edge Functions → Secrets, set `BCHESS_TURN_ICE_SERVERS` to the JSON array of ICE servers from the provider dashboard, including its TLS endpoint on port 443. Use relay credentials intended for browser ICE, never a provider API key or a Supabase service key. Without this secret the app uses its shared Open Relay fallback, whose uptime and reachability are outside this project.
4. Upload the contents of `B-CHESS-S-main` to the same GitHub Pages publishing folder as the old website files. Keep `quick-match-loop.mp4` beside `index.html`. Reload both players' tabs after publishing and start fresh rooms so both clients use the same signaling protocol.

The move endpoint validates chess moves from the recorded history, commits one ply at a time, and publishes the saved room to both players. Join, clock start, and results use scoped RPCs because the existing database denies browser writes to these fields. Existing saved games remain available in History.

## Live checks to perform after deployment

- On two signed-in accounts, play multiple moves in a human Quick Match and a newly created Friends room. Test both directions, board orientation, promotion, clocks and increments, and a completed game's result and history.
- Put one device on Wi-Fi and the other on mobile data. Enable both mics, speak in each direction, then toggle mute and speaker. For relay verification, confirm the selected candidate pair reports a relay candidate in the browser's WebRTC diagnostics.
- On desktop and a narrow phone, open Modes, start a search, check the video sizing and Cancel, then test a human assignment and the 30-second bot fallback.

## Local verification

PostgreSQL fixture checks passed for joining, clock start, move commits and opponent reads in both modes, increment, rejection of stale or unauthorized moves, result and history, and cancellation after pairing. Desktop and mobile DOM fixtures checked Modes, time card selection, inline video attributes, cancellation, the 30-second bot transition, human assignment, move replay and orientation, and mute and speaker state. The MP4 decoded successfully. Chromium could not launch in this environment, so the rendered layout and autoplay were not verified in a browser. Hosted Supabase Realtime and audio across separate networks still require the live checks above.
