-- HYPEFRIENDS BUSINESS — compras del sitio web
-- Migración aditiva: no modifica ventas manuales ni ajusta inventario.

create table if not exists public.web_orders (
  id uuid primary key,
  order_number text not null unique,
  checkout_reference text not null unique,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  currency text not null default 'CRC' check (currency in ('CRC','USD')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total numeric(12,2) not null check (total > 0),
  payment_method text not null check (payment_method in ('bank_transfer','sinpe_movil','cash_on_delivery')),
  delivery_zone text not null check (delivery_zone in ('gam','outside_gam')),
  payment_status text not null default 'pending' check (payment_status in ('pending','proof_submitted','paid','rejected')),
  order_status text not null default 'new' check (order_status in ('new','preparing','shipped','delivered','cancelled')),
  shipping_address text,
  customer_notes text,
  proof_path text,
  payment_rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (round(subtotal + shipping_amount, 2) = total),
  check (proof_path is null or proof_path like (id::text || '/%')),
  check (payment_status <> 'proof_submitted' or proof_path is not null),
  check (payment_method <> 'cash_on_delivery' or proof_path is null)
);

alter table public.web_orders
  add column if not exists delivery_zone text not null default 'gam'
  check (delivery_zone in ('gam','outside_gam'));

create table if not exists public.web_store_catalog (
  store_product_id text primary key check (store_product_id ~ '^[1-9][0-9]*$'),
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  currency text not null default 'CRC' check (currency='CRC'),
  category text not null,
  stock_snapshot integer not null check (stock_snapshot >= 0),
  available_sizes text[] not null,
  active boolean not null default true,
  drop_available_at timestamptz,
  updated_at timestamptz not null default now(),
  check (cardinality(available_sizes)>0)
);

insert into public.web_store_catalog
  (store_product_id,product_name,unit_price,category,stock_snapshot,available_sizes,active,drop_available_at)
values
  ('1','POLO RALPH LAUREN',18000,'tee',12,array['S','M','L','XL'],true,null),
  ('2','CAMISETA CHROME HEARTS',28000,'tee',20,array['S','M','L','XL'],true,null),
  ('3','SHORT CORTEIZ',25000,'short',8,array['S','M','L','XL'],true,null),
  ('4','HOODIE SUPREME MAISON MARGIELA',20000,'hoodie',6,array['S','M','L','XL'],true,'2026-11-30 00:00:00+00'),
  ('5','CAMISETA CHROME HEARTS',25000,'tee',15,array['S','M','L','XL'],true,null),
  ('6','CAP CHROME HEARTS',15000,'cap',9,array['ÚNICA'],true,null),
  ('7','CORE HOODIE',48000,'hoodie',5,array['S','M','L','XL'],true,'2026-11-30 00:00:00+00'),
  ('8','CAMISA SUPREME DUCATI',25000,'tee',18,array['S','M','L','XL'],true,null),
  ('9','HYPEFRIENDS CAP BLACK',25000,'cap',10,array['ÚNICA'],true,null),
  ('10','ESSENTIAL SHORT BLACK',24000,'short',10,array['S','M','L','XL'],true,null),
  ('11','DENIM BAGGY SHORT',26000,'short',7,array['S','M','L','XL'],true,null),
  ('12','SHOULDER BAG GOYAR',35000,'accessory',8,array['ÚNICA'],true,null),
  ('13','HYPEFRIENDS PENDANT',30000,'accessory',6,array['ÚNICA'],true,'2026-11-30 00:00:00+00'),
  ('14','HYPEFRIENDS CROSSBODY BAG',32000,'accessory',9,array['ÚNICA'],true,null)
on conflict (store_product_id) do nothing;

create table if not exists public.web_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete cascade,
  store_product_id text references public.web_store_catalog(store_product_id),
  product_name text not null,
  sku text,
  variant text,
  size text,
  color text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

alter table public.web_order_items add column if not exists store_product_id text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.web_order_items'::regclass and conname='web_order_items_store_product_id_fkey'
  ) then
    alter table public.web_order_items
      add constraint web_order_items_store_product_id_fkey
      foreign key (store_product_id) references public.web_store_catalog(store_product_id);
  end if;
end $$;

