-- Requires schema.sql and five_updates_migration.sql. Run username_preflight.sql first.
begin;
do $$ begin
 if exists(select 1 from public.rtdb where doc like 'users/%' and nullif(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g'),'') is not null group by lower(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g')) having count(*)>1) then
 raise exception 'Duplicate usernames exist. Run username_preflight.sql, ask those users to choose distinct usernames, then rerun this migration. No accounts have been renamed.';end if;
end $$;
create unique index if not exists bchess_unique_username on public.rtdb(lower(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g')))
 where doc like 'users/%' and nullif(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g'),'') is not null;
create or replace function public.bchess_username_normalize() returns trigger language plpgsql set search_path=public as $$
begin
 if new.doc like 'users/%' and jsonb_typeof(new.data->'username')='string' then
  new.data:=jsonb_set(new.data,'{username}',to_jsonb(regexp_replace(new.data->>'username','^[[:space:]]+|[[:space:]]+$','','g')));
 end if;return new;
end $$;
drop trigger if exists bchess_username_normalize on public.rtdb;
create trigger bchess_username_normalize before insert or update of data on public.rtdb for each row execute function public.bchess_username_normalize();

alter table public.puzzles add column if not exists batch_id uuid;
create or replace function public.admin_puzzle_list() returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.admin_require();return coalesce((select jsonb_agg(x order by x.stage) from(select id,row_number() over(order by stage) as stage,fen,batch_id,created_at from puzzles where published)x),'[]'::jsonb);end $$;
create or replace function public.admin_delete_puzzles(p_ids uuid[] default null,p_batch uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;begin perform public.admin_require();perform pg_advisory_xact_lock(hashtext('bchess:puzzle-import'));
 if p_batch is null and coalesce(cardinality(p_ids),0)=0 then raise exception 'Select puzzles to delete';end if;
 delete from puzzles where (p_batch is not null and batch_id=p_batch) or (p_batch is null and id=any(p_ids));get diagnostics n=row_count;
 return jsonb_build_object('deleted',n);end $$;
create or replace function public.get_puzzle_stages() returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();begin return jsonb_build_object(
 'puzzles',coalesce((select jsonb_agg(x order by x.stage) from(select id,row_number() over(order by stage) as stage,fen,solution from puzzles where published)x),'[]'::jsonb),
 'completed',coalesce((select jsonb_agg(puzzle_id) from puzzle_progress where user_id=u),'[]'::jsonb));end $$;
create or replace function public.admin_publish_puzzles(p_entries jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.admin_require();e jsonb;f text;n integer;added integer:=0;skipped integer:=0;seen jsonb:='{}';batch uuid:=gen_random_uuid();
begin perform pg_advisory_xact_lock(hashtext('bchess:puzzle-import'));
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 1000 then raise exception 'Expected 1 to 1000 entries';end if;
 select coalesce(max(stage),0) into n from puzzles;
 for e in select value from jsonb_array_elements(p_entries) loop
 f:=public.puzzle_entry_check(e);seen:=jsonb_set(seen,array[f],to_jsonb(coalesce((seen->>f)::int,0)+1));f:=md5(f||':'||(seen->>f));
 if exists(select 1 from puzzles where fingerprint=f) then skipped:=skipped+1;continue;end if;
 n:=n+1;insert into puzzles(stage,fingerprint,fen,solution,created_by,batch_id) values(n,f,e->>'fen',e->'solution',u,batch);added:=added+1;
 end loop;return jsonb_build_object('added',added,'skipped',skipped,'batch',batch);end $$;
-- Preview displays contiguous player-facing stage numbers, including after deletions.
create or replace function public.admin_preview_puzzles(p_entries jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare e jsonb;f text;n integer;existing integer;seen jsonb:='{}';stages jsonb:='[]';begin
 perform public.admin_require();if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>1000 then raise exception 'Expected up to 1000 entries';end if;
 select count(*) into n from puzzles where published;
 for e in select value from jsonb_array_elements(p_entries) loop
 f:=public.puzzle_entry_check(e);seen:=jsonb_set(seen,array[f],to_jsonb(coalesce((seen->>f)::int,0)+1));f:=md5(f||':'||(seen->>f));
 select x.rank into existing from(select fingerprint,row_number() over(order by stage)::int rank from puzzles where published)x where x.fingerprint=f;
 if existing is null then n:=n+1;end if;stages:=stages||jsonb_build_array(jsonb_build_object('stage',coalesce(existing,n),'existing',existing is not null));
 end loop;return jsonb_build_object('stages',stages);end $$;
create table if not exists public.puzzle_hint_usage(
 user_id uuid not null references auth.users(id) on delete cascade,day date not null,puzzle_id uuid not null,
 attempt uuid not null,ply int not null,source text not null,primary key(user_id,day,puzzle_id,attempt,ply)
);
alter table public.puzzle_hint_usage enable row level security;
revoke all on public.puzzle_hint_usage from anon,authenticated;
create or replace function public.puzzle_hint_status() returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();d date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;n int;begin
 select count(*) into n from puzzle_hint_usage where user_id=u and day=d;
 return jsonb_build_object('remaining',greatest(0,3-n),'day',d,'resetAt',((d+1)::timestamp at time zone 'Asia/Kolkata'));end $$;
create or replace function public.puzzle_hint(p_id uuid,p_attempt uuid,p_ply integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();d date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;p public.puzzles;src text;n int;
begin
 if p_attempt is null then raise exception 'Missing attempt';end if;
 perform pg_advisory_xact_lock(hashtext('hint:'||u::text));
 d:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
 select * into p from puzzles where id=p_id and published;
 if not found then raise exception 'Puzzle was removed';end if;
 if p_ply is null or p_ply<0 or p_ply%2<>0 or p_ply>=jsonb_array_length(p.solution) then raise exception 'No player hint at this move';end if;
 if exists(select 1 from puzzles a where a.published and a.stage<p.stage and not exists(select 1 from puzzle_progress b where b.user_id=u and b.puzzle_id=a.id)) then raise exception 'Complete earlier stages first';end if;
 select source into src from puzzle_hint_usage where user_id=u and day=d and puzzle_id=p_id and attempt=p_attempt and ply=p_ply;
 if src is null then
  select count(*) into n from puzzle_hint_usage where user_id=u and day=d;if n>=3 then raise exception 'No hints left. Resets at midnight IST.';end if;
  src:=left(p.solution->>p_ply,2);insert into puzzle_hint_usage values(u,d,p_id,p_attempt,p_ply,src);
 end if;return public.puzzle_hint_status()||jsonb_build_object('source',src);end $$;

create table if not exists public.chess_themes(id uuid primary key,name text not null check(length(name) between 2 and 60),kind text not null check(kind in('board','coins')),assets jsonb not null,created_by uuid not null,created_at timestamptz not null default now());
alter table public.chess_themes enable row level security;
drop policy if exists chess_themes_read on public.chess_themes;
create policy chess_themes_read on public.chess_themes for select to anon,authenticated using(true);
revoke all on public.chess_themes from anon,authenticated;grant select on public.chess_themes to anon,authenticated;
-- Called only by the authenticated Edge Function after byte validation and immutable asset upload.
create or replace function public.publish_theme_verified(p_uid uuid,p_id uuid,p_name text,p_kind text,p_assets jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare required text[];k text;begin
 if not exists(select 1 from admins a join auth.users u on lower(a.email)=lower(u.email) where a.active and u.id=p_uid) then raise exception 'Admin required';end if;
 required:=case when p_kind='board' then array['light','dark'] when p_kind='coins' then array['wk','wq','wr','wb','wn','wp','bk','bq','br','bb','bn','bp'] else null end;
 if required is null then raise exception 'Invalid theme kind';end if;
 foreach k in array required loop if p_assets->>k is distinct from p_id::text||'/'||k||'.png' then raise exception 'Invalid asset manifest';end if;end loop;
 insert into chess_themes values(p_id,btrim(p_name),p_kind,p_assets,p_uid,now());return p_id;end $$;
revoke execute on function public.publish_theme_verified(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_theme_verified(uuid,uuid,text,text,jsonb) to service_role;

create table if not exists public.tournaments(
 id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 2 and 80),
 category text not null check(category in('Blitz','Rapid')),base_seconds integer not null check(base_seconds between 30 and 7200),increment integer not null check(increment between 0 and 120),
 starts_at timestamptz not null,registration_opens timestamptz not null,registration_closes timestamptz not null,
 format text not null default 'round_robin' check(format='round_robin'),status text not null default 'draft' check(status in('draft','open','live','completed','cancelled')),
 created_by uuid not null,created_at timestamptz not null default now(),check(registration_opens<registration_closes and registration_closes<=starts_at)
);
create table if not exists public.tournament_entries(
 tournament_id uuid references public.tournaments on delete cascade,user_id uuid references auth.users on delete cascade,
 name text not null,photo text not null default '',joined_at timestamptz not null default now(),primary key(tournament_id,user_id)
);
create table if not exists public.tournament_games(
 id uuid primary key default gen_random_uuid(),tournament_id uuid not null references public.tournaments,round integer not null,
 white_id uuid,black_id uuid,status text not null check(status in('queued','active','finished','cancelled')),
 fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',moves jsonb not null default '[]',
 version integer not null default 0,turn text not null default 'w',white_left double precision not null,black_left double precision not null,
 started_at timestamptz,clock_at timestamptz,white_seen timestamptz,black_seen timestamptz,draw_offer uuid,
 result text,winner uuid,finished_at timestamptz,
 check(white_id is null or black_id is null or white_id<>black_id),unique(tournament_id,round,white_id),unique(tournament_id,round,black_id)
);
create unique index if not exists tournament_pair_once on public.tournament_games(tournament_id,least(white_id,black_id),greatest(white_id,black_id)) where white_id is not null and black_id is not null;
alter table public.tournaments enable row level security;alter table public.tournament_entries enable row level security;alter table public.tournament_games enable row level security;
revoke all on public.tournaments,public.tournament_entries,public.tournament_games from anon,authenticated;
grant select on public.tournaments,public.tournament_entries,public.tournament_games to authenticated;
drop policy if exists tournaments_read on public.tournaments;create policy tournaments_read on public.tournaments for select to authenticated using(status<>'draft' or public.is_admin());
drop policy if exists tournament_entries_read on public.tournament_entries;create policy tournament_entries_read on public.tournament_entries for select to authenticated using(exists(select 1 from tournaments t where t.id=tournament_id and (t.status<>'draft' or public.is_admin())));
drop policy if exists tournament_games_read on public.tournament_games;create policy tournament_games_read on public.tournament_games for select to authenticated using(exists(select 1 from tournaments t where t.id=tournament_id and (t.status<>'draft' or public.is_admin())));

create or replace function public.tournament_admin_save(p_id uuid,p_config jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=public.admin_require();v uuid:=coalesce(p_id,gen_random_uuid());begin
 perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));
 if p_id is not null and not exists(select 1 from tournaments where id=p_id and status in('draft','open')) then raise exception 'Only unstarted tournaments can be edited';end if;
 insert into tournaments(id,name,category,base_seconds,increment,starts_at,registration_opens,registration_closes,status,created_by)
 values(v,btrim(p_config->>'name'),p_config->>'category',(p_config->>'base_seconds')::int,(p_config->>'increment')::int,(p_config->>'starts_at')::timestamptz,(p_config->>'registration_opens')::timestamptz,(p_config->>'registration_closes')::timestamptz,case when (p_config->>'published')::boolean then 'open' else 'draft' end,u)
 on conflict(id) do update set name=excluded.name,category=excluded.category,base_seconds=excluded.base_seconds,increment=excluded.increment,starts_at=excluded.starts_at,registration_opens=excluded.registration_opens,registration_closes=excluded.registration_closes,status=excluded.status;
 return v;end $$;
create or replace function public.tournament_join(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();t public.tournaments;p jsonb;begin
 perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));select * into t from tournaments where id=p_id for update;
 if not found or t.status<>'open' or clock_timestamp()<t.registration_opens or clock_timestamp()>=t.registration_closes then raise exception 'Registration is closed';end if;
 if exists(select 1 from tournament_entries where tournament_id=p_id and user_id=u) then return;end if;
 select data into p from rtdb where doc='users/'||u;
 insert into tournament_entries(tournament_id,user_id,name,photo) values(p_id,u,left(coalesce(p->>'username','Player'),40),coalesce(nullif(p->>'photoData',''),(select coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture') from auth.users where id=u),''));end $$;

-- Internal helpers are not callable by browsers.
create or replace function public.tournament_advance(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r int;begin
 if not exists(select 1 from tournaments where id=p_id and status='live') or exists(select 1 from tournament_games where tournament_id=p_id and status='active') then return;end if;
 select min(round) into r from tournament_games where tournament_id=p_id and status='queued';
 if r is null then update tournaments set status='completed' where id=p_id and status='live';return;end if;
 update tournament_games set status=case when white_id is null or black_id is null then 'finished' else 'active' end,
 result=case when white_id is null or black_id is null then 'bye' else null end,started_at=clock_timestamp(),finished_at=case when white_id is null or black_id is null then clock_timestamp() end
 where tournament_id=p_id and round=r and status='queued';
end $$;
create or replace function public.tournament_tick(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare g public.tournament_games;nowt timestamptz:=clock_timestamp();wlate boolean;blate boolean;expired boolean;win uuid;reason text;begin
 for g in select * from tournament_games where tournament_id=p_id and status='active' order by id for update loop
 reason:=null;win:=null;
 expired:=g.clock_at is not null and extract(epoch from(nowt-g.clock_at))>=case when g.turn='w' then g.white_left else g.black_left end;
 wlate:=nowt-coalesce(g.white_seen,g.started_at)>=interval '60 seconds';blate:=nowt-coalesce(g.black_seen,g.started_at)>=interval '60 seconds';
 if expired then reason:='timeout';win:=case when g.turn='w' then g.black_id else g.white_id end;
 elsif wlate and blate then reason:='double_forfeit';
 elsif wlate then reason:='disconnect';win:=g.black_id;
 elsif blate then reason:='disconnect';win:=g.white_id;end if;
 if reason is not null then update tournament_games set status='finished',result=reason,winner=win,finished_at=nowt,version=version+1 where id=g.id;end if;
 end loop;perform public.tournament_advance(p_id);end $$;
create or replace function public.tournament_admin_action(p_id uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
declare t public.tournaments;a uuid[];n int;r int;i int;w uuid;b uuid;lastid uuid;begin
 perform public.admin_require();perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));
 select * into t from tournaments where id=p_id for update;if not found then raise exception 'Tournament not found';end if;
 if p_action='cancel' then
 if t.status in('completed','cancelled') then raise exception 'Tournament already ended';end if;
 update tournaments set status='cancelled' where id=p_id;update tournament_games set status='cancelled',result='cancelled',version=version+1 where tournament_id=p_id and status in('queued','active');return;
 elsif p_action='finish' then
 perform public.tournament_tick(p_id);
 if exists(select 1 from tournament_games where tournament_id=p_id and status in('queued','active')) then raise exception 'Play all rounds before finishing, or cancel the tournament';end if;
 if t.status not in('live','completed') then raise exception 'Tournament has not started';end if;
 update tournaments set status='completed' where id=p_id;return;
 elsif p_action<>'start' then raise exception 'Unknown action';end if;
 if t.status='live' then return;end if;
 if t.status<>'open' or clock_timestamp()<t.starts_at then raise exception 'Tournament is not ready to start';end if;
 select array_agg(user_id order by joined_at,user_id) into a from tournament_entries where tournament_id=p_id;n:=coalesce(cardinality(a),0);
 if n<2 then raise exception 'At least two players are required';end if;
 if exists(select 1 from tournament_entries e join tournaments x on x.id=e.tournament_id where e.user_id=any(a) and x.status='live' and x.id<>p_id) then raise exception 'A registered player is already in another live tournament';end if;
 if exists(select 1 from quick_match_queue q where q.user_id=any(a) and q.status='matched' and public.qm_room_active(q.room_code,q.user_id,q.matched_at)) then raise exception 'A registered player has an active Quick Match';end if;
 if exists(select 1 from rtdb d where d.doc like 'rooms/%' and d.data->>'creatorId' is not null and d.data->>'guestId' is not null and coalesce((d.data->>'gameOver')::boolean,false)=false and ((d.data->>'creatorId')=any(a::text[]) or (d.data->>'guestId')=any(a::text[]))) then raise exception 'A registered player has an active friend match';end if;
 delete from quick_match_queue where user_id=any(a) and status='waiting';
 update quick_match_searches set state='cancelled' where user_id=any(a) and state='searching';
 if n%2=1 then a:=array_append(a,null::uuid);n:=n+1;end if;
 for r in 1..n-1 loop
 for i in 1..n/2 loop
 w:=a[i];b:=a[n+1-i];if (r+i)%2=0 then w:=a[n+1-i];b:=a[i];end if;
 insert into tournament_games(tournament_id,round,white_id,black_id,status,white_left,black_left) values(p_id,r,w,b,'queued',t.base_seconds,t.base_seconds);
 end loop;lastid:=a[n];a:=array[a[1],lastid]||a[2:n-1];
 end loop;update tournaments set status='live' where id=p_id;perform public.tournament_advance(p_id);end $$;

create or replace function public.tournament_game_action(p_game uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();g public.tournament_games;tid uuid;begin
 perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));
 select tournament_id into tid from tournament_games where id=p_game;
 if tid is null then raise exception 'Game not found';end if;
 perform public.tournament_tick(tid);select * into g from tournament_games where id=p_game for update;
 if u is distinct from g.white_id and u is distinct from g.black_id then raise exception 'Not your match';end if;
 if g.status<>'active' then return to_jsonb(g);end if;
 if p_action='heartbeat' then
 update tournament_games set white_seen=case when u=white_id then clock_timestamp() else white_seen end,black_seen=case when u=black_id then clock_timestamp() else black_seen end where id=p_game;
 update tournament_games set clock_at=clock_timestamp() where id=p_game and clock_at is null and white_seen is not null and black_seen is not null;
 elsif p_action='resign' then update tournament_games set status='finished',result='resigned',winner=case when u=white_id then black_id else white_id end,finished_at=clock_timestamp(),version=version+1 where id=p_game;
 elsif p_action='offer_draw' then update tournament_games set draw_offer=u where id=p_game;
 elsif p_action='accept_draw' then
 if g.draw_offer is null or g.draw_offer=u then raise exception 'No opponent draw offer';end if;
 update tournament_games set status='finished',result='draw_agreed',winner=null,finished_at=clock_timestamp(),version=version+1 where id=p_game;
 else raise exception 'Unknown action';end if;
 perform public.tournament_advance(tid);select * into g from tournament_games where id=p_game;return to_jsonb(g);end $$;

-- Trusted Edge Function computes legality and terminal state by replaying stored moves.
create or replace function public.tournament_commit_move(p_uid uuid,p_game uuid,p_version int,p_move text,p_fen text,p_terminal text) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.tournament_games;t public.tournaments;tid uuid;lefttime double precision;begin
 perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));select tournament_id into tid from tournament_games where id=p_game;
 if tid is null then raise exception 'Game not found';end if;
 perform public.tournament_tick(tid);select * into g from tournament_games where id=p_game for update;select * into t from tournaments where id=tid;
 if g.status<>'active' then return to_jsonb(g);end if;
 if g.version<>p_version then raise exception 'Position changed. Refresh and retry.';end if;
 if p_uid is distinct from (case when g.turn='w' then g.white_id else g.black_id end) then raise exception 'Not your turn';end if;
 if g.clock_at is null then raise exception 'Waiting for both players';end if;
 if p_terminal is not null and p_terminal not in('checkmate','draw') then raise exception 'Invalid terminal result';end if;
 lefttime:=(case when g.turn='w' then g.white_left else g.black_left end)-extract(epoch from(clock_timestamp()-g.clock_at));
 if lefttime<=0 then perform public.tournament_tick(tid);select * into g from tournament_games where id=p_game;return to_jsonb(g);end if;
 update tournament_games set fen=p_fen,moves=moves||jsonb_build_array(p_move),version=version+1,turn=case when turn='w' then 'b' else 'w' end,
 white_left=case when g.turn='w' then lefttime+t.increment else white_left end,black_left=case when g.turn='b' then lefttime+t.increment else black_left end,
 white_seen=case when g.turn='w' then clock_timestamp() else white_seen end,black_seen=case when g.turn='b' then clock_timestamp() else black_seen end,
 clock_at=clock_timestamp(),draw_offer=null,status=case when p_terminal is null then 'active' else 'finished' end,result=p_terminal,
 winner=case when p_terminal='checkmate' then p_uid else null end,finished_at=case when p_terminal is not null then clock_timestamp() end where id=p_game;
 perform public.tournament_advance(tid);select * into g from tournament_games where id=p_game;return to_jsonb(g);end $$;

create or replace function public.tournament_list() returns jsonb language plpgsql security definer set search_path=public as $$
begin perform public.rtdb_require_user();return coalesce((select jsonb_agg(x order by x.starts_at desc) from(select t.*,(select count(*) from tournament_entries e where e.tournament_id=t.id) as players from tournaments t where t.status<>'draft' or public.is_admin())x),'[]'::jsonb);end $$;
create or replace function public.tournament_view(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user();t public.tournaments;entries jsonb;games jsonb;standings jsonb;begin
 perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));select * into t from tournaments where id=p_id;
 if not found or (t.status='draft' and not public.is_admin()) then raise exception 'Tournament unavailable';end if;
 perform public.tournament_tick(p_id);select * into t from tournaments where id=p_id;
 select coalesce(jsonb_agg(e order by joined_at),'[]') into entries from tournament_entries e where tournament_id=p_id;
 select coalesce(jsonb_agg(g order by round,id),'[]') into games from tournament_games g where tournament_id=p_id;
 with scores as(select e.*,coalesce((select sum(case when g.winner=e.user_id then 1 when g.result in('draw','draw_agreed') then 0.5 else 0 end) from tournament_games g where g.tournament_id=p_id and g.status='finished' and e.user_id in(g.white_id,g.black_id)),0) points,
 (select count(*) from tournament_games g where g.tournament_id=p_id and g.status='finished' and g.winner=e.user_id) wins,
 (select count(*) from tournament_games g where g.tournament_id=p_id and g.status='finished' and g.result in('draw','draw_agreed') and e.user_id in(g.white_id,g.black_id)) draws
 from tournament_entries e where e.tournament_id=p_id)
 select coalesce(jsonb_agg(s order by points desc,wins desc,joined_at,user_id),'[]') into standings from scores s;
 return jsonb_build_object('tournament',to_jsonb(t),'entries',entries,'games',games,'standings',standings,'serverNow',clock_timestamp());end $$;

revoke execute on function public.tournament_advance(uuid),public.tournament_tick(uuid),public.tournament_commit_move(uuid,uuid,int,text,text,text) from public,anon,authenticated;
grant execute on function public.tournament_commit_move(uuid,uuid,int,text,text,text) to service_role;
revoke execute on function public.admin_puzzle_list(),public.admin_delete_puzzles(uuid[],uuid),public.puzzle_hint_status(),public.puzzle_hint(uuid,uuid,int),public.tournament_admin_save(uuid,jsonb),public.tournament_join(uuid),public.tournament_admin_action(uuid,text),public.tournament_game_action(uuid,text),public.tournament_list(),public.tournament_view(uuid) from public,anon;
grant execute on function public.admin_puzzle_list(),public.admin_delete_puzzles(uuid[],uuid),public.puzzle_hint_status(),public.puzzle_hint(uuid,uuid,int),public.tournament_admin_save(uuid,jsonb),public.tournament_join(uuid),public.tournament_admin_action(uuid,text),public.tournament_game_action(uuid,text),public.tournament_list(),public.tournament_view(uuid) to authenticated;

-- Keep existing Quick Match behavior, but prevent starting it during a live tournament.
create or replace function public.quick_match_search(p_search uuid,p_time_control text,p_deadline_ms bigint default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=public.rtdb_require_user(); s public.quick_match_searches; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));
 perform pg_advisory_xact_lock(hashtext('bchess:search-resolution'));
 if exists(select 1 from tournament_entries e join tournaments t on t.id=e.tournament_id where e.user_id=u and t.status='live') then raise exception 'Finish your tournament first';end if;
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
revoke execute on function public.quick_match_search(uuid,text,bigint) from public,anon;
grant execute on function public.quick_match_search(uuid,text,bigint) to authenticated;
create or replace function public.tournament_room_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.doc like 'rooms/%' then perform pg_advisory_xact_lock(hashtext('bchess:tournaments'));end if;
 if new.doc like 'rooms/%' and coalesce((new.data->>'gameOver')::boolean,false)=false and exists(select 1 from tournament_entries e join tournaments t on t.id=e.tournament_id where t.status='live' and (e.user_id::text=new.data->>'creatorId' or e.user_id::text=new.data->>'guestId')) then raise exception 'Finish the live tournament before starting another match';end if;return new;
end $$;
drop trigger if exists tournament_room_guard on public.rtdb;
create trigger tournament_room_guard before insert or update of data on public.rtdb for each row execute function public.tournament_room_guard();
revoke execute on function public.tournament_room_guard(),public.bchess_username_normalize() from public,anon,authenticated;
commit;
