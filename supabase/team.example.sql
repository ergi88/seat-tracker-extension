-- The team: who may use Seat Tracker. Copy this file to team.sql (which
-- git ignores) and put the real emails in, lower case.
-- Run in Supabase's SQL editor after schema.sql, and again whenever you add
-- someone: they must have signed up (Authentication -> Users) first.
insert into public.members (user_id, email)
select id, email from auth.users
where lower(email) in ('owner@example.com', 'mate@example.com')
on conflict (user_id) do nothing;

-- shows who is on the team: every email above should be listed
select m.email, m.added_at from public.members m order by m.added_at;