create table if not exists public.web_order_activity (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete cascade,
  event_label text not null,
  details text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.web_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.web_orders(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency in ('CRC','USD')),
  method text not null check (method in ('bank_transfer','sinpe_movil','cash_on_delivery')),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint like 'https://%' and length(endpoint)<=2048),
  p256dh text not null check (length(p256dh)<=256),
  auth text not null check (length(auth)<=256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,endpoint)
);

create table if not exists public.web_push_deliveries (
  order_id uuid not null references public.web_orders(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending','sent','failed')),
  response_status integer,
  updated_at timestamptz not null default now(),
  primary key (order_id,subscription_id)
);

create index if not exists web_orders_created_at_idx on public.web_orders(created_at desc);
create index if not exists web_orders_status_idx on public.web_orders(order_status, payment_status);
create index if not exists web_orders_customer_name_search_idx on public.web_orders(lower(customer_name));
create index if not exists web_order_items_order_id_idx on public.web_order_items(order_id);
create index if not exists web_order_activity_order_id_idx on public.web_order_activity(order_id, created_at desc);

create or replace view public.web_store_catalog_inventory
with (security_invoker=true)
as
select
  catalog.store_product_id,
  catalog.product_name,
  catalog.unit_price,
  catalog.currency,
  catalog.available_sizes,
  catalog.active,
  catalog.drop_available_at,
  greatest(
    catalog.stock_snapshot-coalesce(sum(items.quantity) filter (where orders.order_status<>'cancelled'),0),
    0
  )::integer as available_stock
from public.web_store_catalog catalog
left join public.web_order_items items on items.store_product_id=catalog.store_product_id
left join public.web_orders orders on orders.id=items.order_id
group by catalog.store_product_id;

alter table public.web_orders enable row level security;
alter table public.web_store_catalog enable row level security;
alter table public.web_order_items enable row level security;
alter table public.web_order_activity enable row level security;
alter table public.web_order_payments enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_deliveries enable row level security;

drop policy if exists "authenticated users read web orders" on public.web_orders;
drop policy if exists "authenticated users read web store catalog" on public.web_store_catalog;
drop policy if exists "authenticated users read web order items" on public.web_order_items;
drop policy if exists "authenticated users read web order activity" on public.web_order_activity;
drop policy if exists "authenticated users read web order payments" on public.web_order_payments;
drop policy if exists "users manage own web push subscriptions" on public.web_push_subscriptions;
revoke all on public.web_orders,public.web_store_catalog,public.web_order_items,public.web_order_activity,public.web_order_payments,public.web_push_subscriptions,public.web_push_deliveries from anon,authenticated;
grant select on public.web_orders,public.web_order_items,public.web_order_activity,public.web_order_payments to authenticated;
grant select on public.web_store_catalog to service_role;
grant select on public.web_store_catalog_inventory to service_role;
grant select,insert,update,delete on public.web_push_subscriptions to authenticated;
create policy "authenticated users read web orders" on public.web_orders for select to authenticated using (auth.uid() is not null);
create policy "authenticated users read web order items" on public.web_order_items for select to authenticated using (auth.uid() is not null);
create policy "authenticated users read web order activity" on public.web_order_activity for select to authenticated using (auth.uid() is not null);
create policy "authenticated users read web order payments" on public.web_order_payments for select to authenticated using (auth.uid() is not null);
create policy "users manage own web push subscriptions" on public.web_push_subscriptions for all to authenticated
using (user_id=auth.uid()) with check (user_id=auth.uid());

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('web-order-proofs','web-order-proofs',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "authenticated users read web order proofs" on storage.objects;
create policy "authenticated users read web order proofs" on storage.objects
for select to authenticated
using (
  bucket_id='web-order-proofs'
  and exists (
    select 1 from public.web_orders o
    where o.id::text=split_part(name,'/',1)
      and o.proof_path=name
      and auth.uid() is not null
  )
);

create or replace function public.create_web_order(
  p_order_id uuid,
  p_order_number text,
  p_checkout_reference text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_currency text,
  p_subtotal numeric,
  p_shipping_amount numeric,
  p_total numeric,
  p_payment_method text,
  p_delivery_zone text,
  p_shipping_address text,
  p_customer_notes text,
  p_items jsonb,
  p_proof_path text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.web_orders%rowtype;
  v_item jsonb;
  v_catalog public.web_store_catalog%rowtype;
  v_subtotal numeric(12,2) := 0;
  v_quantity integer;
  v_requested integer;
  v_unit_price numeric(12,2);
  v_reserved integer;
  v_existing_items jsonb;
  v_requested_items jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the trusted checkout backend can create website orders' using errcode='42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Website order items must be an array' using errcode='22023';
  end if;
  if p_order_id is null
    or nullif(btrim(p_order_number),'') is null
    or nullif(btrim(p_checkout_reference),'') is null
    or nullif(btrim(p_customer_name),'') is null
    or p_currency is null
    or p_currency not in ('CRC','USD')
    or p_payment_method is null
    or p_payment_method not in ('bank_transfer','sinpe_movil','cash_on_delivery')
    or p_delivery_zone is null
    or p_delivery_zone not in ('gam','outside_gam')
    or p_subtotal is null
    or p_shipping_amount is null
    or p_total is null
    or p_subtotal < 0
    or p_shipping_amount < 0
    or p_total <= 0
  then
    raise exception 'Invalid website order data' using errcode='22023';
  end if;
  if jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then
    raise exception 'Website order must contain between 1 and 100 items' using errcode='22023';
  end if;
  if length(p_order_number)>100 or length(p_checkout_reference)>200 or length(btrim(p_customer_name))>200
    or length(coalesce(p_customer_email,''))>320 or length(coalesce(p_customer_phone,''))>50
    or length(coalesce(p_shipping_address,''))>1000 or length(coalesce(p_customer_notes,''))>2000
  then raise exception 'Website order data exceeds allowed length' using errcode='22023'; end if;

  select * into v_order from public.web_orders
  where checkout_reference=btrim(p_checkout_reference) for update;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'store_product_id',i.store_product_id,
      'product_name',i.product_name,
      'sku',i.sku,
      'variant',i.variant,
      'size',i.size,
      'color',i.color,
      'quantity',i.quantity,
      'unit_price',i.unit_price
    ) order by i.store_product_id,i.size,i.color,i.variant),'[]'::jsonb)
    into v_existing_items
    from public.web_order_items i where i.order_id=v_order.id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'store_product_id',item->>'store_product_id',
      'product_name',nullif(btrim(item->>'product_name'),''),
      'sku',nullif(btrim(item->>'sku'),''),
      'variant',nullif(btrim(item->>'variant'),''),
      'size',nullif(btrim(item->>'size'),''),
      'color',nullif(btrim(item->>'color'),''),
      'quantity',(item->>'quantity')::integer,
      'unit_price',(item->>'unit_price')::numeric(12,2)
    ) order by item->>'store_product_id',item->>'size',item->>'color',item->>'variant'),'[]'::jsonb)
    into v_requested_items
    from jsonb_array_elements(p_items) as requested(item);
    if v_order.id<>p_order_id or v_order.currency<>p_currency
      or v_order.total<>p_total or lower(coalesce(v_order.customer_email,''))<>lower(coalesce(nullif(btrim(p_customer_email),''),''))
      or coalesce(v_order.customer_phone,'')<>coalesce(nullif(btrim(p_customer_phone),''),'')
      or v_order.subtotal<>p_subtotal or v_order.shipping_amount<>p_shipping_amount
      or v_order.customer_name<>btrim(p_customer_name)
      or coalesce(v_order.customer_notes,'')<>coalesce(nullif(btrim(p_customer_notes),''),'')
      or v_order.payment_method<>p_payment_method or v_order.delivery_zone<>p_delivery_zone
      or coalesce(v_order.shipping_address,'')<>coalesce(nullif(btrim(p_shipping_address),''),'')
      or v_existing_items is distinct from v_requested_items
    then raise exception 'Checkout reference was already used for a different order' using errcode='23505'; end if;
    return v_order.id;
  end if;
  if p_proof_path is not null and (p_payment_method='cash_on_delivery' or p_proof_path !~ ('^' || p_order_id::text || '/[^/]+$')) then
    raise exception 'Invalid payment proof path or method' using errcode='22023';
  end if;
  if p_proof_path is not null and not exists (
    select 1 from storage.objects where bucket_id='web-order-proofs' and name=p_proof_path
  ) then
    raise exception 'The uploaded payment proof was not found in private storage' using errcode='22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric(12,2);
    select * into v_catalog
    from public.web_store_catalog
    where store_product_id=v_item->>'store_product_id'
    for update;
    if v_quantity <= 0 or v_unit_price < 0 or nullif(btrim(v_item->>'product_name'),'') is null
      or not found or not v_catalog.active
      or (v_catalog.drop_available_at is not null and v_catalog.drop_available_at>now())
      or v_item->>'product_name'<>v_catalog.product_name
      or v_unit_price<>v_catalog.unit_price
      or v_catalog.currency<>p_currency
      or not (v_item->>'size'=any(v_catalog.available_sizes))
      or length(v_item->>'product_name')>200 or length(coalesce(v_item->>'sku',''))>100
      or length(coalesce(v_item->>'variant',''))>200 or length(coalesce(v_item->>'size',''))>50
      or length(coalesce(v_item->>'color',''))>100
    then
      raise exception 'Invalid website order item' using errcode='22023';
    end if;
    select coalesce(sum(i.quantity),0)::integer into v_reserved
    from public.web_order_items i
    join public.web_orders o on o.id=i.order_id
    where i.store_product_id=v_catalog.store_product_id
      and o.order_status<>'cancelled';
    select coalesce(sum((item->>'quantity')::integer),0)::integer into v_requested
    from jsonb_array_elements(p_items) as requested(item)
    where item->>'store_product_id'=v_catalog.store_product_id;
    if v_requested+v_reserved>v_catalog.stock_snapshot then
      raise exception 'Insufficient available stock for %',v_catalog.product_name using errcode='22023';
    end if;
    v_subtotal := v_subtotal + v_quantity * v_unit_price;
  end loop;
  if round(v_subtotal,2) <> round(p_subtotal,2) or round(p_subtotal+p_shipping_amount,2) <> round(p_total,2) then
    raise exception 'Order amounts do not match the item subtotal and shipping' using errcode='22023';
  end if;

  insert into public.web_orders (
    id,order_number,checkout_reference,customer_name,customer_email,customer_phone,
    currency,subtotal,shipping_amount,total,payment_method,delivery_zone,payment_status,
    shipping_address,customer_notes,proof_path
  ) values (
    p_order_id,btrim(p_order_number),btrim(p_checkout_reference),btrim(p_customer_name),
    nullif(btrim(p_customer_email),''),nullif(btrim(p_customer_phone),''),
    p_currency,p_subtotal,p_shipping_amount,p_total,p_payment_method,p_delivery_zone,
    case when p_proof_path is null then 'pending' else 'proof_submitted' end,
    nullif(btrim(p_shipping_address),''),nullif(btrim(p_customer_notes),''),p_proof_path
  ) returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.web_order_items (order_id,store_product_id,product_name,sku,variant,size,color,quantity,unit_price)
    values (
      v_order.id,v_item->>'store_product_id',btrim(v_item->>'product_name'),nullif(btrim(v_item->>'sku'),''),
      nullif(btrim(v_item->>'variant'),''),nullif(btrim(v_item->>'size'),''),
      nullif(btrim(v_item->>'color'),''),(v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric(12,2)
    );
  end loop;

  insert into public.web_order_activity (order_id,event_label,details)
  values (v_order.id,'Pedido recibido desde el sitio web','Compra registrada por checkout.');
  return v_order.id;
end;
$$;

create or replace function public.submit_web_order_proof(p_order_id uuid,p_proof_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.web_orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the trusted checkout backend can submit website order proofs' using errcode='42501';
  end if;
  select * into v_order from public.web_orders where id=p_order_id for update;
  if not found then raise exception 'Website order not found' using errcode='P0002'; end if;
  if v_order.payment_method='cash_on_delivery' or v_order.payment_status not in ('pending','rejected') then
    raise exception 'This order cannot accept a new payment proof' using errcode='22023';
  end if;
  if p_proof_path !~ ('^' || p_order_id::text || '/[^/]+$')
    or not exists(select 1 from storage.objects where bucket_id='web-order-proofs' and name=p_proof_path)
  then raise exception 'The uploaded payment proof is not valid' using errcode='22023'; end if;
  update public.web_orders
  set proof_path=p_proof_path,payment_status='proof_submitted',payment_rejection_reason=null,updated_at=now()
  where id=p_order_id;
  insert into public.web_order_activity(order_id,event_label,details)
  values(p_order_id,'Nuevo comprobante recibido','Comprobante enviado por el sitio web.');
end;
$$;

create or replace function public.mark_web_order_reviewed(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.web_orders%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_order from public.web_orders where id=p_order_id for update;
  if not found then raise exception 'Website order not found' using errcode='P0002'; end if;
  if v_order.reviewed_at is null then
    select name into v_actor_name from public.profiles where id=auth.uid();
    update public.web_orders set reviewed_at=now(),updated_at=now() where id=p_order_id;
    insert into public.web_order_activity(order_id,event_label,actor_id,actor_name)
    values(p_order_id,'Compra marcada como revisada',auth.uid(),v_actor_name);
  end if;
end;
$$;

create or replace function public.review_web_order_payment(
  p_order_id uuid,
  p_approved boolean,
  p_rejection_reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.web_orders%rowtype;
  v_actor_name text;
  v_reason text := nullif(btrim(p_rejection_reason),'');
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_order from public.web_orders where id=p_order_id for update;
  if not found then raise exception 'Website order not found' using errcode='P0002'; end if;
  if v_order.payment_status <> 'proof_submitted' or v_order.proof_path is null then
    raise exception 'There is no submitted proof to review' using errcode='22023';
  end if;
  if p_approved is null then raise exception 'Approval decision is required' using errcode='22023'; end if;
  if p_approved is false and v_reason is null then
    raise exception 'A rejection reason is required' using errcode='22023';
  end if;
  if length(coalesce(v_reason,''))>500 then raise exception 'Rejection reason is too long' using errcode='22023'; end if;
  select name into v_actor_name from public.profiles where id=auth.uid();

  if p_approved then
    insert into public.web_order_payments(order_id,amount,currency,method,recorded_by)
    values(v_order.id,v_order.total,v_order.currency,v_order.payment_method,auth.uid())
    on conflict (order_id) do nothing;
    if not found then raise exception 'Payment already exists for this order' using errcode='23505'; end if;
    update public.web_orders set payment_status='paid',payment_rejection_reason=null,updated_at=now() where id=p_order_id;
    insert into public.web_order_activity(order_id,event_label,details,actor_id,actor_name)
    values(p_order_id,'Comprobante aprobado y pago verificado','Pago registrado una sola vez.',auth.uid(),v_actor_name);
  else
    update public.web_orders set payment_status='rejected',payment_rejection_reason=v_reason,updated_at=now() where id=p_order_id;
    insert into public.web_order_activity(order_id,event_label,details,actor_id,actor_name)
    values(p_order_id,'Comprobante rechazado',v_reason,auth.uid(),v_actor_name);
  end if;
end;
$$;

create or replace function public.confirm_web_order_cod_payment(p_order_id uuid,p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.web_orders%rowtype;
  v_actor_name text;
  v_note text := nullif(btrim(p_note),'');
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_order from public.web_orders where id=p_order_id for update;
  if not found then raise exception 'Website order not found' using errcode='P0002'; end if;
  if v_order.payment_method <> 'cash_on_delivery'
    or v_order.payment_status <> 'pending'
    or v_order.order_status='cancelled'
  then raise exception 'This order is not awaiting a cash-on-delivery payment' using errcode='22023'; end if;
  select name into v_actor_name from public.profiles where id=auth.uid();
  insert into public.web_order_payments(order_id,amount,currency,method,recorded_by)
  values(v_order.id,v_order.total,v_order.currency,v_order.payment_method,auth.uid())
  on conflict (order_id) do nothing;
  if not found then raise exception 'Payment already exists for this order' using errcode='23505'; end if;
  update public.web_orders set payment_status='paid',updated_at=now() where id=p_order_id;
  insert into public.web_order_activity(order_id,event_label,details,actor_id,actor_name)
  values(p_order_id,'Cobro contra entrega confirmado',coalesce(v_note,'Cobro recibido y verificado.'),auth.uid(),v_actor_name);
end;
$$;

create or replace function public.update_web_order_status(p_order_id uuid,p_new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.web_orders%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_new_status is null or p_new_status not in ('new','preparing','shipped','delivered','cancelled') then
    raise exception 'Invalid website order status' using errcode='22023';
  end if;
  select * into v_order from public.web_orders where id=p_order_id for update;
  if not found then raise exception 'Website order not found' using errcode='P0002'; end if;
  if p_new_status=v_order.order_status then return; end if;
  if not (
    (v_order.order_status='new' and p_new_status in ('preparing','cancelled'))
    or (v_order.order_status='preparing' and p_new_status in ('shipped','cancelled'))
    or (v_order.order_status='shipped' and p_new_status='delivered')
  ) then raise exception 'Invalid order status transition' using errcode='22023'; end if;
  select name into v_actor_name from public.profiles where id=auth.uid();
  update public.web_orders set order_status=p_new_status,updated_at=now() where id=p_order_id;
  insert into public.web_order_activity(order_id,event_label,details,actor_id,actor_name)
  values(p_order_id,'Estado del pedido actualizado',v_order.order_status || ' → ' || p_new_status,auth.uid(),v_actor_name);
end;
$$;

create or replace function public.claim_web_push_delivery(
  p_order_id uuid,
  p_subscription_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the trusted push sender can claim deliveries' using errcode='42501';
  end if;
  insert into public.web_push_deliveries(order_id,subscription_id)
  values(p_order_id,p_subscription_id)
  on conflict (order_id,subscription_id) do update
    set delivery_status='pending',response_status=null,updated_at=now()
    where public.web_push_deliveries.delivery_status='failed'
      or (
        public.web_push_deliveries.delivery_status='pending'
        and public.web_push_deliveries.updated_at<now()-interval '5 minutes'
      )
  returning true into v_claimed;
  return coalesce(v_claimed,false);
end;
$$;

create or replace function public.finish_web_push_delivery(
  p_order_id uuid,
  p_subscription_id uuid,
  p_delivery_status text,
  p_response_status integer default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the trusted push sender can finish deliveries' using errcode='42501';
  end if;
  if p_delivery_status not in ('sent','failed') then
    raise exception 'Invalid push delivery status' using errcode='22023';
  end if;
  update public.web_push_deliveries
  set delivery_status=p_delivery_status,response_status=p_response_status,updated_at=now()
  where order_id=p_order_id and subscription_id=p_subscription_id
    and delivery_status='pending';
  if not found then
    raise exception 'Push delivery is not currently claimed' using errcode='P0002';
  end if;
end;
$$;

revoke all on function public.create_web_order(uuid,text,text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.submit_web_order_proof(uuid,text) from public, anon, authenticated;
revoke all on function public.mark_web_order_reviewed(uuid) from public, anon;
revoke all on function public.review_web_order_payment(uuid,boolean,text) from public, anon;
revoke all on function public.confirm_web_order_cod_payment(uuid,text) from public, anon;
revoke all on function public.update_web_order_status(uuid,text) from public, anon;
revoke all on function public.claim_web_push_delivery(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_web_push_delivery(uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.create_web_order(uuid,text,text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.submit_web_order_proof(uuid,text) to service_role;
grant execute on function public.mark_web_order_reviewed(uuid) to authenticated;
grant execute on function public.review_web_order_payment(uuid,boolean,text) to authenticated;
grant execute on function public.confirm_web_order_cod_payment(uuid,text) to authenticated;
grant execute on function public.update_web_order_status(uuid,text) to authenticated;
grant execute on function public.claim_web_push_delivery(uuid,uuid) to service_role;
grant execute on function public.finish_web_push_delivery(uuid,uuid,text,integer) to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='web_orders') then
    alter publication supabase_realtime add table public.web_orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='web_order_items') then
    alter publication supabase_realtime add table public.web_order_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='web_order_activity') then
    alter publication supabase_realtime add table public.web_order_activity;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='web_order_payments') then
    alter publication supabase_realtime add table public.web_order_payments;
  end if;
end $$;
