begin;

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
      if p_value ? 'bchessAuthorizedGuest' then raise exception 'permission-denied: Protected room field'; end if;
      return;
    end if;
    v_creator := v_room->>'creatorId';
    v_guest := v_room->>'guestId';
    if v_uid::text <> coalesce(v_creator,'') and v_uid::text <> coalesce(v_guest,'') then
      raise exception 'permission-denied: Not a room participant';
    end if;
    if p_path[1] = 'presence' and (cardinality(p_path) <> 2 or p_path[2] <> v_uid::text) then
      raise exception 'permission-denied: Only your own presence can be updated';
    end if;
    if p_path[1] = 'drawOffer' and p_value is not null and p_value <> 'null'::jsonb
       and p_value is distinct from to_jsonb(v_uid::text) then
      raise exception 'permission-denied: Invalid draw offer';
    end if;
    -- No participant may replace the entire room or change its ownership.
    if coalesce(cardinality(p_path),0) = 0
       or p_path[1] in ('creatorId','guestId','matchId','quickMatch',
         'gameFen','gameOver','result','winner','status','clockTurn','clockStartedAt',
         'whiteTime','blackTime','whiteTimeLeft','blackTimeLeft','timeControl','increment',
         'bchessAuthorizedGuest','challengeFriendId','moveHistory','moves','fen','pgn','ratingDelta') then
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

-- Lock and update the same room document consumed by both realtime listeners.
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
       coalesce(room->'moveHistory' = '[]'::jsonb, false) is false or room->>'clockStartedAt' is not null
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

create or replace function public.bchess_room_action(p_code text, p_action text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_action is null or p_action not in ('join','cancel','start','timeout','draw','resign','leave','disconnected') then
    raise exception 'Invalid room action';
  end if;
  return public.bchess_room_apply(public.rtdb_require_user(),p_code,p_action,'{}'::jsonb);
end $$;

revoke all on function public.bchess_room_apply(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.bchess_room_apply(uuid,text,text,jsonb) to service_role;
revoke all on function public.bchess_room_action(text,text) from public, anon;
grant execute on function public.bchess_room_action(text,text) to authenticated;

create or replace function public.quick_match_resolve(p_search uuid,p_cancel boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=public.rtdb_require_user();s public.quick_match_searches;q public.quick_match_queue;
begin
 perform pg_advisory_xact_lock(hashtext('bchess:search-resolution'));
 select * into s from quick_match_searches where user_id=u for update;
 if not found or s.search_id<>p_search then return jsonb_build_object('status','cancelled'); end if;
 select * into q from quick_match_queue where user_id=u for update;
 -- A manual cancellation must not reopen an assigned but unstarted room.
 if p_cancel then
   if q.status='matched' and q.room_code is not null then
     update public.rtdb
        set data=data || jsonb_build_object('gameOver',true,'result','aborted','winner',null),
            version=version+1,updated_at=now()
      where doc='rooms/' || q.room_code and coalesce((data->>'gameOver')::boolean,false)=false
        and data->>'clockStartedAt' is null and data->'presence'->>(u::text) is distinct from 'true'
        and coalesce(data->'moveHistory','[]'::jsonb)='[]'::jsonb;
   end if;
   delete from quick_match_queue where user_id=u;
   update quick_match_searches set state='cancelled' where user_id=u;
   return jsonb_build_object('status','cancelled');
 end if;
 -- An automatic cutoff still honors a human assignment that won the lock.
 if q.status='matched' and public.qm_room_active(q.room_code,u,q.matched_at) then
   update quick_match_searches set state='matched' where user_id=u;
   return public.qm_payload(q,false);
 end if;
 delete from quick_match_queue where user_id=u;
 update quick_match_searches set state=case when p_cancel or state='cancelled' then 'cancelled' else 'bot' end where user_id=u returning * into s;
 return jsonb_build_object('status',s.state);
end $$;

commit;
