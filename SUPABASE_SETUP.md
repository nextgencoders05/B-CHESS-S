# B Chess — Supabase setup

The app now runs fully on Supabase: Google login, friend games, chat, voice‑call signalling,
Quick Match, learning materials and ratings, and the admin panel. Firebase is no longer used.

## 1. Create the database (one time)
1. Supabase → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql`, The admin email is already configured as `datathon2025x@gmail.com` in the final line.
3. Paste the whole file → **Run**. You should see "Success. No rows returned".
   (You can run it again later; it is safe.)

## 2. Fill in `config.js`
Supabase → Project Settings → **API** (or **API Keys**):
```js
window.SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-ID.supabase.co',   // Project URL
  anonKey: 'YOUR-ANON-PUBLIC-KEY'               // anon / publishable key
};
```
The project URL and publishable key are already filled in `config.js`. Never put the **service_role / secret** key or database password in the website.

## 3. Google login
1. Supabase → Authentication → **Sign In / Providers → Google** → Enable. Copy the **Callback URL** shown there.
2. Google Cloud Console → APIs & Services → **Credentials** → Create **OAuth client ID** → *Web application*
   - Authorized JavaScript origins: `https://YOURNAME.github.io`
   - Authorized redirect URIs: the Supabase Callback URL
3. Paste the Client ID + Client Secret into Supabase → Save.
4. Supabase → Authentication → **URL Configuration**
   - Site URL: your site, e.g. `https://YOURNAME.github.io/B-CHESS-COM/`
   - Redirect URLs: add `https://YOURNAME.github.io/B-CHESS-COM/**`

## 4. Upload the site to GitHub Pages
Upload all files (keep the folders). The new files are `config.js`, `supabase-compat.js` and `supabase/schema.sql`.

## Admin panel
Open it with Ctrl + ↑ (desktop) or by tapping the ♟ logo 5 times. Sign in with Google using the
e‑mail you put in `schema.sql`. To add another admin, run in the SQL Editor:
```sql
insert into public.admins (email) values ('another@gmail.com');
```

## Good to know
- Old Firebase accounts, ratings, friends and learning materials are **not** copied over: everyone starts fresh,
  and the admin re-adds the learning materials.
- Free Supabase projects **pause after about 7 days with no visitors**. If the site says the server is not
  reachable, open the Supabase dashboard and click **Restore project**.
- Data access is the same as before: any signed-in player can read and write game data (rooms, profiles).
