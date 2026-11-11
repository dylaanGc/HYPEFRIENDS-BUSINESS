-- Permite programar el lanzamiento en Finanzas y sincronizarlo al catálogo web.
alter table public.products
  add column if not exists drop_available_at timestamptz;

alter table public.web_store_catalog
  add column if not exists drop_available_at timestamptz;

update public.products p
set drop_available_at=c.drop_available_at
from public.web_store_catalog c
where c.store_product_id=p.store_product_id
  and p.drop_available_at is null
  and c.drop_available_at is not null;

create or replace function public.sync_web_catalog_from_product(p_product uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v public.products%rowtype;
  v_id text;
  v_sizes text[];
begin
  select * into v from public.products where id=p_product;
  if not found or v.store_product_id is null or v.store_product_id='' then return; end if;
  v_id:=v.store_product_id;
  select coalesce(array_agg(distinct size order by size) filter(where size is not null),array['ÚNICA'::text])
    into v_sizes
  from public.product_variants
  where product_id=v.id;

  if not exists(select 1 from public.web_store_catalog where store_product_id=v_id) then
    insert into public.web_store_catalog(
      store_product_id,product_name,unit_price,currency,category,stock_snapshot,
      available_sizes,active,drop_available_at,image_url,description,product_id
    )
    values(
      v_id,v.name,v.price,coalesce(v.currency,'CRC'),
      coalesce(v.category_slug,v.category,'General'),coalesce(v.stock,0),v_sizes,
      v.active and v.publish_online,v.drop_available_at,v.image_url,v.description,v.id
    );
  else
    update public.web_store_catalog
    set product_name=v.name,
        unit_price=v.price,
        currency=coalesce(v.currency,'CRC'),
        category=coalesce(v.category_slug,v.category,'General'),
        stock_snapshot=coalesce(v.stock,0),
        available_sizes=v_sizes,
        active=v.active and v.publish_online,
        drop_available_at=v.drop_available_at,
        image_url=v.image_url,
        description=v.description,
        product_id=v.id,
        updated_at=now()
    where store_product_id=v_id;
  end if;
end; $$;
