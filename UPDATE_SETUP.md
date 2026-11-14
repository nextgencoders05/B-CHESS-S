# Applying the five updates

Use the files in this folder to replace the existing website files. Keep your existing Supabase project and Google sign-in configuration. `config.js` is unchanged.

## 1. Run the migration in your existing Supabase project

1. Open **Supabase → your existing project → SQL Editor → New query**.
2. Open `supabase/five_updates_migration.sql` from this ZIP and copy the entire file.
3. Paste it into the SQL Editor and click **Run**.
4. A successful run may say **Success. No rows returned**. That is expected.
5. Deploy all updated website files, then refresh the site.

For an existing project, run only the migration above. It expects the original `supabase/schema.sql` to be installed already. For a completely new database, run the original schema first, then this migration. If you ever rerun the original schema, rerun this migration afterward because it replaces the old Quick Match permissions.

The migration is transactional and safe to rerun. It adds search-session, puzzle and progress tables plus authorized RPC functions. Existing profiles, rooms, materials and Google sessions are retained. Every puzzle publication checks the existing `admin_require()` authorization. Progress can only be read for the signed-in user and written through the completion function. No service-role key is needed in the browser.

Old clients must refresh after deployment. The original Quick Match join/cancel endpoints are disabled so they cannot bypass the new atomic cutoff. The new flow polls the authorized server endpoint every two seconds, ends searching at 30 seconds and resolves any in-flight pairing before starting a bot. If the server cannot resolve the queue, it shows an error rather than risking two games. An already-assigned human match takes priority, including a cancellation that arrives after assignment.

## 2. Settings and Theme

- Header **☰ → Settings**: Sound and Engine Arrows toggle independently.
- Header **☰ → Theme**: choose Board and Coins independently.
- Included board choices: Green & White; Wood & Cream.
- Included coin choice: Classic, using all twelve supplied local PNG assets.
- Preferences persist on this browser/device after refresh. Theme changes do not reset the board, orientation, clocks or move history.
- Additional board/coin packs are not included because none were supplied. Add future complete packs to the corresponding category; do not publish incomplete piece sets.
- Voice chat controls remain in their match locations.

## 3. Admin dashboard

Use **Ctrl + ↑** or tap the header pawn logo five times within three seconds. Verification still uses your existing authorized Google account. The top-right **×** closes the dashboard without signing out or changing the active match.

## 4. Publish puzzles

Open **Admin Dashboard → Puzzles**.

For PGN, select **PGN**, then paste games or upload `.pgn` files. The game's initial position and main line become the puzzle and solution. Use standard `[SetUp "1"]` and `[FEN "..."]` tags for a nonstandard starting position. Variations are not alternative accepted solutions. Separate games with standard PGN headers/results, or a line containing `---`.

For a single FEN, select **FEN + solutions**, paste all six FEN fields, and put the solution in the separate input. SAN (`e4 e5 Nf3`) or UCI (`e2e4 e7e5 g1f3`) moves are accepted. FEN alone is not a solution.

For bulk FEN, use one entry per line:

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 | e2e4 e7e5 g1f3
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 | d2d4 d7d5 c2c4
```

Or upload/paste a JSON array:

```json
[
  {"fen":"7k/8/8/8/8/8/4K3/8 b - - 0 1","solution":"h8g7 e2e3"}
]
```

Click **Validate & preview**. Invalid entries have an explanation. New valid entries receive consecutive proposed stage numbers in input order. Click **Publish valid stages**. Up to 1,000 entries per import and 5 MB per uploaded file are accepted. If another admin publishes meanwhile, final stages are allocated safely after that import; refresh the preview for the current numbering.

Import identity uses the normalized FEN, solution and occurrence within the batch. Repeating the same import skips existing stages. Repeated identical entries within a single batch still represent separate ordered stages. The client checks chess legality before preview/publication; the server checks admin authorization and canonical payload shape. Only trusted admins can publish.

## 5. Play and resume

Choose **Puzzles** in the main navigation. Sign in to save progress. Complete Stage 1 to unlock Stage 2, and continue in order. Opponent replies in the supplied solution play automatically. Incorrect moves are undone with retry feedback. Completing a stage saves progress to Supabase, so the same Google account resumes on another device. If saving fails, the error is shown; use **Retry stage** after connectivity returns.

No Tournament changes are included.
