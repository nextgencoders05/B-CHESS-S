-- READ ONLY: run before next_update_migration.sql.
-- If any rows appear, resolve those usernames before applying the migration.
select lower(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g')) as conflicting_username,
       array_agg(doc order by doc) as accounts
from public.rtdb where doc like 'users/%' and nullif(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g'),'') is not null
group by lower(regexp_replace(data->>'username','^[[:space:]]+|[[:space:]]+$','','g')) having count(*)>1;
