# B Chess premium interface update

The desktop sidebar uses brass line icons, short captions, and a copper active state. Play retains its robot icon. Desktop Analyze opens from the sidebar, and mobile Analyze opens from More. The search bar, challenges, profile, and Settings/Theme menu stay accessible.

**Club Teal & Ivory** and **Club Classic** are independent Board and Coins choices. Club Classic includes all twelve scalable piece assets. Existing options and saved selections remain available.

The header shows your app-to-Supabase round-trip latency. In human Quick Match, each player shares their latest latency and receives only their opponent’s sample. The bars indicate Good (under 250 ms), Medium (250–649 ms), or Low (650 ms or above). The app marks a peer sample unavailable after 17 seconds, then shows “No network” after 34 seconds without a peer heartbeat while your own connection is working. This indicates lost contact with B Chess, which can also happen when a device suspends a background tab. Fresh samples restore the indicator automatically.

## Deploy

1. In Supabase SQL Editor, run **`supabase/connection_quality.sql`** once in the existing project. This adds an isolated connection sample table and an RPC. It does not write to room documents or change existing policies.
2. Extract the ZIP and upload the contents of `B-CHESS-S-main` to the GitHub Pages publishing folder that contains your current `index.html`. Preserve paths, particularly `pieces/club-classic/`.
3. Commit the upload, wait for Pages to finish deploying, and reload the app.

No Edge Function redeployment is needed. The app shell cache version was updated for the new stylesheet content, connection script, and assets.

## Verification

- Chromium fixtures at 1440, 390, and 320 px checked desktop and mobile Analyze placement, an in-bounds header connection readout, square boards, no initial horizontal overflow, installed piece assets, and independent theme choices and persistence. Changing both selections preserved the test position, orientation, and move history.
- A browser fixture exercised both player perspectives with simulated latency and heartbeat responses. It checked Good, Medium, Low, unavailable, disconnected, and reconnect states, placement after a flip, and hidden opponent indicators in bot games.
- The project regression suite passed. Its PostgreSQL fixture applied the migration twice, verified that both matched players received the other player’s sample, denied outside access and direct reads, and checked that game room data stayed identical.
- A live two-device Quick Match against hosted Supabase, a physical phone, and production service worker rollout remain to be checked after deployment.
