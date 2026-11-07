========================================================================
B CHESS ANALYZER - FINAL PRODUCTION PACK (WITH FIREBASE & POPUP FIX)
========================================================================

1. POPUP BLOCKER ISSUE FIXED:
   - Previously, Google Login was being triggered automatically on page load
     inside onAuthStateChanged, which caused Chrome/Edge to detect an unprompted
     popup and block it immediately with "Firebase: Error (auth/popup-blocked)".
   - Now, Google Login is triggered ONLY when the user directly clicks the
     "Sign in with Google" button or attempts to Create/Join a room.
   - Added automatic fallback to signInWithRedirect if popups are ever blocked.

2. FIREBASE CONFIGURATION UPDATED:
   - Updated firebaseConfig in script.js with your project credentials:
     * Project ID: b-chess-analyser
     * Database URL: https://b-chess-analyser-default-rtdb.firebaseio.com
     * Storage Bucket: b-chess-analyser.firebasestorage.app
     * Messaging Sender ID: 338871638210
     * App ID: 1:338871638210:web:8653ca64fe66d120a13df6
   - In your Firebase Console, click the 'Copy' icon next to apiKey and paste
     it into apiKey: "..." in script.js line 8.

3. ALL ORIGINAL FEATURES INTACT:
   - Header: "B Chess Analyzer"
   - Toolbar: "Sound: ON", "Green & White", "Arrow: ON"
   - Modes: [Analysis], [Play vs Bot], [Play with Friend]
   - Evaluation Bar, Move History, Captured Pieces, Accuracy
   - Natural wooden sound effects, WebRTC Voice Chat, Live Chat & +/- 8 Rating.

HOW TO DEPLOY:
1. Extract this ZIP file.
2. In script.js line 8, verify your apiKey string from your Firebase console.
3. Replace index.html, style.css, and script.js in your GitHub repo and Commit!
========================================================================
