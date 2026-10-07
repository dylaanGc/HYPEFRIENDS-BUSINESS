-- HYPEFRIENDS BUSINESS — SQL seguro para ejecutar en Supabase
-- Puedes ejecutarlo después de crear las tablas. Si ya existen políticas,
-- primero las elimina y luego las vuelve a crear sin duplicados.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'General',
  sku text,
  size text,
  color text,
  stock numeric not null default 0,
  cost numeric not null default 0,
  price numeric not null default 0,
  currency text not null default 'CRC' check (currency in ('CRC','USD')),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  total numeric not null default 0,
  paid numeric not null default 0,
  currency text not null default 'CRC' check (currency in ('CRC','USD')),
  status text not null default 'pending' check (status in ('pending','paid')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id),
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  unit_cost numeric not null default 0
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null default 'CRC' check (currency in ('CRC','USD')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  amount numeric not null default 0,
  currency text not null default 'CRC' check (currency in ('CRC','USD')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "auth profiles" on public.profiles;
drop policy if exists "auth products" on public.products;
drop policy if exists "auth customers" on public.customers;
drop policy if exists "auth sales" on public.sales;
drop policy if exists "auth sale items" on public.sale_items;
drop policy if exists "auth payments" on public.payments;
drop policy if exists "auth expenses" on public.expenses;

create policy "auth profiles" on public.profiles for all to authenticated using (true) with check (true);
create policy "auth products" on public.products for all to authenticated using (true) with check (true);
create policy "auth customers" on public.customers for all to authenticated using (true) with check (true);
create policy "auth sales" on public.sales for all to authenticated using (true) with check (true);
create policy "auth sale items" on public.sale_items for all to authenticated using (true) with check (true);
create policy "auth payments" on public.payments for all to authenticated using (true) with check (true);
create policy "auth expenses" on public.expenses for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
    alter publication supabase_realtime add table public.products;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='customers') then
    alter publication supabase_realtime add table public.customers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sale_items') then
    alter publication supabase_realtime add table public.sale_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='payments') then
    alter publication supabase_realtime add table public.payments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='expenses') then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;
