begin;

-- Separate from room state so a heartbeat never triggers game listeners.
create table if not exists public.bchess_connection_samples (
  room_doc text not null references public.rtdb(doc) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null,
  rtt_ms integer check (rtt_ms between 0 and 12000),
  primary key (room_doc, player_id)
);
alter table public.bchess_connection_samples enable row level security;
revoke all on public.bchess_connection_samples from public, anon, authenticated;

create or replace function public.bchess_connection_check(
  room_code text default null, last_rtt_ms integer default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  room_key text := 'rooms/' || room_code;
  room_data jsonb;
  white_id text;
  black_id text;
  opponent_sample public.bchess_connection_samples%rowtype;
  measured_at timestamptz := clock_timestamp();
begin
  -- Anonymous visitors can time a header check without accessing any match data.
  if room_code is null then return '{}'::jsonb; end if;

  if caller is null or char_length(room_code) not between 1 and 64 then
    raise exception 'Active Quick Match membership required' using errcode = '42501';
  end if;

  select data into room_data from public.rtdb where doc = room_key;
  white_id := room_data->>'creatorId';
  black_id := room_data->>'guestId';

  if room_data is null or room_data->>'quickMatch' is distinct from 'true'
     or room_data->>'gameOver' = 'true'
     or white_id is null or black_id is null or white_id = black_id
     or caller::text not in (white_id, black_id) then
    raise exception 'Active Quick Match membership required' using errcode = '42501';
  end if;

  insert into public.bchess_connection_samples (room_doc, player_id, seen_at, rtt_ms)
  values (room_key, caller, measured_at, case when last_rtt_ms between 0 and 12000 then last_rtt_ms end)
  on conflict (room_doc, player_id) do update
    set seen_at = excluded.seen_at, rtt_ms = excluded.rtt_ms
    where bchess_connection_samples.seen_at < excluded.seen_at;

  select * into opponent_sample from public.bchess_connection_samples
    where room_doc = room_key
      and player_id::text = case when caller::text = white_id then black_id else white_id end;

  if not found then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'peerAgeMs', greatest(0, round(extract(epoch from (clock_timestamp() - opponent_sample.seen_at)) * 1000)),
    'peerRttMs', opponent_sample.rtt_ms
  );
end;
$$;

revoke all on function public.bchess_connection_check(text, integer) from public, anon, authenticated;
grant execute on function public.bchess_connection_check(text, integer) to anon, authenticated;

commit;
