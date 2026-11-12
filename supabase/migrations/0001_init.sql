-- Auto Batt Inventory — core schema
-- Tables only: no RLS policies here. RLS is enabled on every table with zero
-- policies defined, which denies all access to anon/authenticated roles by
-- default (the service role bypasses RLS and is used by server-side code).
-- Per-feature policies land in later tasks.

create extension if not exists pgcrypto;

-- categories: simple lookup table so categories can be renamed without
-- touching every item.
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- items: the catalog of trackable SKUs.
create table items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category_id uuid references categories (id),
  unit text not null default 'pcs',
  low_stock_threshold numeric,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- batches: one row per receipt of stock (purchase or opening-stock import).
-- qty_remaining is decremented as OUT movements draw from it (FIFO).
create table batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id),
  batch_date date not null,
  qty_received numeric not null,
  qty_remaining numeric not null,
  unit_cost numeric not null,
  source text not null check (source in ('purchase', 'opening_stock')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- stock_movements: the append-only day-by-day ledger (IN/OUT), including
-- voids (which point back at the movement they reverse via
-- reverses_movement_id rather than editing/deleting the original row).
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id),
  type text not null check (type in ('IN', 'OUT')),
  quantity numeric not null,
  batch_id uuid references batches (id),
  movement_date date not null default current_date,
  note text,
  voided_at timestamptz,
  voided_by uuid,
  reverses_movement_id uuid references stock_movements (id),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- movement_allocations: which batch(es) an OUT movement drew from, and at
-- what unit cost — makes a sale's cost auditable after the fact.
create table movement_allocations (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references stock_movements (id),
  batch_id uuid not null references batches (id),
  qty_allocated numeric not null,
  unit_cost_at_allocation numeric not null
);

-- app_settings: single-row table (id is pinned to 1) holding global config.
create table app_settings (
  id int primary key default 1,
  show_cost_to_assistant boolean not null default false,
  default_low_stock_threshold numeric not null default 5,
  notification_emails text[] not null default '{}',
  daily_email_send_time time not null default '20:00',
  check (id = 1)
);

insert into app_settings (id) values (1);

-- profiles: one row per Supabase Auth user, carrying app-level role.
create table profiles (
  id uuid primary key references auth.users (id),
  full_name text,
  role text not null check (role in ('owner', 'assistant'))
);

-- audit_log: append-only record of every mutating action.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- Enable RLS everywhere. No policies yet (see header note) — those land
-- per-feature in later tasks.
alter table categories enable row level security;
alter table items enable row level security;
alter table batches enable row level security;
alter table stock_movements enable row level security;
alter table movement_allocations enable row level security;
alter table app_settings enable row level security;
alter table profiles enable row level security;
alter table audit_log enable row level security;
