# B Chess UI update

The desktop and phone layouts take their colors from the supplied reference: dark teal panels, warm ivory text, copper buttons and selected states, and metallic outlines. The existing layout gains a wider desktop navigation rail, a compact phone header, a framed board, and refreshed styling for clocks, analysis panels, menus and dialogs.

Board and Coins choices still control the squares and pieces independently. The optional metallic set was omitted because a complete set of usable assets was unavailable.

## Update your website

1. Extract this ZIP and open the `B-CHESS-S-main` folder.
2. Upload its contents to the same GitHub Pages publishing folder as your current `index.html`. Keep the folder structure. If your site already runs the supplied base version, only `index.html`, `club.css`, and `sw.js` are needed for the visual update.
3. Commit the files and reload the site after GitHub Pages finishes deploying. The service worker has a new cache version for the stylesheet.

No SQL migration or Edge Function redeployment is needed.

## Verification

Headless Chromium rendered the existing app with local chess libraries and a simulated signed-in session at 1440, 900, 390 and 320 px. At all four widths the board displayed 64 squares, its frame remained square, the page had no horizontal overflow, the header menu measured at least 44 by 44 px, and all four promotion choices fit within the viewport. The Theme dialog opened, a board selection survived reload, and switching it preserved a test position, orientation and move history. Mobile More opened and exposed Tournaments. Desktop and phone screenshots were reviewed against the reference.

The archive comparison confirmed that only the stylesheet, visual markup, cache version and this guide differ from the source. The markup retains every existing ID and the mic and speaker controls in their original locations. The Supabase directory and all gameplay, voice and theme scripts are byte-for-byte identical to the supplied project. Live clocks, Google sign-in, voice transmission, deployed service worker behavior, and physical devices were outside the browser fixture.
