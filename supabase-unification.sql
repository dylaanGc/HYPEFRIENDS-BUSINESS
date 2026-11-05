-- HYPEFRIENDS UNIFICACIÓN CENTRAL
-- Ejecutar después de supabase.sql y supabase-web-orders.sql.
-- Aditivo: conserva tablas y registros existentes.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists role text not null default 'admin'
  check (role in ('admin','inventory_manager','seller'));
alter table public.profiles add column if not exists active boolean not null default true;

-- Ambos socios son los únicos usuarios autorizados: conservar acceso administrador completo.
update public.profiles set role='admin', active=true;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true
);
insert into public.product_categories(name,slug,sort_order) values
('Camisetas','tee',10),('Hoodies','hoodie',20),('Shorts','short',30),('Gorras','cap',40),('Accesorios','accessory',50)
on conflict (slug) do nothing;

alter table public.products add column if not exists description text;
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists publish_online boolean not null default true;
alter table public.products add column if not exists store_product_id text;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists category_slug text;
alter table public.products add column if not exists product_color text;

create unique index if not exists products_store_product_id_uidx
  on public.products(store_product_id) where store_product_id is not null;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null default 'ÚNICA',
  color text,
  sku text,
  stock integer not null default 0 check (stock>=0),
  reserved integer not null default 0 check (reserved>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,size,color)
);
create index if not exists product_variants_product_id_idx on public.product_variants(product_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  movement_type text not null check (movement_type in ('entry','exit','sale','return','reservation','release','adjustment','web_sale')),
  quantity integer not null check (quantity<>0),
  reason text,
  reference_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Variante inicial para inventario histórico y productos que todavía usan product.size.
insert into public.product_variants(product_id,size,color,stock)
select p.id,coalesce(nullif(btrim(p.size),''),'ÚNICA'),nullif(btrim(p.color),''),greatest(0,p.stock::integer)
from public.products p
where not exists (select 1 from public.product_variants v where v.product_id=p.id)
on conflict (product_id,size,color) do update set stock=excluded.stock;

create or replace function public.sync_product_stock(p_product_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_stock integer; begin
  select coalesce(sum(stock),0)::integer into v_stock from public.product_variants where product_id=p_product_id;
  update public.products set stock=v_stock,updated_at=now() where id=p_product_id;
end; $$;

create or replace function public.product_variant_stock_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid; begin
  p := coalesce(new.product_id,old.product_id);
  perform public.sync_product_stock(p); return coalesce(new,old);
end; $$;
drop trigger if exists trg_product_variant_stock on public.product_variants;
create trigger trg_product_variant_stock after insert or update or delete on public.product_variants
for each row execute function public.product_variant_stock_trigger();

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid() and active=true
$$;

-- Entradas/salidas y ajuste concurrente seguro por talla/variante.
create or replace function public.adjust_product_variant_stock(
  p_product_id uuid,p_variant_id uuid,p_quantity integer,p_movement_type text,p_reason text default null
) returns integer language plpgsql security definer set search_path='' as $$
declare v_variant public.product_variants%rowtype; v_delta integer; begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.current_user_role() not in ('admin','inventory_manager') then raise exception 'Inventory access denied'; end if;
  if p_quantity=0 or p_movement_type not in ('entry','exit','adjustment','sale','return','web_sale') then raise exception 'Invalid inventory movement'; end if;
  select * into v_variant from public.product_variants where id=p_variant_id and product_id=p_product_id for update;
  if not found then raise exception 'Variant not found'; end if;
  if p_movement_type='exit' and p_quantity>0 then v_delta=-p_quantity; else v_delta=p_quantity; end if;
  if v_variant.stock+v_delta<0 then raise exception 'Insufficient stock'; end if;
  update public.product_variants set stock=stock+v_delta,updated_at=now() where id=p_variant_id;
  insert into public.inventory_movements(product_id,variant_id,movement_type,quantity,reason,created_by)
  values(p_product_id,p_variant_id,case when v_delta<0 and p_movement_type='adjustment' then 'exit' else p_movement_type end,abs(v_delta),p_reason,auth.uid());
  return v_variant.stock+v_delta;
end; $$;

-- Venta local atómica: bloquea variantes, evita negativos y registra el movimiento una sola vez.
create or replace function public.create_local_sale(
  p_customer_id uuid,p_items jsonb,p_paid numeric,p_currency text,p_reference text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_sale_id uuid:=gen_random_uuid(); v_item jsonb; v_variant public.product_variants%rowtype; v_product public.products%rowtype;
  v_total numeric:=0; v_real_paid numeric:=0; v_quantity integer; v_unit_price numeric; v_unit_cost numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.current_user_role() not in ('admin','seller') then raise exception 'Sales access denied'; end if;
  if p_currency not in ('CRC','USD') or p_items is null or jsonb_typeof(p_items)<> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Invalid sale'; end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid;
    select * into v_variant from public.product_variants where id=(v_item->>'variant_id')::uuid and product_id=v_product.id for update;
    if not found then raise exception 'Invalid product variant'; end if;
    v_quantity:=(v_item->>'quantity')::integer; if v_quantity<=0 or v_variant.stock-v_variant.reserved<v_quantity then raise exception 'Insufficient stock'; end if;
    v_unit_price:=coalesce((v_item->>'unit_price')::numeric,v_product.price); v_unit_cost:=coalesce((v_item->>'unit_cost')::numeric,v_product.cost);
    v_total:=v_total+v_quantity*v_unit_price;
  end loop;
  v_real_paid:=greatest(0,least(coalesce(p_paid,0),v_total));
  insert into public.sales(id,customer_id,total,paid,currency,status,created_by)
  values(v_sale_id,p_customer_id,v_total,v_real_paid,p_currency,case when v_real_paid>=v_total then 'paid' else 'pending' end,auth.uid());
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid;
    select * into v_variant from public.product_variants where id=(v_item->>'variant_id')::uuid for update;
    v_quantity:=(v_item->>'quantity')::integer;
    update public.product_variants set stock=stock-v_quantity,reserved=greatest(0,reserved-v_quantity),updated_at=now() where id=v_variant.id;
    insert into public.sale_items(sale_id,product_id,variant_id,quantity,unit_price,unit_cost)
    values(v_sale_id,v_product.id,v_variant.id,v_quantity,coalesce((v_item->>'unit_price')::numeric,v_product.price),coalesce((v_item->>'unit_cost')::numeric,v_product.cost));
    insert into public.inventory_movements(product_id,variant_id,movement_type,quantity,reason,reference_id,created_by)
    values(v_product.id,v_variant.id,'sale',v_quantity,'Venta local',v_sale_id::text,auth.uid());
  end loop;
  if v_real_paid>0 then insert into public.payments(sale_id,amount,currency,created_by) values(v_sale_id,v_real_paid,p_currency,auth.uid()); end if;
  return v_sale_id;
end; $$;

-- Sincroniza catálogo web con producto publicado.
alter table public.web_store_catalog add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.web_store_catalog add column if not exists image_url text;
alter table public.web_store_catalog add column if not exists description text;
create unique index if not exists web_store_catalog_product_id_uidx on public.web_store_catalog(product_id) where product_id is not null;

create or replace function public.sync_web_catalog_from_product(p_product uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.products%rowtype; v_id text; v_sizes text[]; begin
  select * into v from public.products where id=p_product;
  if not found or v.store_product_id is null or v.store_product_id='' then return; end if;
  v_id:=v.store_product_id;
  select coalesce(array_agg(distinct size order by size) filter(where size is not null),array['ÚNICA'::text]) into v_sizes from public.product_variants where product_id=v.id;
  if not exists(select 1 from public.web_store_catalog where store_product_id=v_id) then
    insert into public.web_store_catalog(store_product_id,product_name,unit_price,currency,category,stock_snapshot,available_sizes,active,image_url,description,product_id)
    values(v_id,v.name,v.price,coalesce(v.currency,'CRC'),coalesce(v.category_slug,v.category,'General'),coalesce(v.stock,0),v_sizes,v.active and v.publish_online,v.image_url,v.description,v.id);
  else
    update public.web_store_catalog set product_name=v.name,unit_price=v.price,currency=coalesce(v.currency,'CRC'),category=coalesce(v.category_slug,v.category,'General'),stock_snapshot=coalesce(v.stock,0),available_sizes=v_sizes,active=v.active and v.publish_online,image_url=v.image_url,description=v.description,product_id=v.id,updated_at=now() where store_product_id=v_id;
  end if;
end; $$;

create or replace function public.sync_product_catalog_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid; begin p:=coalesce(new.id,old.id); perform public.sync_web_catalog_from_product(p); return coalesce(new,old); end; $$;
drop trigger if exists trg_sync_product_catalog on public.products;
create trigger trg_sync_product_catalog after insert or update or delete on public.products
for each row execute function public.sync_product_catalog_trigger();

create or replace function public.sync_catalog_variant_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid; begin p:=coalesce(new.product_id,old.product_id); perform public.sync_web_catalog_from_product(p); return coalesce(new,old); end; $$;
drop trigger if exists trg_sync_catalog_variant on public.product_variants;
create trigger trg_sync_catalog_variant after insert or update or delete on public.product_variants
for each row execute function public.sync_catalog_variant_trigger();

-- Reconciliar ventas web con inventario central al insertar/cancelar pedidos.
create or replace function public.web_order_item_stock_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_catalog public.web_store_catalog%rowtype; v_variant public.product_variants%rowtype; begin
  select * into v_catalog from public.web_store_catalog where store_product_id=new.store_product_id for update;
  if found and v_catalog.product_id is not null then
    select * into v_variant from public.product_variants where product_id=v_catalog.product_id and size=new.size limit 1 for update;
    if found then
      if v_variant.stock-v_variant.reserved<new.quantity then raise exception 'Insufficient centralized stock'; end if;
      update public.product_variants set reserved=reserved+new.quantity,updated_at=now() where id=v_variant.id;
      insert into public.inventory_movements(product_id,variant_id,movement_type,quantity,reason,reference_id)
      values(v_catalog.product_id,v_variant.id,'reservation',new.quantity,'Reserva pedido web','WEB_ORDER:'||new.order_id::text);
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_web_order_item_stock on public.web_order_items;
create trigger trg_web_order_item_stock after insert on public.web_order_items
for each row execute function public.web_order_item_stock_trigger();

create or replace function public.web_order_cancel_restore_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_item public.web_order_items%rowtype; v_catalog public.web_store_catalog%rowtype; v_variant public.product_variants%rowtype; begin
  if old.order_status='cancelled' or old.order_status='delivered' or new.order_status<> 'cancelled' then return new; end if;
  for v_item in select * from public.web_order_items where order_id=new.id loop
    select * into v_catalog from public.web_store_catalog where store_product_id=v_item.store_product_id;
    if found and v_catalog.product_id is not null then
      select * into v_variant from public.product_variants where product_id=v_catalog.product_id and size=v_item.size limit 1;
      if found then update public.product_variants set reserved=greatest(0,reserved-v_item.quantity),updated_at=now() where id=v_variant.id;
        insert into public.inventory_movements(product_id,variant_id,movement_type,quantity,reason,reference_id)
        values(v_catalog.product_id,v_variant.id,'return',v_item.quantity,'Cancelación pedido web','WEB_ORDER:'||new.id::text);
      end if;
    end if;
  end loop;
  return new;
end; $$;
drop trigger if exists trg_web_order_cancel_restore on public.web_orders;
create trigger trg_web_order_cancel_restore after update on public.web_orders
for each row execute function public.web_order_cancel_restore_trigger();

-- Vista web con existencias centrales.
drop view if exists public.web_store_catalog_inventory;
create or replace view public.web_store_catalog_inventory
with (security_invoker=true) as
select c.store_product_id,c.product_name,c.unit_price,c.currency,c.category,c.image_url,c.description,c.available_sizes,c.active,c.drop_available_at,
greatest(c.stock_snapshot,0)::integer as available_stock
from public.web_store_catalog c;

-- Actualiza y agrega Realtime.
alter table public.product_variants replica identity full;
alter table public.inventory_movements replica identity full;
alter table public.product_categories replica identity full;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='product_variants') then alter publication supabase_realtime add table public.product_variants; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_movements') then alter publication supabase_realtime add table public.inventory_movements; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='product_categories') then alter publication supabase_realtime add table public.product_categories; end if;
end $$;

-- Políticas RLS: los roles y no sólo el menú controlan acceso.
alter table public.product_categories enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "auth profiles" on public.profiles;
create policy "profiles read own or admin" on public.profiles for select to authenticated using(id=auth.uid() or current_user_role()='admin');
create policy "profiles upsert own" on public.profiles for insert to authenticated with check(id=auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role=(select role from public.profiles where id=auth.uid()));

-- Productos: catálogo público; cambios sólo admin/encargado.
drop policy if exists "auth products" on public.products;
create policy "published or authenticated products read" on public.products for select to anon,authenticated using(active=true or auth.uid() is not null);
create policy "inventory users manage products" on public.products for all to authenticated using(current_user_role() in ('admin','inventory_manager')) with check(current_user_role() in ('admin','inventory_manager'));

create policy "categories read public" on public.product_categories for select to anon,authenticated using(active=true or auth.uid() is not null);
create policy "categories admin inventory manage" on public.product_categories for all to authenticated using(current_user_role() in ('admin','inventory_manager')) with check(current_user_role() in ('admin','inventory_manager'));

create policy "variants read public" on public.product_variants for select to anon,authenticated using(true);
create policy "variants inventory manage" on public.product_variants for all to authenticated using(current_user_role() in ('admin','inventory_manager')) with check(current_user_role() in ('admin','inventory_manager'));

create policy "movements read admin inventory" on public.inventory_movements for select to authenticated using(current_user_role() in ('admin','inventory_manager'));
create policy "movements system insert" on public.inventory_movements for insert to authenticated with check(current_user_role() in ('admin','inventory_manager','seller'));

-- Finanzas y ventas: vendedor puede vender, sólo admin ve finanzas/clientes privados.
drop policy if exists "auth sales" on public.sales;
create policy "sales read admin seller" on public.sales for select to authenticated using(current_user_role() in ('admin','seller'));
create policy "sales write admin seller" on public.sales for all to authenticated using(current_user_role() in ('admin','seller')) with check(current_user_role() in ('admin','seller'));
drop policy if exists "auth sale items" on public.sale_items;
create policy "sale items read admin seller" on public.sale_items for select to authenticated using(current_user_role() in ('admin','seller'));
create policy "sale items write admin seller" on public.sale_items for all to authenticated using(current_user_role() in ('admin','seller')) with check(current_user_role() in ('admin','seller'));
drop policy if exists "auth payments" on public.payments;
create policy "payments read admin seller" on public.payments for select to authenticated using(current_user_role() in ('admin','seller'));
create policy "payments write admin seller" on public.payments for all to authenticated using(current_user_role() in ('admin','seller')) with check(current_user_role() in ('admin','seller'));
drop policy if exists "auth customers" on public.customers;
create policy "customers admin seller read" on public.customers for select to authenticated using(current_user_role() in ('admin','seller'));
create policy "customers admin seller manage" on public.customers for all to authenticated using(current_user_role() in ('admin','seller')) with check(current_user_role() in ('admin','seller'));
drop policy if exists "auth expenses" on public.expenses;
create policy "expenses admin only" on public.expenses for all to authenticated using(current_user_role()='admin') with check(current_user_role()='admin');

revoke all on function public.adjust_product_variant_stock(uuid,uuid,integer,text,text) from public, anon;
grant execute on function public.adjust_product_variant_stock(uuid,uuid,integer,text,text) to authenticated;
revoke all on function public.create_local_sale(uuid,jsonb,numeric,text,text) from public, anon;
grant execute on function public.create_local_sale(uuid,jsonb,numeric,text,text) to authenticated;

-- Identificador opcional de variante en el detalle de ventas y devolución automática al cancelar/eliminar.
alter table public.sale_items add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

create or replace function public.sale_item_restore_variant()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.variant_id is not null then
    update public.product_variants set stock=stock+old.quantity,reserved=greatest(0,reserved-old.quantity),updated_at=now() where id=old.variant_id;
    insert into public.inventory_movements(product_id,variant_id,movement_type,quantity,reason,reference_id)
    values(old.product_id,old.variant_id,'return',old.quantity,'Devolución por eliminación de venta',old.sale_id::text);
  end if;
  return old;
end; $$;
drop trigger if exists trg_sale_item_restore_variant on public.sale_items;
create trigger trg_sale_item_restore_variant after delete on public.sale_items
for each row execute function public.sale_item_restore_variant();

-- Al entregar, la unidad sigue vendida y deja de contar como reserva web.
create or replace function public.web_order_delivery_release_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_item public.web_order_items%rowtype; v_catalog public.web_store_catalog%rowtype; v_variant public.product_variants%rowtype; begin
  if new.order_status='delivered' and old.order_status is distinct from 'delivered' then
    for v_item in select * from public.web_order_items where order_id=new.id loop
      select * into v_catalog from public.web_store_catalog where store_product_id=v_item.store_product_id;
      if found and v_catalog.product_id is not null then
        select * into v_variant from public.product_variants where product_id=v_catalog.product_id and size=v_item.size limit 1;
        if found then
          if v_variant.stock<v_item.quantity then raise exception 'Insufficient centralized stock'; end if;
          update public.product_variants set stock=stock-v_item.quantity,reserved=greatest(0,reserved-v_item.quantity),updated_at=now() where id=v_variant.id;
          insert into public.inventory_movements(product_id,variant_id,movement_type,quantity,reason,reference_id)
          values(v_catalog.product_id,v_variant.id,'web_sale',v_item.quantity,'Venta online entregada','WEB_ORDER:'||new.id::text);
        end if;
      end if;
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists trg_web_order_delivery_release on public.web_orders;
create trigger trg_web_order_delivery_release after update on public.web_orders
for each row execute function public.web_order_delivery_release_trigger();

-- Sincronización inicial de catálogo desde productos que tengan identificador web.
do $$ declare r record; begin for r in select id from public.products loop perform public.sync_web_catalog_from_product(r.id); end loop; end $$;
