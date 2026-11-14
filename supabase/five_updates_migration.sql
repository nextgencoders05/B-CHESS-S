-- Apply AFTER the existing schema.sql. Safe to rerun. No existing game data is removed.
begin;
create table if not exists public.quick_match_searches (
 user_id uuid primary key, search_id uuid not null, time_key text not null,
 deadline timestamptz not null, state text not null check(state in ('searching','bot','cancelled','matched'))
);
alter table public.quick_match_searches enable row level security;
revoke all on public.quick_match_searches from anon, authenticated;
create or replace function public.quick_match_pair_internal(p_time_control text) returns jsonb
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


-- All public pairing and resolution calls share this lock, including cross-control retries.
create or replace function public.quick_match_search(p_search uuid,p_time_control text,p_deadline_ms bigint default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user(); s public.quick_match_searches; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('bchess:search-resolution'));
 if public.qm_time_control(p_time_control) is null then raise exception 'Invalid time control'; end if;
 select * into s from quick_match_searches where user_id=u for update;
 if found and s.search_id=p_search and s.state<>'searching' then
   if s.state='matched' then select public.qm_payload(q,false) into result from quick_match_queue q where q.user_id=u; return result; end if;
   return jsonb_build_object('status',s.state);
 end if;
 if not found or s.search_id<>p_search then
   if s.state='searching' and s.deadline>clock_timestamp() then raise exception 'A search is already active'; end if;
   insert into quick_match_searches values(u,p_search,p_time_control,least(clock_timestamp()+interval '30 seconds',coalesce(to_timestamp(p_deadline_ms/1000.0),clock_timestamp()+interval '30 seconds')),'searching')
     on conflict(user_id) do update set search_id=excluded.search_id,time_key=excluded.time_key,deadline=excluded.deadline,state='searching';
   select * into s from quick_match_searches where user_id=u;
 end if;
 if s.time_key<>p_time_control then raise exception 'Search time control cannot change'; end if;
 -- Expired/cancelled searches cannot be selected by the existing pairing engine.
 delete from quick_match_queue q where q.status='waiting' and not exists
   (select 1 from quick_match_searches a where a.user_id=q.user_id and a.state='searching' and a.deadline>clock_timestamp());
 if s.deadline<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
 result:=public.quick_match_pair_internal(p_time_control);
 if result->>'status'='matched' then
   update quick_match_searches set state='matched' where user_id in
     (select user_id from quick_match_queue where room_code=result->>'roomCode');
 end if;
 return result;
end $$;
create or replace function public.quick_match_resolve(p_search uuid,p_cancel boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();s public.quick_match_searches;q public.quick_match_queue;
begin
 perform pg_advisory_xact_lock(hashtext('bchess:search-resolution'));
 select * into s from quick_match_searches where user_id=u for update;
 if not found or s.search_id<>p_search then return jsonb_build_object('status','cancelled'); end if;
 select * into q from quick_match_queue where user_id=u for update;
 -- Pairing won the lock before the cutoff: always honor that human assignment.
 if q.status='matched' and public.qm_room_active(q.room_code,u,q.matched_at) then
   update quick_match_searches set state='matched' where user_id=u;
   return public.qm_payload(q,false);
 end if;
 delete from quick_match_queue where user_id=u;
 update quick_match_searches set state=case when p_cancel or state='cancelled' then 'cancelled' else 'bot' end where user_id=u returning * into s;
 return jsonb_build_object('status',s.state);
end $$;
-- Disable the old entry points so stale clients cannot bypass the cutoff lock.
revoke execute on function public.quick_match_join(text),public.quick_match_cancel(),public.quick_match_pair_internal(text) from public,anon,authenticated;
revoke execute on function public.quick_match_search(uuid,text,bigint),public.quick_match_resolve(uuid,boolean) from public,anon;
grant execute on function public.quick_match_search(uuid,text,bigint),public.quick_match_resolve(uuid,boolean) to authenticated;

create table if not exists public.puzzles (
 id uuid primary key default gen_random_uuid(), stage integer unique not null check(stage>0),
 fingerprint text unique not null, fen text not null, solution jsonb not null,
 published boolean not null default true, created_by uuid not null, created_at timestamptz not null default now()
);
create table if not exists public.puzzle_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 puzzle_id uuid not null references public.puzzles(id) on delete cascade,
 completed_at timestamptz not null default now(),primary key(user_id,puzzle_id)
);
alter table public.puzzles enable row level security;
alter table public.puzzle_progress enable row level security;
drop policy if exists puzzles_read on public.puzzles;
create policy puzzles_read on public.puzzles for select to authenticated using(published or public.is_admin());
drop policy if exists puzzle_progress_own on public.puzzle_progress;
create policy puzzle_progress_own on public.puzzle_progress for select to authenticated using(user_id=auth.uid());
revoke all on public.puzzles,public.puzzle_progress from anon,authenticated;
grant select on public.puzzles,public.puzzle_progress to authenticated;

