begin;
alter table public.rtdb_sessions add column if not exists active_at timestamptz, add column if not exists playing boolean default false;
create or replace function public.club_beat(p_session uuid, active boolean, in_game boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result := public.rtdb_session_beat(p_session);
 update rtdb_sessions set active_at=case when active then now() else active_at end, playing=in_game where session=p_session and uid=auth.uid();
 return result;
end $$;
create or replace function public.club_counts() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.admin_require();
 return (select jsonb_build_object('online',count(distinct uid),'playing',count(distinct uid) filter(where playing)) from rtdb_sessions where least(last_seen,active_at)>now()-interval '45 seconds' and active_at is not null);
end $$;
create table if not exists public.club_gold(uid uuid primary key references auth.users(id) on delete cascade);
alter table public.club_gold enable row level security;
revoke all on public.club_gold from public, anon, authenticated;
grant select on public.club_gold to authenticated;
drop policy if exists gold_read on public.club_gold;
create policy gold_read on public.club_gold for select to authenticated using(true);
create or replace function public.club_lookup(wanted text) returns table(uid uuid,username text) language plpgsql security definer set search_path=public as $$
begin
 perform public.admin_require();
 return query select split_part(doc,'/',2)::uuid,data->>'username' from rtdb where doc like 'users/%' and lower(data->>'username')=lower(trim(wanted));
end $$;
create or replace function public.club_set_gold(target uuid, enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.admin_require();
 if enabled then insert into club_gold values(target) on conflict do nothing;
 else delete from club_gold where uid=target; end if;
end $$;
revoke all on function public.club_counts(),public.club_beat(uuid,boolean,boolean),public.club_lookup(text),public.club_set_gold(uuid,boolean) from public,anon;
grant execute on function public.club_counts(),public.club_beat(uuid,boolean,boolean),public.club_lookup(text),public.club_set_gold(uuid,boolean) to authenticated;
commit;
