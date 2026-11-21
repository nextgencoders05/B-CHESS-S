begin;
create table if not exists public.vc_voice_rules (
 id text primary key, side text not null check(side in ('w','b')), speaker text not null,
 event text not null check(event in ('first','move','capture','check','mate','taken','forkmajor','forkcheck','kingmate','kingcheck')),
 targets text not null default '', clips jsonb not null check(jsonb_typeof(clips)='array'),
 playback text not null check(playback in ('random','ordered')), cooldown numeric not null check(cooldown>=0),
 revision integer not null default 1, unique(side,speaker,event,targets)
);
alter table public.vc_voice_rules enable row level security;
revoke all on public.vc_voice_rules from public,anon,authenticated;
grant select on public.vc_voice_rules to authenticated,anon;
grant insert,update on public.vc_voice_rules to authenticated;
drop policy if exists voice_read on public.vc_voice_rules;
create policy voice_read on public.vc_voice_rules for select using(true);
drop policy if exists voice_admin on public.vc_voice_rules;
create policy voice_admin on public.vc_voice_rules for all to authenticated using(public.is_admin()) with check(public.is_admin());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vc-dialogue','vc-dialogue',true,8388608,array['audio/mpeg']) on conflict(id) do nothing;
drop policy if exists vc_audio_insert on storage.objects;
create policy vc_audio_insert on storage.objects for insert to authenticated with check(bucket_id='vc-dialogue' and public.is_admin());
drop policy if exists vc_audio_guard on storage.objects;
create policy vc_audio_guard on storage.objects as restrictive for all to authenticated,anon using(bucket_id<>'vc-dialogue' or public.is_admin()) with check(bucket_id<>'vc-dialogue' or public.is_admin());

create table if not exists public.syndicates(id uuid primary key default gen_random_uuid(),name text not null check(name=btrim(name) and char_length(name) between 1 and 64));
create unique index if not exists syndicates_name_unique on public.syndicates(lower(name));
create table if not exists public.syndicate_members(club uuid references public.syndicates on delete cascade, player uuid references auth.users on delete cascade,primary key(club,player));
alter table public.syndicates enable row level security;
alter table public.syndicate_members enable row level security;
revoke all on public.syndicates,public.syndicate_members from public,authenticated,anon;
grant select on public.syndicates,public.syndicate_members to authenticated;
drop policy if exists club_read on public.syndicates;
create policy club_read on public.syndicates for select to authenticated using(true);
drop policy if exists member_read on public.syndicate_members;
create policy member_read on public.syndicate_members for select to authenticated using(true);
create or replace function public.syndicate_create(title text) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 insert into public.syndicates(name) values(btrim(title)) returning id into cid;
 insert into public.syndicate_members values(cid,auth.uid());
 return cid;
end $$;
create or replace function public.syndicate_join(cid uuid) returns void language sql security definer set search_path='' as $$
 insert into public.syndicate_members values(cid,auth.uid()) on conflict do nothing;
$$;
create or replace function public.syndicate_members_public(cid uuid) returns table(player uuid,username text,matches bigint) language sql stable security definer set search_path='' as $$
 select m.player,coalesce(nullif(r.data->>'username',''),'Player'),(select count(*) from jsonb_object_keys(case when jsonb_typeof(r.data->'matchHistory')='object' then r.data->'matchHistory' else '{}'::jsonb end))
 from public.syndicate_members m left join public.rtdb r on r.doc='users/'||m.player::text where m.club=cid and auth.uid() is not null order by 2,1
$$;
revoke all on function public.syndicate_create(text),public.syndicate_join(uuid),public.syndicate_members_public(uuid) from public,anon;
grant execute on function public.syndicate_create(text),public.syndicate_join(uuid),public.syndicate_members_public(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