-- The client replays every line with chess.js before preview/publish. The server
-- additionally validates the canonical payload and authorizes every mutation.
create or replace function public.puzzle_entry_check(e jsonb) returns text
language plpgsql immutable set search_path=public as $$
declare m text; fen text:=e->>'fen';
begin
 if fen is null or fen!~'^[prnbqkPRNBQK1-8/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) [0-9]+ [1-9][0-9]*$' then raise exception 'Invalid FEN';end if;
 if jsonb_typeof(e->'solution') is distinct from 'array' then raise exception 'Solution must be an array';end if;
 if jsonb_array_length(e->'solution') not between 1 and 500 then raise exception 'Solution needs 1 to 500 moves';end if;
 for m in select jsonb_array_elements_text(e->'solution') loop
   if m!~'^[a-h][1-8][a-h][1-8][qrbn]?$' then raise exception 'Invalid UCI solution';end if;
 end loop;
 return md5(fen||'|'||(e->'solution')::text);
end $$;
create or replace function public.admin_preview_puzzles(p_entries jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e jsonb; f text; n integer; existing integer; seen jsonb:='{}'; stages jsonb:='[]';
begin
 perform public.admin_require();
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>1000 then raise exception 'Expected up to 1000 entries';end if;
 select coalesce(max(stage),0) into n from puzzles;
 for e in select value from jsonb_array_elements(p_entries) loop
   f:=public.puzzle_entry_check(e);
   seen:=jsonb_set(seen,array[f],to_jsonb(coalesce((seen->>f)::int,0)+1));
   f:=md5(f||':'||(seen->>f));
   select stage into existing from puzzles where fingerprint=f;
   if existing is null then n:=n+1;end if;
   stages:=stages||jsonb_build_array(jsonb_build_object('stage',coalesce(existing,n),'existing',existing is not null));
 end loop;
 return jsonb_build_object('stages',stages);
end $$;
create or replace function public.admin_publish_puzzles(p_entries jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=public.admin_require();e jsonb;f text;n integer;added integer:=0;skipped integer:=0;seen jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtext('bchess:puzzle-import'));
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 1000 then raise exception 'Expected 1 to 1000 entries';end if;
 select coalesce(max(stage),0) into n from puzzles;
 for e in select value from jsonb_array_elements(p_entries) loop
   f:=public.puzzle_entry_check(e);
   seen:=jsonb_set(seen,array[f],to_jsonb(coalesce((seen->>f)::int,0)+1));
   f:=md5(f||':'||(seen->>f));
   if exists(select 1 from puzzles where fingerprint=f) then skipped:=skipped+1;continue;end if;
   n:=n+1;insert into puzzles(stage,fingerprint,fen,solution,created_by) values(n,f,e->>'fen',e->'solution',u);added:=added+1;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped);
end $$;
create or replace function public.get_puzzle_stages() returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();
begin
 return jsonb_build_object('puzzles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stage',stage,'fen',fen,'solution',solution) order by stage) from puzzles where published),'[]'::jsonb),
 'completed',coalesce((select jsonb_agg(puzzle_id) from puzzle_progress where user_id=u),'[]'::jsonb));
end $$;
create or replace function public.complete_puzzle(p_id uuid,p_moves jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();p public.puzzles;
begin
 select * into p from puzzles where id=p_id and published;
 if not found then raise exception 'Puzzle is not published';end if;
 if exists(select 1 from puzzles a where a.published and a.stage<p.stage and not exists(select 1 from puzzle_progress b where b.user_id=u and b.puzzle_id=a.id)) then raise exception 'Complete the earlier stages first';end if;
 if p_moves is distinct from p.solution then raise exception 'Solution is not complete';end if;
 insert into puzzle_progress(user_id,puzzle_id) values(u,p.id) on conflict do nothing;
 return jsonb_build_object('completed',true);
end $$;
revoke execute on function public.puzzle_entry_check(jsonb),public.admin_preview_puzzles(jsonb),public.admin_publish_puzzles(jsonb),public.get_puzzle_stages(),public.complete_puzzle(uuid,jsonb) from public,anon;
grant execute on function public.admin_preview_puzzles(jsonb),public.admin_publish_puzzles(jsonb),public.get_puzzle_stages(),public.complete_puzzle(uuid,jsonb) to authenticated;
commit;
