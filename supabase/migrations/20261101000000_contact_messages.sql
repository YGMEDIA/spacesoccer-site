-- Contact form for www.space-soccer.com (Supabase project "SpaceSocer", ref ljwassddjbpuzpgrizci, eu-west-3).
-- Applied on 2026-11-01 in the SQL editor. The website calls public.submit_contact via the REST API
-- with the publishable key; the table itself is closed to the public by RLS (no policies).
--
-- E-mail forwarding: store a Resend API key (sending access, domain mail.space-soccer.com) in
-- Supabase Vault under the name 'resend_api_key'. Without it, messages are stored but not mailed.

create extension if not exists pg_net;
create extension if not exists pg_cron;

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

-- Retention: messages are deleted after 180 days (stated in the privacy policy).
select cron.schedule('contact-messages-retention', '17 3 * * *',
  $$delete from public.contact_messages where created_at < now() - interval '180 days'$$);

create or replace function public.submit_contact(
  p_name text, p_email text, p_message text, p_lang text default 'en', p_website text default ''
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ip text; v_hash text; v_key text; v_count int;
  v_name  text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
  v_msg   text := btrim(coalesce(p_message, ''));
  v_lang  text := case when p_lang = 'de' then 'de' else 'en' end;
begin
  if coalesce(p_website, '') <> '' then return json_build_object('ok', true); end if;  -- honeypot
  if char_length(v_name) < 1 or char_length(v_name) > 100 then return json_build_object('ok', false, 'error', 'name'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 200 then return json_build_object('ok', false, 'error', 'email'); end if;
  if char_length(v_msg) < 10 or char_length(v_msg) > 4000 then return json_build_object('ok', false, 'error', 'message'); end if;

  v_ip := coalesce(nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
  v_hash := encode(extensions.digest('ss-contact-2026' || v_ip, 'sha256'), 'hex');
  select count(*) into v_count from public.contact_messages where ip_hash = v_hash and created_at > now() - interval '10 minutes';
  if v_count >= 3 then return json_build_object('ok', false, 'error', 'rate'); end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  insert into public.contact_messages (name, email, message, lang, ip_hash, mailed)
    values (v_name, v_email, v_msg, v_lang, v_hash, v_key is not null);

  if v_key is not null then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'Space Soccer <contact@mail.space-soccer.com>',
        'to', jsonb_build_array('info@yg-media.de'),
        'reply_to', v_email,
        'subject', 'Space Soccer Kontakt: ' || v_name,
        'text', 'Name: ' || v_name || chr(10) || 'E-Mail: ' || v_email || chr(10) || 'Sprache: ' || v_lang || chr(10) || chr(10) || v_msg));
  end if;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.submit_contact(text, text, text, text, text) from public;
grant execute on function public.submit_contact(text, text, text, text, text) to anon;
