begin;

-- Only the fields already shown by Inspect are returned. Keep the raw rtdb policy.
create or replace function public.bchess_inspect_search(p_prefix text)
returns table(id uuid, username text, rating numeric, photo text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  prefix text := lower(trim(p_prefix));
begin
  perform public.rtdb_require_user();
  if prefix is null or length(prefix) not between 1 and 20 then return; end if;
  return query
    select u.id, r.data->>'username', coalesce((r.data->>'rating')::numeric, 800),
      coalesce(nullif(r.data->>'photoData', ''), nullif(r.data->>'photo', ''), r.data->>'photoURL', '')
    from public.rtdb r
    join auth.users u on r.doc = 'users/' || u.id::text
    where starts_with(lower(r.data->>'username'), prefix)
    order by lower(r.data->>'username'), u.id
    limit 10;
end $$;

create or replace function public.bchess_inspect_profile(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare profile jsonb;
begin
  perform public.rtdb_require_user();
  select data into profile from public.rtdb where doc = 'users/' || p_uid::text;
  if nullif(profile->>'username', '') is null then return null; end if;
  return jsonb_build_object(
    'username', profile->>'username',
    'rating', profile->'rating',
    'photo', coalesce(nullif(profile->>'photoData', ''), nullif(profile->>'photo', ''), profile->>'photoURL', ''),
    'matchHistory', (select coalesce(jsonb_object_agg(code, jsonb_build_object(
      'opponentId', match->>'opponentId', 'opponentName', match->>'opponentName',
      'result', match->>'result', 'resultType', match->>'resultType', 'timeLabel', match->>'timeLabel',
      'playedAt', match->'playedAt', 'moves', match->'moves'
    )), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(profile->'matchHistory') = 'object'
      then profile->'matchHistory' else '{}'::jsonb end) as history(code, match)
    where match->>'result' in ('win', 'loss', 'draw'))
  );
end $$;

create or replace function public.club_vip_members()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.admin_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('uid', uid, 'username', username)
      order by lower(username), uid), '[]'::jsonb)
    from (select g.uid, coalesce(nullif(r.data->>'username', ''), 'Player') as username
      from public.club_gold g left join public.rtdb r on r.doc = 'users/' || g.uid::text) members);
end $$;

revoke all on function public.bchess_inspect_search(text), public.bchess_inspect_profile(uuid),
  public.club_vip_members() from public, anon;
grant execute on function public.bchess_inspect_search(text), public.bchess_inspect_profile(uuid),
  public.club_vip_members() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'club_gold') then
    alter publication supabase_realtime add table public.club_gold;
  end if;
end $$;

