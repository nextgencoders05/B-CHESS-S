# B Chess Quick Match and History update

On phones, pick a Bullet, Blitz, or Rapid control and tap Find Opponent. The board appears when the match starts. Desktop retains its Quick Match selector. While searching, both layouts play the supplied square loop inline and show the actual elapsed time beside it. Playback is muted for autoplay. The timer drawn inside the video repeats with the animation.

During Quick Match, Analysis, Game Review and Evaluation are out of the live panel. Desktop keeps Move List, and both layouts retain existing chat and match controls. The existing result actions still open after a completed match.

History is below Books on desktop and inside More on phones. It uses the signed-in account's existing saved records. Choose Review to replay moves and Copy Moves (PGN) to copy them. Records without a saved move list can still be opened, but have no moves to export.

## Upload to GitHub Pages

1. Extract the ZIP and open the `B-CHESS-S-main` folder.
2. Replace the website files with the contents of that folder in your existing Pages publishing directory. Keep the folder structure and put `quick-match-loop.mp4` next to `index.html`.
3. Commit the files. Once Pages finishes deploying, reload the page. If the installed app still shows the old screen, close and reopen it.

This update adds no SQL migration or Edge Function deployment. If your existing site already has the Premium UI connection indicator migration, there is no SQL to run. If you are deploying Premium UI for the first time, its existing connection indicator uses `supabase/connection_quality.sql`. See `PREMIUM_UI_UPDATE.md`.

## Verification

Local tests with simulated database responses covered mobile selection and Find Opponent, desktop time-card search, loop attributes, cancellation, the 30-second cutoff, human and bot transitions, and preserved 3+2 parameters. History tests checked the current account's path, owner checks, recorded opponent display, move replay, and PGN generation. The 720×720 MP4 decoded successfully.

Chromium could not launch in the execution environment. Verify rendered desktop and narrow mobile layouts, actual autoplay, and clipboard access in a browser. Live two-player pairing, real account records, and cross-device sessions require a deployed Supabase test.
