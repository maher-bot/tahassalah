create extension if not exists pg_cron;
select cron.schedule('end-free-trials', '0 3 * * *', 'select public.end_expired_trials()');
