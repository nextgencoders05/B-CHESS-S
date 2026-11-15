# Apply this update to your existing B Chess project

Use this guide for the new update. `UPDATE_SETUP.md` and `VERIFICATION.md` describe the earlier five-feature release, not this release. Keep your existing Supabase project, Google provider settings, accounts and keys.

## 1. Check usernames first

1. In your existing Supabase project, open **SQL Editor → New query**.
2. Paste and run `supabase/username_preflight.sql`.
3. If it returns no rows, continue. If it lists conflicts, **do not run the migration yet**. Each row identifies the normalized username and the affected user documents.
4. Ask affected account owners to choose different usernames through the existing profile editor. Alternatively, an administrator may update only the agreed username/name fields of those identified `public.rtdb` user documents in Table Editor. Keep their document IDs, authentication accounts, ratings and other fields unchanged. Do not delete accounts or silently rename them.
5. Run the preflight again until it returns no conflicts. Surrounding whitespace and letter case do not distinguish usernames. Users can keep their own unchanged name.

The migration also performs this check and stops before making changes if conflicts remain. If a failed SQL transaction leaves the editor in an aborted transaction, run `ROLLBACK;` before retrying after resolution.

## 2. Run the incremental database migration

The previous `schema.sql` and `five_updates_migration.sql` should already have been applied to this project. Do not replace the database or rerun the old setup as a reset.

1. Open a new SQL query and run the complete `supabase/next_update_migration.sql`.
2. Open another query and run `supabase/theme_storage.sql`.
3. **Success. No rows returned** is normal for these scripts. It means the statements ran; it does not mean every application feature has been tested.

The scripts are rerunnable. They add tables/functions/policies and a username constraint. They do not delete existing users, ratings, matches or puzzle progress. Existing puzzle IDs remain unchanged; old uploads have no batch ID and can still be deleted individually or by selection. Deletion is an explicit admin action with confirmation.

## 3. Deploy the required secure function

**SQL alone is not sufficient for this update.** Tournament moves and theme publication require the included Supabase Edge Function. It verifies the signed-in user, validates moves or image bytes, then calls restricted database functions. The browser cannot submit arbitrary tournament wins or publish unchecked assets.

The most reproducible route is the Supabase CLI, run from the extracted `B-CHESS-S-main` folder:

```sh
npx supabase login
npx supabase link --project-ref YOUR_EXISTING_PROJECT_REF
npx supabase functions deploy bchess-secure
```

Replace the placeholder with your existing project's reference from its dashboard URL. The deployed folder contains **both** `supabase/functions/bchess-secure/index.ts` and `rules.mjs`; keep both files. `supabase/config.toml` keeps JWT verification enabled. The function also verifies the bearer token with `auth.getUser`.

If using the Supabase Dashboard editor instead, create an Edge Function named **bchess-secure**, add `index.ts` and `rules.mjs` with exactly their included contents, and deploy with JWT verification enabled. Do not paste only `index.ts` without its companion file.

