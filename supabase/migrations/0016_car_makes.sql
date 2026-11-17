-- Auto Batt Inventory — car_makes table and RLS
-- Car makes are a shared lookup list (twin of categories), not owner-restricted data:
-- any authenticated user (owner or assistant) can read the list and add a new make.
-- Renaming/deleting isn't supported yet (YAGNI — not in this task's scope),
-- so no update/delete policy exists.

create table car_makes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table car_makes enable row level security;

-- RLS: any authenticated user can read car_makes.
create policy "car_makes_select_authenticated"
  on car_makes for select
  to authenticated
  using (true);

-- RLS: any authenticated user can insert a car_make.
create policy "car_makes_insert_authenticated"
  on car_makes for insert
  to authenticated
  with check (true);
