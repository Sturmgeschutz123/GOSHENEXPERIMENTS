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

alter table public.inventory enable row level security;

grant select, insert, update, delete on public.inventory to authenticated;

drop policy if exists "Users can view their own inventory" on public.inventory;
create policy "Users can view their own inventory"
  on public.inventory for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add to their own inventory" on public.inventory;
create policy "Users can add to their own inventory"
  on public.inventory for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own inventory" on public.inventory;
create policy "Users can update their own inventory"
  on public.inventory for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own inventory" on public.inventory;
create policy "Users can delete their own inventory"
  on public.inventory for delete
  to authenticated
  using ((select auth.uid()) = user_id);