Hosted Supabase functions normally provide `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Verify these are available to the function if deployment reports missing configuration. **Never put the service-role key in frontend files or GitHub.** Keep your existing public frontend configuration.

## 4. Upload the updated website

Replace the existing website files with the contents of the extracted project folder, keeping the same hosting layout. With GitHub Pages, `index.html` should remain at your configured publishing root. Commit the included SQL and function sources for reference; GitHub Pages does not execute them.

The service-worker cache version was updated so the new scripts can load. Reload the website after deployment; if an old tab still displays the old header, close it and reopen the page.

## 5. Use the changed features

- **Puzzles:** Admin Dashboard → puzzle management. Confirm an individual deletion, selected stages, or a batch. Player lists refresh while open; deleted active puzzles return to stage selection. Displayed stages close gaps, while progress remains attached to surviving IDs.
- **Hints:** three per signed-in user per IST calendar day. The server locks each user's allowance, uses server time, and charges once per attempt/solution ply. Retrying a stage creates a new attempt. Deleting a puzzle does not refund used hints. Repeated retrieval of the same revealed hint does not charge again.
- **Header:** avatar opens the existing profile editor and Sign Out; Elo remains beside it. Analysis is in the header. The title is **B Chess**.
- **Mobile:** Quick Match, Play, Puzzles and More. More contains Friends, Books and Tournaments. Settings and Theme remain in the header menu. Desktop navigation is otherwise preserved.

### Board and Coins uploads

Admin Dashboard → Theme Management. Give the theme a name, select all required PNG files, inspect the preview, then Publish.

- Board: exactly `light.png` and `dark.png`, the repeating textures for light/dark squares.
- Coins: exactly `wk.png`, `wq.png`, `wr.png`, `wb.png`, `wn.png`, `wp.png`, `bk.png`, `bq.png`, `br.png`, `bb.png`, `bn.png`, `bp.png`.
- Each file: actual PNG, square, **32–1024 pixels**, at most **512 KB**. Transparent piece backgrounds are recommended. ZIP/SVG/HTML uploads are not supported.
- The browser decodes and normalizes each image. The secure function checks PNG structure, CRC, dimensions, compressed pixel data and scanlines. Only complete validated sets are published.
- Drafts use the private `bchess-theme-drafts` bucket. Published immutable PNGs use `bchess-themes`. Only an authorized admin may upload drafts; only the secure function may publish assets/catalog entries. The policies leave other buckets unchanged.
- Players see published entries under Menu → Theme → Board/Coins when opening the menu (and periodically while it is open). Selections persist independently. Existing board/piece defaults remain available. Use preview to ensure sufficient contrast and recognizable pieces.

### Tournament format and operation

This release implements **single round-robin**, for **at least 2 players**. There are no unsupported format options. Every pair plays once. With an even player count there are N−1 rounds; with an odd count there are N rounds and each player gets one rest bye. Rounds advance after every real game in the current round finishes.

1. Admin Dashboard → Tournaments: enter name, Blitz/Rapid, exact minutes and increment, registration opening/closing, and scheduled start. All form dates/times are **IST (Asia/Kolkata)**; the server stores timestamps.
2. Save as draft or publish. Edit only before play starts. Players join during the registration window through mobile More → Tournaments. Duplicate registrations are ignored; registration closes at the configured server timestamp.
3. At or after the scheduled start, press **Start**. Starting is an explicit admin action, not a background scheduler. It requires two players and rejects conflicting active human matches/tournaments. Players should keep the tournament page open.
4. Each round allows 60 seconds to connect. Clocks begin when both players have connected. Heartbeats run every five seconds. A player absent for 60 seconds forfeits; both absent means a double forfeit. Server clock expiration takes priority over disconnection. Returning after the deadline cannot undo a forfeit.
5. Legal moves, promotions, checkmate and automatic chess.js draw conditions are verified by replaying the stored moves in the secure function. Draw offers must be accepted by the opponent. Resignations, clocks, increment, result versions and standings are handled by the server. Moves/results cannot be committed directly by browser accounts.
6. Win = 1 point, draw = ½, loss/double forfeit/rest bye = 0. Rest byes score zero because every player plays the same number of opponents. Ties use number of wins, then earlier registration timestamp, then user ID for deterministic ranking. The first final row is the winner. Tournament points do **not** change Elo.
7. The last completed round automatically finishes the tournament. Finish also validates that all rounds are resolved; it does not invent results for unplayed games. Cancel stops unfinished games and shows Cancelled to registered players.

Timeout/disconnect adjudication runs on server requests from the polling tournament page. With nobody connected, state is reconciled on the next view/action using persisted server timestamps; this release does not require a background cron job. No analysis recommendations or quality badges appear during live tournament play.

## Move-quality rules

Badges use a separate Stockfish 10.0.2 worker (the existing CDN engine version), MultiPV 2, target depth 14 with a 900 ms time budget per position. They run asynchronously and do not block moves or clocks. The achieved depth depends on the device; this is an approximate engine assessment, **not Chess.com's algorithm**.

The engine evaluates the position before and after a move. Scores are from the side-to-move perspective. For a move other than the engine's top choice, loss = max(0, before score + after score), in centipawns. The top choice gets loss 0 to avoid penalizing the engine's own recommendation for differences in search horizon.

- Brilliant `!!`: top choice; at least depth 12 in both searches; the opponent's principal reply captures the moved piece, whose value exceeds the captured material by more than a pawn; starting evaluation below +5 pawns and resulting mover evaluation at least −0.5. This is a conservative sacrifice heuristic.
- Great `!`: top choice; at least depth 12 in both searches; second choice scores below −0.5, top choice at least −0.5, with a gap of at least 1.5 pawns.
- Otherwise: loss ≥200 = Blunder; ≥90 = Mistake; ≥40 = Inaccuracy; engine top choice = Best; loss ≤20 = Excellent; remaining moves = Good.
- Mate scores are represented by ±100000 cp for classification. Terminal draw = 0. Brilliant/Great are not awarded merely for following a stored puzzle solution.
- A legal non-solution puzzle move is rejected with “Not the intended solution — try again,” independently of move quality. Evaluation failures display an unavailable message, not a fabricated badge.
- Results belong to a specific board/move request and are discarded when obsolete. Badges appear at the current destination square, with one short animation and reduced-motion support.

## Verification before public use

Read `NEXT_VERIFICATION.md` for tests actually performed and the remaining live checks. In particular, complete the Edge Function deployment, test with two real accounts, and verify Google sign-in and voice chat on your devices. A successful SQL message alone does not verify those services.
