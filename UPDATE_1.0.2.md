# B Chess 1.0.2 deployment

1. On the existing 1.0.1 Supabase project, run **supabase/update_102.sql** in SQL Editor. It expects the original multiplayer and VIP/Friends migrations. It installs functions and new push tables without rewriting previous matches.
2. Generate one VAPID key pair with **npx web-push generate-vapid-keys**. In Supabase Edge Function Secrets set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a contact such as mailto:you@example.com) and PUSH_CRON_SECRET (a long randomly generated secret). Keep the same VAPID pair across releases. REMINDER_TIME_IST is optional, in 24-hour HH:MM format, default 19:00.
3. From the project root deploy **supabase functions deploy bchess-push --project-ref YOUR_PROJECT_REF --no-verify-jwt**. The function validates signed-in users and calls is_admin for broadcasts. The daily endpoint checks the separate cron secret.
4. Enable Supabase Cron (pg_cron), pg_net and Vault. In Vault create **bchess_push_url** with the full HTTPS URL ending in /functions/v1/bchess-push, and **bchess_push_cron_secret** with the same PUSH_CRON_SECRET. Run **supabase/schedule_push.sql**. Each minute the function checks the configured India time and processes up to 40 remaining users after the cutoff.
5. Upload the **contents** of B-CHESS-S-main to the GitHub Pages publishing folder. Keep engine/ and the WASM file together. Use the existing update prompt on a returning device.
6. Sign in on a supported phone, allow notifications, then close the app. In Admin Panel → Messages enter a title and body, preview, and confirm Send to All. Verify reception and tap-through on the phone. Keep the admin panel open during delivery. Retry after a network interruption using the same draft. Acceptance counts indicate push-service acceptance; device display depends on permission, connectivity and OS settings.

## Implementation details

Stockfish 18 Lite single-threaded runs in independent workers for gameplay/analysis and move-quality ratings. Upstream source is https://github.com/nmrugg/stockfish.js/tree/v18.0.0 and the included JS/WASM come from npm stockfish@18.0.0. The license is in engine/LICENSE.

The daily job sends to the most recently registered device per user. Broadcasts target every registered device. Three distinct play dates within the preceding eight days count as regular play. Yesterday is determined in India time. Random reminder selection excludes the previous message. A delivery is claimed before sending. If a process stops with an ambiguous delivery result, it stays unconfirmed to avoid duplicates. Service rejection counts as failed. Endpoints returning HTTP 404 or 410 are removed.

Joined online rooms already rated for checkmate/resignation and the server-assigned Quick Match bot use the existing profile rating. A confirmed Leave deducts exactly eight, including near the normal 100-point floor. A room explicitly marked rated=false skips the deduction. The history entry includes ratingDelta and the history view shows −8 Elo. The Influencer Mode entry is a placeholder.

## Local verification

The existing regression suite passed. Headless Chromium loaded Stockfish 18 and returned a legal best move, opened and dismissed the Modes dialog, launched the Vada Chennai board and played a Quick Match bot move. The badge integration test ran the bundled engine, evaluated both positions and rendered a move badge. Local PostgreSQL-compatible tests exercised repeated human and bot Leave requests, the exact deduction below 100, history storage, opponent ratings, finished and unrated rooms, and daily recipient deduplication.

The admin preview and confirmation, server-side admin rejection, broadcast counts, expired-endpoint cleanup, retry handling and personalized daily messages were exercised with mocked delivery. Chromium installed the service worker and dispatched its notification payload with the OS display mocked. Live Web Push delivery, VAPID settings, the deployed cron job and notification tap-through with the app closed require a configured project and phone.
