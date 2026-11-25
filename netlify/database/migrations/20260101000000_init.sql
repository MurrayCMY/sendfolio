-- SendFolio initial schema.
-- RULE: never edit this file once it has been applied anywhere. Add a new, later-dated migration instead.

create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  version_label text not null,
  page_count int not null,
  pdf_blob_key text not null,
  status text not null default 'uploading', -- 'uploading' | 'ready'
  created_at timestamptz not null default now()
);
create index on document_versions (document_id, created_at desc);

create table links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  pinned_version_id uuid references document_versions(id),
  slug text unique not null,
  name text not null,
  enabled boolean not null default true,
  expires_at timestamptz,
  require_email boolean not null default true,
  require_otp boolean not null default true,
  block_personal_email boolean not null default true,
  allowed_domains text[],
  require_nda boolean not null default true,
  password_hash text,
  allow_download boolean not null default false,
  watermark boolean not null default true,
  -- which visitor fields are printed in the watermark, plus optional fixed text
  watermark_fields text[] not null default '{email,date}',
  watermark_text text,
  notify_on_open boolean not null default true,
  created_at timestamptz not null default now()
);
-- Custom link addresses are matched case-insensitively.
create unique index links_slug_lower_unique on links (lower(slug));

create table visitors (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  first_seen_at timestamptz not null default now(),
  note text,   -- admin's private follow-up note
  status text  -- null = not contacted | 'contacted' | 'meeting' | 'declined'
);

create table nda_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  body_zh text not null,
  body_en text not null,
  sha256 text not null,
  pdf_blob_key text not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
-- At most one active NDA version
create unique index nda_versions_one_active on nda_versions (active) where active;

-- NDA acceptances are signed records: they survive deleting the link they were signed through,
-- so the document title and link name are snapshotted at signing time.
create table nda_acceptances (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references visitors(id),
  nda_version_id uuid not null references nda_versions(id),
  link_id uuid references links(id) on delete set null,
  name_as_entered text not null,
  email text not null,
  ip text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  signed_pdf_blob_key text,
  email_sent_at timestamptz,
  doc_title text,
  link_name text,
  otp_verified boolean,
  lang text -- language the visitor used ('en' | 'zh'); the confirmation mail follows it
);
create index on nda_acceptances (visitor_id, nda_version_id);
create index on nda_acceptances (email_sent_at) where email_sent_at is null;

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null, -- 'visitor' | 'admin'
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index on otp_codes (purpose, email, created_at desc);
create index on otp_codes (purpose, ip, created_at desc);

create table visits (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references links(id),
  version_id uuid not null references document_versions(id),
  visitor_id uuid references visitors(id),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  total_active_ms bigint not null default 0,
  max_page int not null default 1,
  ip text,
  user_agent text,
  device text,
  in_wechat boolean,
  geo_city text,
  geo_country text,
  open_notified_at timestamptz,
  summary_sent_at timestamptz,
  summary_emailed boolean not null default false
);
create index on visits (link_id, started_at desc);
create index on visits (summary_sent_at) where summary_sent_at is null;

create table page_views (
  visit_id uuid not null references visits(id),
  page int not null,
  active_ms bigint not null default 0,
  first_viewed_at timestamptz not null default now(),
  primary key (visit_id, page)
);

-- Generic rate-limit event log (OTP, password attempts, form submissions)
create table rate_events (
  id bigserial primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index on rate_events (kind, key, created_at desc);

-- Admin-editable settings
create table settings (
  key text primary key,
  value jsonb not null
);

insert into settings (key, value) values (
  'personal_email_domains',
  '["gmail.com","googlemail.com","outlook.com","hotmail.com","live.com","msn.com","yahoo.com","yahoo.com.cn","ymail.com","icloud.com","me.com","mac.com","aol.com","proton.me","protonmail.com","gmx.com","mail.com","yandex.com","zoho.com","qq.com","foxmail.com","vip.qq.com","163.com","126.com","yeah.net","vip.163.com","sina.com","sina.cn","vip.sina.com","sohu.com","aliyun.com","139.com","189.cn","wo.cn","tom.com","21cn.com"]'::jsonb
);
