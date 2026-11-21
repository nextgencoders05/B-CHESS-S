begin;
alter table public.syndicates
 add column if not exists captain uuid references auth.users(id) on delete set null,
 add column if not exists logo text,
 add column if not exists country text,
 add column if not exists region text,
 add column if not exists district text;

create or replace function public.syndicate_create_profile(title text, picture text, nation text, area text, locality text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); cid uuid;
begin
 if actor is null then raise exception 'Sign in first'; end if;
 if picture is not null and (length(picture)>180000 or picture !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$') then raise exception 'Choose a valid logo'; end if;
 if nation is not null and nation !~ '^[A-Z]{2}$' then raise exception 'Invalid country'; end if;
 if length(area)>160 or length(locality)>160 then raise exception 'Location is too long'; end if;
 insert into public.syndicates(name,captain,logo,country,region,district)
 values(btrim(title),actor,picture,nation,nullif(btrim(area),''),nullif(btrim(locality),'')) returning id into cid;
 insert into public.syndicate_members(club,player) values(cid,actor);
 return cid;
end $$;
create or replace function public.syndicate_create(title text) returns uuid language sql security definer set search_path='' as $$
 select public.syndicate_create_profile(title,null,null,null,null);
$$;
revoke all on function public.syndicate_create_profile(text,text,text,text,text) from public,anon;
grant execute on function public.syndicate_create_profile(text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
