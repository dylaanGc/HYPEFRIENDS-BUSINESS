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

alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists cost_currency text;
update public.products set cost_currency=currency where cost_currency is null;
alter table public.products alter column cost_currency set default 'CRC';
alter table public.products alter column cost_currency set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.products'::regclass and conname='products_cost_currency_check'
  ) then
    alter table public.products
      add constraint products_cost_currency_check check (cost_currency in ('CRC','USD'));
  end if;
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public=excluded.public,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "product images public read" on storage.objects;
drop policy if exists "product images authenticated insert" on storage.objects;
drop policy if exists "product images authenticated update" on storage.objects;

create policy "product images public read" on storage.objects
for select to anon, authenticated
using (bucket_id='product-images');

create policy "product images authenticated insert" on storage.objects
for insert to authenticated
with check (bucket_id='product-images');

create policy "product images authenticated update" on storage.objects
for update to authenticated
using (bucket_id='product-images')
with check (bucket_id='product-images');

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
