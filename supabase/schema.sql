-- =====================================================================
-- B Chess Analyzer — Supabase backend
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Review changes before rerunning: this script replaces functions and policies.
--
-- What it creates
--   1. rtdb          : JSON documents that replace the Firebase Realtime Database
--                      (users/{uid}, rooms/{code}, matchmaking/{tc}/{uid})
--   2. onDisconnect  : sessions + heartbeat so "remove this when I leave" still works
--   3. Quick Match   : queue + matches + quick_match_join / quick_match_cancel
--   4. Learning materials + ratings (rate_material)
--   5. Admin         : admins table (by Google e-mail) + admin_* functions
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. ADMIN — admins are Google accounts by e-mail
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  email      text primary key,
  active     boolean not null default true,
  last_login timestamptz
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins
    where active and lower(email) = lower(coalesce(auth.jwt()->>'email', '')))
$$;


-- ---------------------------------------------------------------------
-- 1. JSON document store (Realtime Database replacement)
-- ---------------------------------------------------------------------
create table if not exists public.rtdb (
  doc        text primary key,
  data       jsonb,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists rtdb_username_idx on public.rtdb ((data->>'username')) where doc like 'users/%';

alter table public.rtdb enable row level security;
drop policy if exists rtdb_read on public.rtdb;
-- Least-privilege document access. Legacy global user search will require a safe directory RPC.
create policy rtdb_read on public.rtdb for select to authenticated using (
  doc = 'users/' || (select auth.uid())::text
  or (starts_with(doc, 'rooms/') and (
    data->>'creatorId' = (select auth.uid())::text
    or data->>'guestId' = (select auth.uid())::text
    or (data->>'guestId' is null and data->>'status' = 'waiting')
  ))
  or public.is_admin()
);
-- No insert/update/delete policies: every write goes through the functions below.

create or replace function public.rtdb_now_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

-- Replace {".sv":"timestamp"} placeholders with the server time.
create or replace function public.rtdb_resolve(v jsonb, now_ms bigint) returns jsonb
language plpgsql immutable as $$
declare k text; i int; r jsonb;
begin
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'object' then
    if v = '{".sv":"timestamp"}'::jsonb then return to_jsonb(now_ms); end if;
    r := '{}'::jsonb;
    for k in select jsonb_object_keys(v) loop
      r := r || jsonb_build_object(k, public.rtdb_resolve(v->k, now_ms));
    end loop;
    return r;
  elsif jsonb_typeof(v) = 'array' then
    r := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(v) - 1 loop
      r := r || jsonb_build_array(public.rtdb_resolve(v->i, now_ms));
    end loop;
    return r;
  end if;
  return v;
end $$;

-- Set (or remove, when val is null) a value deep inside a JSON document,
-- creating missing parents and pruning empty parents like Firebase does.
create or replace function public.rtdb_jset(t jsonb, p text[], val jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text; child jsonb; idx int; len int; obj jsonb; i int;
begin
  if val = 'null'::jsonb then val := null; end if;
  if p is null or cardinality(p) = 0 then return val; end if;
  k := p[1];
  if t is null or jsonb_typeof(t) not in ('object', 'array') then
    if val is null then return t; end if;
    t := '{}'::jsonb;
  end if;

  if jsonb_typeof(t) = 'array' then
    len := jsonb_array_length(t);
    if k ~ '^[0-9]{1,6}$' then
      idx := k::int;
      child := public.rtdb_jset(t->idx, p[2:], val);
      if idx < len then
        if child is null and idx = len - 1 then
          t := t - idx;
        else
          t := jsonb_set(t, array[k], coalesce(child, 'null'::jsonb));
        end if;
        if jsonb_array_length(t) = 0 then return null; end if;
        return t;
      elsif idx = len then
        if child is null then return t; end if;
        return t || jsonb_build_array(child);
      end if;
    end if;
    -- Sparse or non-numeric key: turn the array into an object.
    obj := '{}'::jsonb;
    for i in 0 .. len - 1 loop
      if t->i is not null and t->i <> 'null'::jsonb then obj := obj || jsonb_build_object(i::text, t->i); end if;
    end loop;
    t := obj;
  end if;

  child := public.rtdb_jset(t->k, p[2:], val);
  if child is null then t := t - k; else t := t || jsonb_build_object(k, child); end if;
  if t = '{}'::jsonb then return null; end if;
  return t;
end $$;

create or replace function public.rtdb_require_user() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated: Please sign in first.'; end if;
  return auth.uid();
end $$;

-- Security boundary for client-submitted RTDB writes.
-- Only the signed-in owner may modify users/{uid}. Other users' inboxes,
-- friend lists and ratings must be updated through dedicated verified RPCs.
-- Rooms can be created by their creator; client game-state mutations are disabled.
-- Rated/public gameplay requires server-validated moves and result settlement.
-- The legacy client gameplay writes are intentionally blocked until then.
create or replace function public.rtdb_authorize_write(p_doc text, p_path text[], p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_parts text[] := string_to_array(p_doc, '/');
  v_room jsonb;
  v_creator text;
  v_guest text;
  v_field text;
begin
  if v_uid is null then raise exception 'permission-denied: Login required'; end if;
  if p_doc is null or length(p_doc) > 300 or array_length(v_parts,1) <> 2
     or v_parts[2] = '' then
    raise exception 'permission-denied: Invalid document path';
  end if;
  if v_parts[1] = 'users' then
    if v_parts[2] <> v_uid::text then
      raise exception 'permission-denied: Cannot modify another user';
    end if;
    -- No client-controlled rating: only a verified game-result service may change it.
    if coalesce(cardinality(p_path),0) = 0 then
      if p_value is not null and p_value <> 'null'::jsonb
         and jsonb_typeof(p_value) = 'object' and p_value ?| array['rating','elo','isAdmin','admin','role','uid','id','matchHistory','friends','friendRequests','challenges'] then
        raise exception 'permission-denied: Profile rating is server-managed';
      end if;
      -- Whole-document writes may erase protected fields; disallow after creation.
      if exists(select 1 from public.rtdb where doc=p_doc and data is not null) then
        raise exception 'permission-denied: Whole-profile replacement blocked';
      end if;
    else
      v_field := p_path[1];
      if v_field in ('rating','elo','isAdmin','admin','role','uid','id','matchHistory') then
        raise exception 'permission-denied: Protected profile field';
      end if;
    end if;
    return;
  elsif v_parts[1] = 'rooms' then
    select data into v_room from public.rtdb where doc=p_doc;
    if v_room is null then
      if coalesce(cardinality(p_path),0) <> 0 or p_value is null
         or jsonb_typeof(p_value) <> 'object'
         or p_value->>'creatorId' <> v_uid::text then
        raise exception 'permission-denied: Only creator can create room';
      end if;
      return;
    end if;
    v_creator := v_room->>'creatorId';
    v_guest := v_room->>'guestId';
    if v_uid::text <> coalesce(v_creator,'') and v_uid::text <> coalesce(v_guest,'') then
      -- A joining player can claim an unoccupied guest slot only.
      if v_guest is null and coalesce(cardinality(p_path),0) = 1
         and p_path[1] = 'guestId' and p_value = to_jsonb(v_uid::text) then
        return;
      end if;
      raise exception 'permission-denied: Not a room participant';
    end if;
    -- No participant may replace the entire room or change its ownership.
    if coalesce(cardinality(p_path),0) = 0
       or p_path[1] in ('creatorId','guestId','matchId','quickMatch',
         'gameFen','gameOver','result','winner','status','clockTurn','clockStartedAt',
         'whiteTime','blackTime','moveHistory','moves','fen','pgn','ratingDelta') then
      raise exception 'permission-denied: Protected room field';
    end if;
    return;
  elsif v_parts[1] = 'matchmaking' then
    -- Legacy matchmaking uses nested paths; deny direct writes until migrated.
    raise exception 'permission-denied: Use secure quick_match_join RPC';
  end if;
  raise exception 'permission-denied: Unknown document namespace';
end $$;
revoke all on function public.rtdb_authorize_write(text,text[],jsonb) from public, anon, authenticated;

-- Internal: apply a list of operations. Each op is one of
--   {"d": doc, "p": [path inside doc], "v": value-or-null}   set / remove
--   {"prefix": "users/abc"}                                  remove every doc under a path
create or replace function public.rtdb_apply_internal(ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  op jsonb; d text; p text[]; cur jsonb; newv jsonb; now_ms bigint := public.rtdb_now_ms();
  touched text[] := '{}'; result jsonb := '[]'::jsonb; pref text;
begin
  for op in select * from jsonb_array_elements(coalesce(ops, '[]'::jsonb)) loop
    if op ? 'prefix' then
      pref := op->>'prefix';
      if pref is null or pref = '' then raise exception 'invalid-argument: Refusing to clear the whole database.'; end if;
      -- Prefix deletion is internal housekeeping only, never exposed to clients.
      update rtdb set data = null, version = version + 1, updated_at = now()
        where starts_with(doc, pref || '/') and data is not null;
      continue;
    end if;
    d := op->>'d';
    if d is null or d = '' or length(d) > 300 then raise exception 'invalid-argument: Bad path.'; end if;
    select coalesce(array_agg(x), '{}') into p from jsonb_array_elements_text(coalesce(op->'p', '[]'::jsonb)) x;
    select data into cur from rtdb where doc = d for update;
    newv := public.rtdb_jset(cur, p, public.rtdb_resolve(op->'v', now_ms));
    insert into rtdb as r (doc, data, version, updated_at) values (d, newv, 1, now())
      on conflict (doc) do update set data = excluded.data, version = r.version + 1, updated_at = now();
    if not d = any(touched) then touched := touched || d; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('doc', doc, 'data', data, 'version', version)), '[]'::jsonb)
    into result from rtdb where doc = any(touched);
  return result;
end $$;
revoke all on function public.rtdb_apply_internal(jsonb) from public, anon, authenticated;

-- Public writes are now scoped to user-owned documents and room participants.
create or replace function public.rtdb_apply(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i int;
begin
  perform public.rtdb_require_user();
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 40 then
    raise exception 'invalid-argument: Expected up to 40 write operations';
  end if;
  -- Validate every operation before applying any changes.
    for i in 0 .. jsonb_array_length(p_ops)-1 loop
      if p_ops->i ? 'prefix' then
        raise exception 'permission-denied: Prefix deletion forbidden';
      end if;
      if jsonb_typeof(p_ops->i->'p') not in ('array') and p_ops->i ? 'p' then
        raise exception 'invalid-argument: Invalid path';
      end if;
      perform public.rtdb_authorize_write(
        p_ops->i->>'d',
        coalesce(array(select jsonb_array_elements_text(coalesce(p_ops->i->'p','[]'::jsonb))), '{}'::text[]),
        p_ops->i->'v');
    end loop;
  return public.rtdb_apply_internal(p_ops);
end $$;

-- Compare-and-set used for Firebase-style transactions.
create or replace function public.rtdb_cas(p_doc text, p_path text[], p_expected bigint, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur record; newv jsonb;
begin
  perform public.rtdb_require_user();
  perform public.rtdb_authorize_write(p_doc, p_path, p_value);
  select data, version into cur from rtdb where doc = p_doc for update;
  if coalesce(cur.version, 0) <> coalesce(p_expected, 0) then
    return jsonb_build_object('ok', false, 'data', cur.data, 'version', coalesce(cur.version, 0));
  end if;
  newv := public.rtdb_jset(cur.data, coalesce(p_path, '{}'), public.rtdb_resolve(p_value, public.rtdb_now_ms()));
  insert into rtdb as r (doc, data, version, updated_at) values (p_doc, newv, 1, now())
    on conflict (doc) do update set data = excluded.data, version = r.version + 1, updated_at = now();
  return (select jsonb_build_object('ok', true, 'data', r.data, 'version', r.version) from rtdb r where r.doc = p_doc);
end $$;

-- ---------------------------------------------------------------------
-- 2. Sessions + onDisconnect (replaces Firebase onDisconnect / .info/connected)
-- ---------------------------------------------------------------------
create table if not exists public.rtdb_sessions (
  session   uuid primary key,
  uid       uuid not null,
  last_seen timestamptz not null default now()
);
create table if not exists public.rtdb_ondisconnect (
  id      bigserial primary key,
  session uuid not null,
  uid     uuid not null,
  path    text not null,
  ops     jsonb not null
);
create index if not exists rtdb_ondisconnect_session_idx on public.rtdb_ondisconnect(session);
alter table public.rtdb_sessions enable row level security;
alter table public.rtdb_ondisconnect enable row level security;

-- Runs the onDisconnect operations of sessions that stopped sending heartbeats.
create or replace function public.rtdb_reap() returns void
language plpgsql security definer set search_path = public as $$
declare s record; o record;
begin
  for s in select session from rtdb_sessions where last_seen < now() - interval '45 seconds'
           for update skip locked loop
    -- Do not execute untrusted deferred writes with elevated privileges.
    -- Stale session records are removed; presence cleanup requires a trusted worker.
    -- See SECURITY_AUDIT.md for deployment requirements.
    delete from rtdb_ondisconnect where session = s.session;
    delete from rtdb_sessions where session = s.session;
  end loop;
  -- Housekeeping
  delete from rtdb where data is null and updated_at < now() - interval '1 day';
end $$;
revoke all on function public.rtdb_reap() from public, anon, authenticated;

create or replace function public.rtdb_session_beat(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.rtdb_require_user(); existed boolean;
begin
  update rtdb_sessions set last_seen = now() where session = p_session and uid = v_uid;
  existed := found;
  if not existed then
    insert into rtdb_sessions(session, uid) values (p_session, v_uid) on conflict (session) do update set last_seen = now() where rtdb_sessions.uid = excluded.uid;
  end if;
  perform public.rtdb_reap();
  return jsonb_build_object('existed', existed, 'now', public.rtdb_now_ms());
end $$;

create or replace function public.rtdb_ondisconnect_add(p_session uuid, p_path text, p_ops jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.rtdb_require_user(); i int;
begin
  insert into rtdb_sessions(session, uid) values (p_session, v_uid) on conflict (session) do update set last_seen = now() where rtdb_sessions.uid = excluded.uid;
  if not exists (select 1 from rtdb_sessions where session=p_session and uid=v_uid) then
    raise exception 'permission-denied: Session is owned by another user';
  end if;
  if (select count(*) from rtdb_ondisconnect where session = p_session) >= 200 then
    raise exception 'resource-exhausted: Too many onDisconnect operations.';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 10 then
    raise exception 'invalid-argument: Invalid onDisconnect operations';
  end if;
  for i in 0 .. jsonb_array_length(p_ops)-1 loop
    if p_ops->i ? 'prefix' then raise exception 'permission-denied: Prefix delete forbidden'; end if;
    if p_ops->i ? 'p' and jsonb_typeof(p_ops->i->'p') <> 'array' then
      raise exception 'invalid-argument: Invalid path';
    end if;
    perform public.rtdb_authorize_write(p_ops->i->>'d',
      coalesce(array(select jsonb_array_elements_text(coalesce(p_ops->i->'p','[]'::jsonb))), '{}'::text[]),
      p_ops->i->'v');
  end loop;
  insert into rtdb_ondisconnect(session, uid, path, ops) values (p_session, v_uid, p_path, p_ops);
end $$;

create or replace function public.rtdb_ondisconnect_cancel(p_session uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.rtdb_require_user();
begin
  delete from rtdb_ondisconnect o where o.session = p_session and o.uid = v_uid
    and (o.path = p_path or starts_with(o.path, p_path || '/') or p_path = '');
end $$;

-- Called when the page closes: run my onDisconnect operations now.
create or replace function public.rtdb_session_end(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.rtdb_require_user(); o record;
begin
  -- Do not replay deferred client writes with elevated privileges.
  -- The application must use a verified presence service for cleanup.
  delete from rtdb_ondisconnect where session = p_session and uid = v_uid;
  delete from rtdb_sessions where session = p_session and uid = v_uid;
end $$;

-- ---------------------------------------------------------------------
-- 3. QUICK MATCH (server-side matchmaking)
-- ---------------------------------------------------------------------
create table if not exists public.quick_match_queue (
  user_id    uuid primary key,
  time_key   text not null,
  status     text not null,             -- waiting | matched
  name       text,
  rating     int,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  match_id   uuid,
  room_code  text,
  color      text,
  opponent   jsonb,
  matched_at timestamptz
);
create index if not exists quick_match_queue_wait_idx on public.quick_match_queue(time_key, status, created_at);
create table if not exists public.quick_matches (
  id           uuid primary key default gen_random_uuid(),
  player1      jsonb not null,
  player2      jsonb not null,
  players      uuid[] not null,
  time_control text not null,
  base_seconds int not null,
  increment    int not null,
  category     text not null,
  room_code    text not null,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  started_at   timestamptz not null default now()
);
alter table public.quick_match_queue enable row level security;
alter table public.quick_matches enable row level security;
drop policy if exists qmq_read_own on public.quick_match_queue;
create policy qmq_read_own on public.quick_match_queue for select to authenticated using (user_id = auth.uid());
drop policy if exists qm_read_players on public.quick_matches;
create policy qm_read_players on public.quick_matches for select to authenticated using (auth.uid() = any(players) or public.is_admin());

create or replace function public.qm_time_control(k text) returns jsonb
language sql immutable as $$
  select ('{"1+0":{"base":60,"increment":0,"category":"Bullet"},
           "2+1":{"base":120,"increment":1,"category":"Bullet"},
           "3+0":{"base":180,"increment":0,"category":"Blitz"},
           "3+2":{"base":180,"increment":2,"category":"Blitz"},
           "5+0":{"base":300,"increment":0,"category":"Blitz"},
           "10+0":{"base":600,"increment":0,"category":"Rapid"},
           "10+5":{"base":600,"increment":5,"category":"Rapid"},
           "15+10":{"base":900,"increment":10,"category":"Rapid"},
           "30+0":{"base":1800,"increment":0,"category":"Classical"}}'::jsonb)->k
$$;

create or replace function public.qm_payload(q public.quick_match_queue, resume boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object('status', 'matched', 'roomCode', q.room_code, 'color', q.color,
    'opponent', coalesce(q.opponent, '{}'::jsonb), 'timeControl', q.time_key,
    'matchId', q.match_id, 'resume', resume)
$$;

create or replace function public.qm_room_active(p_code text, p_uid uuid, p_matched_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (data->>'gameOver') is distinct from 'true'
       and (data->>'creatorId' = p_uid::text or data->>'guestId' = p_uid::text)
    from rtdb where doc = 'rooms/' || p_code and data is not null
  ), false) and p_code is not null and p_matched_at > now() - interval '4 hours'
$$;

create or replace function public.quick_match_join(p_time_control text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.rtdb_require_user();
  tc jsonb := public.qm_time_control(p_time_control);
  mine public.quick_match_queue; opp public.quick_match_queue;
  prof jsonb; me_name text; me_rating int;
  v_match_id uuid; v_code text; me_white boolean;
  w_uid uuid; w_name text; w_rating int; b_uid uuid; b_name text; b_rating int;
  now_ms bigint := public.rtdb_now_ms();
begin
  if tc is null then raise exception 'invalid-argument: Unknown time control.'; end if;

  -- Housekeeping: drop abandoned entries.
  delete from quick_match_queue where updated_at < now() - interval '10 minutes'
    and (status <> 'matched' or matched_at < now() - interval '4 hours');

  -- One pairing at a time per time control (prevents double matches).
  perform pg_advisory_xact_lock(hashtext('quickmatch:' || p_time_control));

  select * into mine from quick_match_queue where user_id = v_uid for update;
  if found and mine.status = 'matched' and public.qm_room_active(mine.room_code, v_uid, mine.matched_at) then
    return public.qm_payload(mine, true);
  end if;

  select data into prof from rtdb where doc = 'users/' || v_uid;
  me_name := left(coalesce(prof->>'username', prof->>'name',
    (select raw_user_meta_data->>'full_name' from auth.users where id = v_uid), 'Player'), 40);
  me_rating := greatest(100, least(4000, round(coalesce((prof->>'rating')::numeric, 800))::int));

  select * into opp from quick_match_queue
    where time_key = p_time_control and status = 'waiting' and user_id <> v_uid
      and last_seen > now() - interval '25 seconds'
    order by created_at limit 1 for update skip locked;

  if not found then
    insert into quick_match_queue as q (user_id, time_key, status, name, rating, created_at, last_seen, updated_at,
                                        match_id, room_code, color, opponent, matched_at)
      values (v_uid, p_time_control, 'waiting', me_name, me_rating, now(), now(), now(), null, null, null, null, null)
      on conflict (user_id) do update set
        time_key = excluded.time_key, status = 'waiting', name = excluded.name, rating = excluded.rating,
        created_at = case when q.status = 'waiting' and q.time_key = excluded.time_key then q.created_at else now() end,
        last_seen = now(), updated_at = now(), match_id = null, room_code = null, color = null,
        opponent = null, matched_at = null;
    return jsonb_build_object('status', 'waiting');
  end if;

  v_match_id := gen_random_uuid();
  v_code := 'QM' || replace(v_match_id::text, '-', '');
  me_white := random() < 0.5;
  if me_white then
    w_uid := v_uid; w_name := me_name; w_rating := me_rating;
    b_uid := opp.user_id; b_name := coalesce(opp.name, 'Player'); b_rating := coalesce(opp.rating, 800);
  else
    w_uid := opp.user_id; w_name := coalesce(opp.name, 'Player'); w_rating := coalesce(opp.rating, 800);
    b_uid := v_uid; b_name := me_name; b_rating := me_rating;
  end if;

  insert into quick_matches (id, player1, player2, players, time_control, base_seconds, increment, category, room_code)
  values (v_match_id,
    jsonb_build_object('uid', w_uid, 'name', w_name, 'rating', w_rating, 'color', 'w'),
    jsonb_build_object('uid', b_uid, 'name', b_name, 'rating', b_rating, 'color', 'b'),
    array[w_uid, b_uid], p_time_control, (tc->>'base')::int, (tc->>'increment')::int, tc->>'category', v_code);

  -- The game itself runs in the normal rooms/{code} document.
  perform public.rtdb_apply_internal(jsonb_build_array(jsonb_build_object('d', 'rooms/' || v_code, 'p', '[]'::jsonb, 'v',
    jsonb_build_object(
      'creatorId', w_uid, 'creatorName', w_name, 'creatorRating', w_rating,
      'guestId', b_uid, 'guestName', b_name, 'guestRating', b_rating,
      'gameFen', 'start', 'status', 'playing', 'gameOver', false,
      'timeControl', (tc->>'base')::int, 'increment', (tc->>'increment')::int,
      'quickMatch', true, 'quickKey', p_time_control, 'quickLabel', (tc->>'category') || ' • ' || p_time_control,
      'matchId', v_match_id, 'createdAt', now_ms))));

  insert into quick_match_queue as q (user_id, time_key, status, name, rating, created_at, last_seen, updated_at)
    values (v_uid, p_time_control, 'matched', me_name, me_rating, now(), now(), now())
    on conflict (user_id) do nothing;
  update quick_match_queue set status = 'matched', match_id = v_match_id, room_code = v_code,
      matched_at = now(), updated_at = now(),
      color = case when user_id = w_uid then 'w' else 'b' end,
      opponent = case when user_id = w_uid
        then jsonb_build_object('uid', b_uid, 'name', b_name, 'rating', b_rating)
        else jsonb_build_object('uid', w_uid, 'name', w_name, 'rating', w_rating) end
    where user_id in (w_uid, b_uid);

  select * into mine from quick_match_queue where user_id = v_uid;
  return public.qm_payload(mine, false);
end $$;

create or replace function public.quick_match_cancel() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.rtdb_require_user(); mine public.quick_match_queue;
begin
  select * into mine from quick_match_queue where user_id = v_uid for update;
  if not found then return jsonb_build_object('cancelled', true); end if;
  if mine.status = 'matched' and mine.matched_at > now() - interval '60 seconds' then
    return jsonb_build_object('cancelled', false) || public.qm_payload(mine, false);
  end if;
  delete from quick_match_queue where user_id = v_uid;
  return jsonb_build_object('cancelled', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. LEARNING MATERIALS + RATINGS
-- ---------------------------------------------------------------------
create table if not exists public.learning_materials (
  id             text primary key default replace(gen_random_uuid()::text, '-', ''),
  title          text not null,
  url            text not null,
  resource_type  text not null default 'video',
  published      boolean not null default true,
  average_rating numeric not null default 0,
  total_ratings  int not null default 0,
  rating_sum     int not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
create table if not exists public.material_ratings (
  material_id text not null references public.learning_materials(id) on delete cascade,
  user_id     uuid not null,
  rating      int not null check (rating between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (material_id, user_id)
);
alter table public.learning_materials enable row level security;
alter table public.material_ratings enable row level security;
drop policy if exists lm_read on public.learning_materials;
create policy lm_read on public.learning_materials for select to anon, authenticated using (published or public.is_admin());
drop policy if exists lmr_read_own on public.material_ratings;
create policy lmr_read_own on public.material_ratings for select to authenticated using (user_id = auth.uid() or public.is_admin());

create or replace function public.rate_material(p_material_id text, p_rating int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.rtdb_require_user(); m public.learning_materials; prev int; total int; s int; avg numeric;
begin
  if p_material_id is null or p_material_id !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid-argument: Invalid material.'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'invalid-argument: Rating must be 1 to 5 stars.'; end if;
  select * into m from learning_materials where id = p_material_id for update;
  if not found or not m.published then raise exception 'not-available: This learning material is not available.'; end if;
  select r.rating into prev from material_ratings r where r.material_id = p_material_id and r.user_id = v_uid;
  total := m.total_ratings + case when prev is null then 1 else 0 end;
  s := greatest(0, m.rating_sum - coalesce(prev, 0) + p_rating);
  avg := case when total > 0 then round(s::numeric / total, 2) else 0 end;
  insert into material_ratings as r (material_id, user_id, rating) values (p_material_id, v_uid, p_rating)
    on conflict (material_id, user_id) do update set rating = excluded.rating, updated_at = now();
  update learning_materials set rating_sum = s, total_ratings = total, average_rating = avg where id = p_material_id;
  return jsonb_build_object('rating', p_rating, 'averageRating', avg, 'totalRatings', total);
end $$;

-- ---------------------------------------------------------------------
-- 5. ADMIN functions
-- ---------------------------------------------------------------------
create or replace function public.admin_require() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated: Please sign in with your admin Google account.'; end if;
  if not public.is_admin() then raise exception 'permission-denied: Access Denied – You are not an authorized Admin.'; end if;
  return auth.uid();
end $$;

create or replace function public.admin_verify_session() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  update admins set last_login = now() where lower(email) = lower(auth.jwt()->>'email');
  return jsonb_build_object('admin', true, 'email', auth.jwt()->>'email');
end $$;

create or replace function public.admin_save_material(p_id text, p_title text, p_url text, p_resource_type text, p_published boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.admin_require(); t text; new_id text;
begin
  t := btrim(regexp_replace(regexp_replace(coalesce(p_title, ''), '[\x00-\x1f\x7f]', '', 'g'), '\s+', ' ', 'g'));
  if length(t) < 2 or length(t) > 120 then raise exception 'invalid-argument: Title must be 2–120 characters.'; end if;
  if p_url is null or p_url !~ '^https://[^\s/$.?#][^\s]*$' then raise exception 'invalid-argument: The URL must start with https://'; end if;
  if length(p_url) > 500 then raise exception 'invalid-argument: URL is too long.'; end if;
  if p_resource_type is distinct from 'video' then raise exception 'invalid-argument: Unsupported resource type.'; end if;
  if p_id is not null and p_id <> '' then
    update learning_materials set title = t, url = p_url, resource_type = p_resource_type,
      published = coalesce(p_published, true), updated_at = now(), updated_by = v_uid
      where id = p_id;
    if not found then raise exception 'not-available: Material not found.'; end if;
    return jsonb_build_object('id', p_id);
  end if;
  insert into learning_materials (title, url, resource_type, published, created_by, updated_by)
    values (t, p_url, p_resource_type, coalesce(p_published, true), v_uid, v_uid) returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create or replace function public.admin_set_published(p_id text, p_published boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.admin_require();
begin
  update learning_materials set published = coalesce(p_published, false), updated_at = now(), updated_by = v_uid
    where id = p_id;
  if not found then raise exception 'not-available: Material not found.'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_delete_material(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  delete from learning_materials where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Permissions + Realtime
-- ---------------------------------------------------------------------
-- Explicitly revoke PUBLIC execute on privileged helper functions.
revoke execute on function public.is_admin(), public.admin_require(),
  public.rtdb_authorize_write(text,text[],jsonb), public.rtdb_apply_internal(jsonb),
  public.rtdb_reap(), public.qm_room_active(text,uuid,timestamptz)
from public, anon, authenticated;
-- Internal tables are accessible only to the owning database role.
revoke all on public.admins, public.rtdb_sessions, public.rtdb_ondisconnect
from public, anon, authenticated;

-- Revoke only application RPCs; do not change unrelated project functions.
revoke execute on function public.rtdb_apply(jsonb), public.rtdb_cas(text,text[],bigint,jsonb),
  public.rtdb_session_beat(uuid), public.rtdb_ondisconnect_add(uuid,text,jsonb),
  public.rtdb_ondisconnect_cancel(uuid,text), public.rtdb_session_end(uuid),
  public.quick_match_join(text), public.quick_match_cancel(), public.rate_material(text,int),
  public.admin_verify_session(), public.admin_save_material(text,text,text,text,boolean),
  public.admin_set_published(text,boolean), public.admin_delete_material(text)
from public, anon;
grant execute on function
  public.is_admin(), public.rtdb_now_ms(),
  public.rtdb_apply(jsonb), public.rtdb_cas(text, text[], bigint, jsonb),
  public.rtdb_session_beat(uuid), public.rtdb_ondisconnect_add(uuid, text, jsonb),
  public.rtdb_ondisconnect_cancel(uuid, text), public.rtdb_session_end(uuid),
  public.quick_match_join(text), public.quick_match_cancel(),
  public.rate_material(text, int),
  public.admin_verify_session(), public.admin_save_material(text, text, text, text, boolean),
  public.admin_set_published(text, boolean), public.admin_delete_material(text)
to authenticated;
grant execute on function public.is_admin() to anon;
grant select on public.rtdb, public.quick_match_queue, public.quick_matches,
  public.learning_materials, public.material_ratings to authenticated;
grant select on public.learning_materials to anon;

do $$
declare t text;
begin
  foreach t in array array['rtdb', 'quick_match_queue', 'learning_materials'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- YOUR ADMIN: put the Google e-mail you sign in with here, then run.
-- ---------------------------------------------------------------------
insert into public.admins (email) values ('datathon2025x@gmail.com') on conflict (email) do nothing;
