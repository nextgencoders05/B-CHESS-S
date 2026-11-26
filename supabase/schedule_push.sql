-- Run once after creating both Vault secrets listed in UPDATE_1.0.2.md.
select cron.schedule('bchess-daily-reminders','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='bchess_push_url'),
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='bchess_push_cron_secret')),
    body := '{"action":"daily"}'::jsonb,timeout_milliseconds := 30000
  );
$job$);
