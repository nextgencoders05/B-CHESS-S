B Chess Analyzer — now running on Supabase. **First-time setup: see SUPABASE_SETUP.md.**

B Chess Analyzer — PWA-ready full project

Deploy the CONTENTS of this folder to the root of your existing GitHub Pages repository (not the ZIP itself).
Keep the folder structure, especially pieces/ and icons/.

Included:
- Original chess project files and chess piece assets
- PWA manifest and service worker
- Install banner and install handling
- App icons at 192x192 and 512x512
- Mobile viewport/safe-area support

Deployment notes:
1. Upload/replace the files in the repository root while preserving folders.
2. Enable GitHub Pages for the correct branch/folder.
3. The site must be served over HTTPS for PWA installation/service workers.
4. On Android Chrome, use the Install banner when available, or browser menu > Install app / Add to Home screen.
5. Some browsers decide when to show the native install prompt; a website cannot force it to appear immediately.
6. Third-party chess libraries loaded from CDNs and online multiplayer features (Supabase) may still require an internet connection.


## Mobile app / PWA
This version is optimized for Android and iPhone browsers while keeping the desktop version.
On mobile, the site shows an install card near the top. On supported Android browsers,
the Install button opens the browser's native PWA installation prompt. On iPhone/iPad,
the button explains Safari > Share > Add to Home Screen.

After installation, B Chess opens in standalone app mode without the normal browser tab/address
bar. The manifest, icons and service worker are included. A normal HTTPS deployment is required
for service-worker/PWA installation.


## Update 2026-11-04 — Quick Match, board mic, challenge alerts

> Note: the navigation order and Quick Match described in this section were replaced by the 2026-11-05 update below.

- Navigation order: Vs Bot, Friend, Analyze, Books.
- Mic ON/OFF button next to each player's name and Elo on the board. Your own bar toggles your mic;
  the opponent's bar shows their live mic status (stored at rooms/{code}/mic/{uid}).
- Incoming challenges pop up immediately with the challenger's name, Elo, time control, a message and
  Accept / Decline buttons. When the app is in the background, a browser/PWA notification is shown too;
  tapping it opens the challenge (its Accept / Decline buttons act directly).
- When you send a challenge, the board shows "Challenge sent to [name]" with their Elo, the time control
  and "Waiting for opponent to accept..." right away.
- Quick Match (Friend > ⚡ Quick Match): pick Rapid / Blitz / Bullet, then the app searches for an online
  player with the same time control and a similar Elo (±50, widening to ±400). If nobody is found within
  about 25 seconds, the game starts against an engine opponent shown as a regular player.
- The service worker now loads pages/scripts network-first, so a new deployment appears on the next load.

Quick Match data lives in Supabase (see SUPABASE_SETUP.md).
Signed-in users must be able to read `matchmaking/{timeControl}` and write entries there. Example:

    "matchmaking": {
      "$tc": {
        ".read": "auth != null",
        "$uid": { ".write": "auth != null" }
      }
    }

Without this, Quick Match still works but always ends up with the engine opponent.

Note: browser notifications reach a player while the app/tab is open (including in the background).
Notifications when the app is fully closed would need a push service and a server.


---

## Update 2026-11-05 — Quick Match page, Other Learning Materials, hidden Admin panel

### What's new
| Feature | Where |
|---|---|
| **Quick Match** as its own page, first in the navigation (Quick Match → Play → Friends → Analyze → Books) | `features.js`, `features.css`, `index.html` |
| Time controls: Bullet 1+0, 2+1 · Blitz 3+0, 3+2, 5+0 · Rapid 10+0, 10+5, 15+10 · Classical 30+0 (increments supported) | |
| Server-side matchmaking (Supabase SQL functions), cancel, duplicate protection, disconnect handling | `supabase/schema.sql` |
| **Books → Other Learning Materials**: live cards (title, VIDEO badge, Watch Video link, 1–5 star rating, average, count) | `features.js` |
| **Hidden Admin panel**: Ctrl + ↑ (desktop) or tap the ♟ logo in the header 5 times within 3 s (mobile) | `features.js`, `index.html` |
| Admin login with the **admin Google account** listed in the `admins` table | `supabase/schema.sql` |
| Admin dashboard: add / edit / delete / publish / unpublish learning materials, logout | `features.js` |

Everything else (board, pieces, themes, engine, rules, promotion, Friends, Challenges, voice chat,
Analyze, Openings/Defences, Google sign-in, Terms, profiles, timers, mobile layout) is unchanged.
`script.js` only received small hooks (Quick Match mode, clock increment, Quick Match result/rematch,
presence-based clock start for Quick Match rooms, Books "Other" panel hand-off).
The old "⚡ Quick Match" button inside the Friend panel now opens the new Quick Match page; the previous
engine-opponent fallback is no longer used — Quick Match always pairs two real players.

### Backend (Supabase)
Everything that used Firebase (Cloud Functions, Firestore, Realtime Database, Phone OTP) now runs on
Supabase. Setup steps: **SUPABASE_SETUP.md**. Server code: `supabase/schema.sql`. Browser adapter: `supabase-compat.js`.
The admin panel now signs in with the admin's Google account (listed in the `admins` table) instead of a phone OTP.

### Limits you can tune (top of each file)
* `features.js`: search retry 7 s, give up after 5 min, abort if the opponent is absent 30 s, reconnect
  window 60 s, admin idle lock 30 min.
* `supabase/schema.sql`: queue heartbeat timeout 25 s, onDisconnect after 45 s without heartbeat.
