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
      if v_field in ('rating','elo','isAdmin','admin','role','uid','id','matchHistory','friends','friendRequests') then
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

-- Atomic friend requests over existing profile documents. No client-supplied identity/rating.
create or replace function public.bchess_friend_request(p_other uuid, p_action text, p_request text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := auth.uid(); mine jsonb; theirs jsonb; req jsonb; outbound jsonb; ops jsonb;
  my_doc text; their_doc text; req_key text;
begin
  if me is null then raise exception 'Login required'; end if;
  if p_other is null or p_other=me then raise exception 'Invalid friend'; end if;
  if p_action is null or p_action not in ('send','accept','decline') then raise exception 'Invalid action'; end if;
  my_doc := 'users/'||me; their_doc := 'users/'||p_other;
  -- Same lock order for both directions, including simultaneous accepts/sends.
  perform 1 from public.rtdb where doc in (my_doc,their_doc) order by doc for update;
  select data into mine from public.rtdb where doc=my_doc;
  select data into theirs from public.rtdb where doc=their_doc;
  if mine is null or theirs is null then raise exception 'Player profile unavailable'; end if;
  if p_action='send' then
    if mine#>array['friends',p_other::text] is not null then return jsonb_build_object('status','friends');end if;
    req := theirs#>array['friendRequests','incoming',me::text];
    if req is not null then return jsonb_build_object('status','pending');end if;
    req := jsonb_build_object('id',gen_random_uuid()::text,'fromId',me,'toId',p_other,
      'fromName',coalesce(mine->>'username','Player'),'fromRating',coalesce(mine->'rating','800'::jsonb),
      'fromPhoto',coalesce(mine->>'photoData',mine->>'photo',mine->>'photoURL',''), 'createdAt',public.rtdb_now_ms());
    outbound:=jsonb_build_object('id',req->>'id','toId',p_other,'toName',coalesce(theirs->>'username','Player'),'createdAt',req->'createdAt');
    ops:=jsonb_build_array(
      jsonb_build_object('d',their_doc,'p',jsonb_build_array('friendRequests','incoming',me::text),'v',req),
      jsonb_build_object('d',my_doc,'p',jsonb_build_array('friendRequests','outgoing',p_other::text),'v',outbound));
    perform public.rtdb_apply_internal(ops);
    return jsonb_build_object('status','pending');
  end if;
  req := mine#>array['friendRequests','incoming',p_other::text];
  if req is null then return jsonb_build_object('status','handled');end if;
  req_key:=coalesce(req->>'id',req->>'createdAt','legacy');
  if p_request is null or p_request<>req_key then raise exception 'Request changed. Refresh and try again.';end if;
  ops:=jsonb_build_array(
    jsonb_build_object('d',my_doc,'p',jsonb_build_array('friendRequests','incoming',p_other::text),'v',null),
    jsonb_build_object('d',their_doc,'p',jsonb_build_array('friendRequests','outgoing',me::text),'v',null));
  if p_action='accept' then
    ops:=ops||jsonb_build_array(
      jsonb_build_object('d',my_doc,'p',jsonb_build_array('friends',p_other::text),'v',jsonb_build_object('username',coalesce(theirs->>'username','Player'),'rating',coalesce(theirs->'rating','800'::jsonb))),
      jsonb_build_object('d',their_doc,'p',jsonb_build_array('friends',me::text),'v',jsonb_build_object('username',coalesce(mine->>'username','Player'),'rating',coalesce(mine->'rating','800'::jsonb))),
      jsonb_build_object('d',my_doc,'p',jsonb_build_array('friendRequests','outgoing',p_other::text),'v',null),
      jsonb_build_object('d',their_doc,'p',jsonb_build_array('friendRequests','incoming',me::text),'v',null));
  end if;
  perform public.rtdb_apply_internal(ops);
  return jsonb_build_object('status',case when p_action='accept' then 'friends' else 'declined' end);
end $$;
revoke all on function public.bchess_friend_request(uuid,text,text) from public, anon;
grant execute on function public.bchess_friend_request(uuid,text,text) to authenticated;
commit;
