# B CHESS ANALYZER — Security audit and deployment notes

## Status: SECURITY-HARDENED STARTER, NOT PRODUCTION READY

This archive preserves the original site files and hardens `supabase/schema.sql` against several known cross-user and privilege escalation paths. No live database or end-to-end test was performed. Do **not** claim that all security issues are fixed.

### Changes made
- Removed global authenticated read of the JSON document store. Users can read their own profile, their game rooms, and open waiting rooms. Admins can read all.
- Blocked client-created profile documents from initializing protected fields, including ratings and identity/role values.
- Blocked client writes to gameplay state, result, winner, clocks and match history; these must be performed by a server-side rules engine.
- Checked session ownership when adding disconnect handlers and capped queued operations.
- Disabled execution of deferred client operations as privileged SQL (a trusted cleanup worker must replace this).
- Revoked public execution of privileged internal functions and direct access to session/admin tables.

### Known functional limitations / required work
1. **Multiplayer gameplay is intentionally blocked**: existing `script.js` sends `gameFen`, `gameOver`, results and clock values directly. A trusted server-side move-validation and result service is required. Do not enable client writes to these fields as a workaround.
2. **Friends, challenges and directory search need dedicated authenticated RPCs**: current client writes to another user's document, now denied. Provide recipient-validated functions with consent checks.
3. **Profile initialization and rating setup**: current client tries to initialize rating directly. Initialize server-side with a fixed starting value and use verified results to change it.
4. **Presence / onDisconnect**: deferred writes are disabled. Implement a trusted heartbeat cleanup service and test stale presence handling.
5. **Public room discovery**: waiting-room metadata can be visible to signed-in users; consider a dedicated sanitized listing view.
6. **Realtime**: PostgreSQL changes and Realtime publication are not a substitute for authorization and validated game events. Test RLS and Realtime subscription visibility.
7. **Google OAuth / GitHub Pages**: configure authorized origins and redirects, test login, logout, sessions, and rate limiting.
8. **Voice chat**: WebRTC signaling, TURN, abuse prevention and privacy controls require separate security testing.
9. **Content security**: inspect all DOM insertion sites and user-generated URLs for XSS; apply a CSP and sanitize external content.
10. **Operational security**: test with two distinct non-admin accounts, back up data, monitor database usage, configure abuse limits, and rotate any secrets that were previously shared.

### Safe deployment sequence
- Keep existing GitHub repository backup.
- Use a **new empty Supabase test project**, not production, to review and apply SQL.
- Check the entire script, test permissions with separate accounts, and verify the blocked workflows above.
- Only deploy to public users after implementing and testing the missing trusted services.

### Changes not made
- No attempt to rewrite all frontend multiplayer flows or guarantee 100-player concurrency.
- No live execution, penetration testing, or security certification.
