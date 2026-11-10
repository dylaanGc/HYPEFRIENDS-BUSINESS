-- Mantiene el catálogo web enlazado a las variantes y existencias reales de Finanzas.
-- Repetible: no modifica pedidos, ventas ni cantidades de inventario.
do $$
declare
  next_store_id bigint;
  product_row record;
begin
  perform pg_advisory_xact_lock(hashtext('hypefriends-inventory-store-sync'));
  select greatest(
    coalesce((select max(store_product_id::bigint) from public.products where store_product_id ~ '^[0-9]+$'),0),
    coalesce((select max(store_product_id::bigint) from public.web_store_catalog where store_product_id ~ '^[0-9]+$'),0)
  ) into next_store_id;

  for product_row in
    select id
    from public.products
    where store_product_id is null and active and publish_online
    order by created_at,id
  loop
    next_store_id:=next_store_id+1;
    update public.products
    set store_product_id=next_store_id::text,updated_at=now()
    where id=product_row.id;
  end loop;
end $$;

create or replace view public.web_store_catalog_inventory
with (security_invoker=true) as
select
  c.store_product_id,
  c.product_name,
  c.unit_price,
  c.currency,
  c.category,
  c.image_url,
  c.description,
  case
    when c.product_id is null then c.available_sizes
    else coalesce(v.available_sizes,array['ÚNICA'::text])
  end as available_sizes,
  c.active,
  c.drop_available_at,
  case
    when c.product_id is null then greatest(c.stock_snapshot,0)::integer
    else coalesce(v.available_stock,0)::integer
  end as available_stock,
  case
    when c.product_id is null then '{}'::jsonb
    else coalesce(v.size_stock,'{}'::jsonb)
  end as size_stock
from public.web_store_catalog c
left join lateral (
  select
    sum(available_stock)::integer as available_stock,
    array_agg(size order by size) as available_sizes,
    jsonb_object_agg(size,available_stock) as size_stock
  from (
    select size,sum(greatest(stock-reserved,0))::integer as available_stock
    from public.product_variants
    where product_id=c.product_id
    group by size
  ) variant_stock
) v on c.product_id is not null;

grant select on public.web_store_catalog_inventory to service_role;
