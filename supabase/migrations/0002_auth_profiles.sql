-- Auto Batt Inventory — auth & profiles
-- A trigger that keeps `profiles` in sync with `auth.users`, plus the RLS
-- policies that let a signed-in user read profile rows.

-- handle_new_user: fires after every insert into auth.users and creates the
-- matching profiles row. Defaults role to 'assistant' unless the caller set
-- raw_user_meta_data.role = 'owner' (the Add User screen in Task 15 sets
-- this explicitly when an owner creates another owner or an assistant).
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    case
      when new.raw_user_meta_data ->> 'role' = 'owner' then 'owner'
      else 'assistant'
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

-- RLS: any authenticated user can read their own profile row.
create policy "profiles_select_own"
  on profiles for select
  to authenticated
  using (id = auth.uid());

-- is_owner: looks up whether a given user id has role = 'owner'. Used by
-- profiles_select_all_for_owner below. Must be security definer so the
-- lookup it runs bypasses RLS on `profiles` — otherwise a policy's USING
-- clause querying `profiles` from inside a policy ON `profiles` triggers
-- Postgres's infinite-recursion detection (error 42P17) on every select.
create function is_owner(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = user_id and role = 'owner'
  );
$$;

-- RLS: an owner can read every profile row (needed for role-gated nav and
-- the Add User / user list screen in Task 15).
create policy "profiles_select_all_for_owner"
  on profiles for select
  to authenticated
  using (is_owner(auth.uid()));
