create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  category text not null check (char_length(category) between 1 and 40),
  quantity integer not null check (quantity >= 0),
  price numeric(10, 2) not null check (price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists inventory_user_id_created_at_idx
  on public.inventory (user_id, created_at desc);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.admin_users enable row level security;

revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists "Users can view their own admin role" on public.admin_users;
create policy "Users can view their own admin role"
  on public.admin_users for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.is_inventory_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_inventory_admin() from public;
grant execute on function public.is_inventory_admin() to authenticated;

alter table public.inventory enable row level security;

grant select, insert, update, delete on public.inventory to authenticated;

drop policy if exists "Users can view their own inventory" on public.inventory;
drop policy if exists "Admins can view all inventory" on public.inventory;
create policy "Users can view their own inventory"
  on public.inventory for select
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_inventory_admin()));

drop policy if exists "Users can add to their own inventory" on public.inventory;
drop policy if exists "Admins can add inventory" on public.inventory;
create policy "Users can add to their own inventory"
  on public.inventory for insert
  to authenticated
  with check ((select auth.uid()) = user_id or (select public.is_inventory_admin()));

drop policy if exists "Users can update their own inventory" on public.inventory;
drop policy if exists "Admins can update all inventory" on public.inventory;
create policy "Users can update their own inventory"
  on public.inventory for update
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_inventory_admin()))
  with check ((select auth.uid()) = user_id or (select public.is_inventory_admin()));

drop policy if exists "Users can delete their own inventory" on public.inventory;
drop policy if exists "Admins can delete all inventory" on public.inventory;
create policy "Users can delete their own inventory"
  on public.inventory for delete
  to authenticated
  using ((select auth.uid()) = user_id or (select public.is_inventory_admin()));
