-- Additive migration: Data Rooms (multiple documents shared under one link and one NDA).
create table if not exists data_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists data_room_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references data_rooms(id) on delete cascade,
  document_id uuid not null references documents(id),
  section text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id, document_id)
);
create index if not exists data_room_items_room_idx on data_room_items (room_id, sort_order, created_at);

alter table links add column if not exists room_id uuid references data_rooms(id);
create index if not exists links_room_id_idx on links (room_id) where room_id is not null;