-- The Firebase compatibility layer omits empty arrays on new room writes.
-- Treat missing history as empty only during the existing fresh-room checks.
create or replace function public.bchess_room_apply(
  p_uid uuid, p_code text, p_action text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  room jsonb; profile jsonb; moves jsonb; patch jsonb; history_record jsonb;
  room_doc text := 'rooms/' || p_code;
  white_id text; black_id text; uid text := p_uid::text; turn text; player_color text;
  player_id text; winner text; result text; left_by text; clock_key text;
  now_ms bigint; elapsed numeric; remaining numeric; base_seconds numeric; point_change int;
begin
  if p_uid is null or p_code is null or p_code !~ '^[A-Za-z0-9_-]{1,60}$' then raise exception 'Invalid room'; end if;
  select data into room from public.rtdb where doc = room_doc for update;
  if room is null or room = 'null'::jsonb then raise exception 'Room unavailable'; end if;
  white_id := room->>'creatorId';
  black_id := room->>'guestId';
  if white_id is null then raise exception 'Room unavailable'; end if;
  player_color := case when uid = white_id then 'w' when uid = black_id then 'b' end;
  if p_action = 'join' then
    if uid = white_id or coalesce((room->>'gameOver')::boolean,false)
       or (black_id is not null and black_id <> uid)
       or (black_id is null and (room->>'status' is distinct from 'waiting'
          or (room->>'challengeFriendId' is not null and room->>'challengeFriendId' <> uid))) then
      raise exception 'Room unavailable';
    end if;
    if black_id = uid and room->>'bchessAuthorizedGuest' = uid then return room; end if;
    if room->>'quickMatch' = 'true' then raise exception 'Use Quick Match to enter this room'; end if;
    select data into profile from public.rtdb where doc = 'users/' || uid;
    if room->>'gameFen' is distinct from 'start' or
       coalesce(nullif(room->'moveHistory', 'null'::jsonb), '[]'::jsonb) <> '[]'::jsonb or room->>'clockStartedAt' is not null
      then raise exception 'Create a fresh Friends room for this update'; end if;
    patch := jsonb_build_object('guestId',uid,'bchessAuthorizedGuest',uid,'guestName',coalesce(profile->>'username','Player'),
      'guestRating',coalesce((profile->>'rating')::numeric,800),'guestPhoto',coalesce(profile->>'photoData',''),
      'status','playing','gameOver',false);
  elsif p_action = 'cancel' and black_id is null and room->>'status' = 'waiting'
      and (uid = white_id or uid = room->>'challengeFriendId') then
    update public.rtdb set data = null, version = version + 1, updated_at = now() where doc = room_doc;
    return null;
  else
    if player_color is null or black_id is null then raise exception 'Active room membership required'; end if;
    if room->>'quickMatch' = 'true' then
      if not exists (select 1 from public.quick_matches m where m.room_code = p_code
        and m.id::text = room->>'matchId' and m.player1->>'uid' = white_id and m.player2->>'uid' = black_id)
      then raise exception 'Quick Match assignment not found'; end if;
    elsif room->>'bchessAuthorizedGuest' is distinct from black_id then
      raise exception 'The guest must join the Friends room before play';
    end if;
    if coalesce((room->>'gameOver')::boolean,false) then return room; end if;
    moves := case when jsonb_typeof(room->'moveHistory') = 'array' then room->'moveHistory' else '[]'::jsonb end;
    now_ms := public.rtdb_now_ms();
    base_seconds := coalesce((room->>'timeControl')::numeric,0);
    turn := case when jsonb_array_length(moves) % 2 = 0 then 'w' else 'b' end;
    clock_key := case when turn = 'w' then 'whiteTimeLeft' else 'blackTimeLeft' end;
    elapsed := greatest(0,now_ms - coalesce((room->>'clockStartedAt')::bigint,now_ms)) / 1000.0;
    remaining := coalesce((room->>clock_key)::numeric,base_seconds) - elapsed;
    patch := '{}'::jsonb;
    case p_action
      when 'start' then
        if base_seconds <= 0 or room->>'clockStartedAt' is not null then return room; end if;
        if room->>'quickMatch' = 'true' and (
          room->'presence'->>white_id is distinct from 'true' or room->'presence'->>black_id is distinct from 'true'
        ) then return room; end if;
        patch := jsonb_build_object('clockTurn',turn,'clockStartedAt',now_ms,'whiteTimeLeft',base_seconds,'blackTimeLeft',base_seconds);
      when 'move' then
        if turn <> player_color or p_payload->>'before' is distinct from coalesce(room->>'gameFen','start')
          or (p_payload->>'ply')::integer is distinct from jsonb_array_length(moves) then raise exception 'Position changed. Try again.'; end if;
        if base_seconds > 0 and room->>'clockStartedAt' is null then raise exception 'Waiting for the match clock'; end if;
        if base_seconds > 0 and remaining <= 0 then
          result := 'timeout'; winner := case when turn = 'w' then black_id else white_id end;
          patch := jsonb_build_object('timeoutColor',turn);
        else
          moves := moves || jsonb_build_array(p_payload->>'san');
          patch := jsonb_build_object('gameFen',p_payload->>'fen','moveHistory',moves,'lastMove',p_payload->'lastMove');
          if base_seconds > 0 then
            patch := patch || jsonb_build_object(clock_key,remaining + coalesce((room->>'increment')::numeric,0),
              'clockTurn',case when turn = 'w' then 'b' else 'w' end,'clockStartedAt',now_ms);
          end if;
          if p_payload->>'terminal' = 'checkmate' then result := 'checkmate'; winner := uid;
          elsif p_payload->>'terminal' = 'draw' then result := 'draw'; end if;
        end if;
      when 'timeout' then
        if base_seconds <= 0 or room->>'clockStartedAt' is null or remaining > 0 then return room; end if;
        result := 'timeout'; winner := case when turn = 'w' then black_id else white_id end;
        patch := jsonb_build_object('timeoutColor',turn);
      when 'draw' then
        if room->>'drawOffer' is distinct from (case when uid = white_id then black_id else white_id end)
          then raise exception 'No opponent draw offer'; end if;
        result := 'draw';
      when 'resign' then
        result := 'resigned'; winner := case when uid = white_id then black_id else white_id end;
        patch := jsonb_build_object('loser',uid);
      when 'leave' then
        result := 'left'; left_by := uid; winner := case when uid = white_id then black_id else white_id end;
      when 'disconnected' then
        left_by := case when uid = white_id then black_id else white_id end;
        if room->>'quickMatch' is distinct from 'true' or room->'presence'->>left_by = 'true' then return room; end if;
        if jsonb_array_length(moves) = 0 then result := 'aborted';
        else result := 'left'; winner := uid; end if;
      else raise exception 'Invalid room action';
    end case;
    if result is not null then
      patch := patch || jsonb_build_object('gameOver',true,'result',result,'winner',winner,'drawOffer',null);
      if left_by is not null then patch := patch || jsonb_build_object('leftBy',left_by); end if;
    end if;
  end if;
  room := room || patch;
  update public.rtdb set data=room, version=version+1, updated_at=now() where doc=room_doc;

  if result is not null and result <> 'aborted' then
    -- The room lock makes each result and its history entries single-write.
    for player_id in select unnest(array[white_id,black_id]) order by 1 loop
      history_record := jsonb_build_object('roomCode',p_code,'opponentId',case when player_id=white_id then black_id else white_id end,
        'opponentName',case when player_id=white_id then room->>'guestName' else room->>'creatorName' end,
        'result',case when winner is null then 'draw' when winner=player_id then 'win' else 'loss' end,
        'resultType',result,'winnerId',winner,'timeControl',base_seconds,
        'timeLabel',coalesce(room->>'quickLabel',case base_seconds when 600 then 'Rapid • 10 min' when 300 then 'Blitz • 5 min' when 60 then 'Bullet • 1 min' else 'No Timer' end),
        'moves',moves,'playedAt',now_ms);
      point_change := case when result in ('checkmate','resigned') then case when player_id=winner then 8 else -8 end else 0 end;
      update public.rtdb
        set data=public.rtdb_jset(
          case when point_change=0 then data else data || jsonb_build_object('rating',
            greatest(100,coalesce((data->>'rating')::numeric,800)+point_change)) end,
          array['matchHistory',p_code],history_record),
          version=version+1, updated_at=now()
        where doc='users/' || player_id and data is not null;
    end loop;
  end if;
  return room;
end $$;

revoke all on function public.bchess_room_apply(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.bchess_room_apply(uuid,text,text,jsonb) to service_role;

commit;
