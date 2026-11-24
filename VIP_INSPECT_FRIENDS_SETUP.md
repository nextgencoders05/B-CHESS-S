# B Chess 1.0.1 deployment

1. In the existing B Chess Supabase project, use **SQL Editor** to run the entire `supabase/vip_inspect_friends.sql` file. This assumes `supabase/multiplayer_sync.sql` and `supabase/release_tools.sql` are already installed. For projects missing those updates, follow their existing setup instructions first, then apply this migration last. The migration can be rerun and keeps existing accounts, VIP assignments, rooms, and messages.
2. Publish the contents of `B-CHESS-S-main` to the existing hosting directory, including `icons/vip-badge.png`. Reload the app on both devices or choose **Update Now** when the app offers version 1.0.1.
3. The existing `bchess-secure` Edge Function handles legal moves and voice signaling. An already deployed copy from the multiplayer update needs no redeploy for 1.0.1. If the project still lacks that function, follow `MULTIPLAYER_UPDATE.md`.

## Hosted verification

Use two regular signed-in test accounts and an admin account. On a phone, search for the VIP player with the keyboard open and tap **Inspect Profile**. Have the VIP player create a **Play with Friends → Rapid** room, join by code from the phone, and play one move per side. Confirm both devices display the correct badge and the 10-minute clock. Send a chat message each way, close and reopen **Chat**, and check that each message appears once. Remove VIP from a test account in **Admin → VIP Profile → Current VIP Members**, then check the count and the open profiles and board on both devices.

## Local verification completed

- The existing `npm test` suite passed.
- The original Inspect permission issue and Rapid guest admission rejection were reproduced against the supplied SQL. The updated migration ran twice successfully. A local PostgreSQL fixture checked the signed-in and admin permissions, a pre-existing room, and No Timer, Bullet, Blitz, and Rapid admissions.
- Desktop and 320 px touch Chromium sessions used two seeded player identities and a separate admin against the local database. They checked Inspect in a shortened viewport, VIP profiles and both board badges, reduced motion, mobile badge geometry, Vada Chennai, Rapid clocks and legal moves, two-way saved chat, chat reopening, and successful and failed VIP removal. The local test supplied realtime events from its database fixture. Hosted Google sign-in, Supabase Realtime, and physical-device checks remain for deployment.
- A second browser session rejoined the same match and loaded both saved messages once each. An existing Blitz invitation URL admitted the intended guest.
