# B Chess Analyzer — safer database starter (November 2026)

This archive retains the existing application and assets. `supabase/schema.sql` has been modified to add **basic database write authorization**. The existing `config.js` intentionally still contains placeholders: enter your own Supabase Project URL and publishable key, never a service-role key or database password.

## Install
1. Back up your existing GitHub repository and Supabase database first.
2. Replace the repository files with this archive's contents, preserving the folder structure.
3. In Supabase SQL Editor, open `supabase/schema.sql`, review the statements, and execute them only in your intended project. A destructive-operations warning is expected because policies and functions are replaced; it does **not** certify that execution is risk-free.
4. Confirm the tables in Table Editor and configure Google OAuth in Supabase Authentication.
5. Fill in `config.js` with Project URL and publishable key, then publish via GitHub Pages.

## Security improvements
- `rtdb_apply` and `rtdb_cas` now authorize each client operation.
- Cross-account `users/{uid}` writes, user-supplied rating changes, arbitrary namespace writes, and bulk prefix deletes are rejected.
- Room updates are limited to participants, and room ownership fields are protected.
- On-disconnect operations are checked when registered.
- Removed the blanket revoke of *all* functions in `public`.

## Known limitations — IMPORTANT
**This is a security-hardening starter, NOT a fully tested production release.** The original client directly updates other users' friend requests, challenge notifications and ratings, and uses legacy matchmaking. Those actions will now be denied until moved to narrowly authorized server-side RPCs. Some room joining flows use whole-room transactions and may also be blocked. This is intentional fail-closed behavior, not a claim that all features work.

The client still has no authoritative chess move validation or rating calculation. A room participant may forge game state. Signed-in users can read the shared `rtdb` documents; user privacy needs a separate design. Voice chat may need TURN hosting. There is no claim of 100-concurrent-user load testing.

Before public launch, implement verified friend/challenge RPCs, server-side chess moves and ELO settlement, strict per-user read rules, room join RPC, and test all existing workflows with multiple accounts.

## SQL status
The SQL was statically reviewed and edited; it has **not** been executed against a live Supabase instance. Test on a disposable project first. If you encounter a SQL error, do not repeatedly run the script; save the full error text for diagnosis.
