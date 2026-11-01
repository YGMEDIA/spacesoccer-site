-- Contact form messages from www.space-soccer.com.
-- Only the edge function (service role) reads and writes this table; the public has no access.

create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 100),
  email      text not null check (char_length(email) between 3 and 200),
  message    text not null check (char_length(message) between 10 and 4000),
  lang       text not null default 'en' check (lang in ('en', 'de')),
  ip_hash    text not null,          -- salted hash for rate limiting, never the plain IP
  mailed     boolean not null default false
);

create index if not exists contact_messages_ip_recent on public.contact_messages (ip_hash, created_at desc);

alter table public.contact_messages enable row level security;
-- No policies on purpose: anon and authenticated roles can neither read nor write.

-- Retention: messages are deleted after 180 days (stated in the privacy policy).
create extension if not exists pg_cron;
select cron.schedule(
  'contact-messages-retention',
  '17 3 * * *',
  $$delete from public.contact_messages where created_at < now() - interval '180 days'$$
);
