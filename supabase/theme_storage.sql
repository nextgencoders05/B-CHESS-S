begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bchess-theme-drafts','bchess-theme-drafts',false,524288,array['image/png']),('bchess-themes','bchess-themes',true,524288,array['image/png'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists bchess_draft_insert on storage.objects;
create policy bchess_draft_insert on storage.objects for insert to authenticated with check(bucket_id='bchess-theme-drafts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists bchess_draft_read on storage.objects;
create policy bchess_draft_read on storage.objects for select to authenticated using(bucket_id='bchess-theme-drafts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists bchess_draft_delete on storage.objects;
create policy bchess_draft_delete on storage.objects for delete to authenticated using(bucket_id='bchess-theme-drafts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text);
-- No browser INSERT/UPDATE/DELETE policies on published assets: only the Edge service can publish.
-- Restrictive guards also protect these two buckets if an older project has a broad permissive policy.
drop policy if exists bchess_theme_insert_guard on storage.objects;
create policy bchess_theme_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check(
 bucket_id not in('bchess-theme-drafts','bchess-themes') or (bucket_id='bchess-theme-drafts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text));
drop policy if exists bchess_theme_update_guard on storage.objects;
create policy bchess_theme_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id not in('bchess-theme-drafts','bchess-themes')) with check(bucket_id not in('bchess-theme-drafts','bchess-themes'));
drop policy if exists bchess_theme_delete_guard on storage.objects;
create policy bchess_theme_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(
 bucket_id not in('bchess-theme-drafts','bchess-themes') or (bucket_id='bchess-theme-drafts' and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text));
drop policy if exists bchess_theme_read_guard on storage.objects;
create policy bchess_theme_read_guard on storage.objects as restrictive for select to anon,authenticated using(
 bucket_id<>'bchess-theme-drafts' or (public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text));
commit;
