-- ============================================================
--  Mayelin Empanadas: menú, pedidos y administradores
-- ============================================================

create type public.order_status as enum
  ('pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled');

-- ---------- Ajustes del negocio (una sola fila) ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  delivery_fee numeric(10,2) not null default 100 check (delivery_fee >= 0),
  min_order_units int not null default 6 check (min_order_units >= 0),
  accepting_orders boolean not null default true
);

-- ---------- Menú ----------
create table public.categories (
  id text primary key,
  name text not null,
  position int not null default 0
);

create table public.products (
  id text primary key,
  category_id text not null references public.categories(id) on update cascade,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  units int not null default 1 check (units >= 0),   -- empanadas que cuenta para el mínimo
  image_url text,
  available boolean not null default true,
  position int not null default 0
);
create index products_category_idx on public.products(category_id);

-- ---------- Administradores (usuarios de Supabase Auth) ----------
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;

-- ---------- Pedidos ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status public.order_status not null default 'pending',
  customer_name text not null,
  phone text not null,
  address text not null,
  reference text,
  lat double precision not null,
  lng double precision not null,
  payment text not null check (payment in ('Efectivo', 'Transferencia')),
  cash_with numeric(10,2),
  notes text,
  items jsonb not null,
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null,
  total numeric(10,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status_created_idx on public.orders(status, created_at desc);
create index orders_phone_idx on public.orders(phone);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events(order_id);

-- Historial de estados y fecha de actualización
create function public.touch_order() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create function public.log_order_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events(order_id, status, changed_by)
    values (new.id, new.status, (select auth.uid()));
  end if;
  return null;
end $$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_order();
create trigger orders_log after insert or update of status on public.orders
  for each row execute function public.log_order_status();

-- ---------- Crear pedido (lo llama la página pública) ----------
-- Los precios y el total se calculan aquí, nunca se confía en lo que manda el navegador.
create function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.settings;
  it jsonb;
  prod public.products;
  qty int;
  lines jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_units int := 0;
  v_code text;
  v_lat double precision := (p->>'lat')::double precision;
  v_lng double precision := (p->>'lng')::double precision;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_phone text := btrim(coalesce(p->>'phone', ''));
  v_address text := btrim(coalesce(p->>'address', ''));
  v_payment text := p->>'payment';
  o public.orders;
begin
  select * into s from public.settings where id = 1;
  if not s.accepting_orders then raise exception 'not_accepting'; end if;

  if jsonb_typeof(p->'items') is distinct from 'array'
     or jsonb_array_length(p->'items') not between 1 and 50 then
    raise exception 'invalid_items';
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    qty := (it->>'qty')::int;
    if qty is null or qty < 1 or qty > 99 then raise exception 'invalid_items'; end if;
    select * into prod from public.products where id = it->>'id' and available;
    if not found then raise exception 'product_unavailable:%', it->>'id'; end if;
    lines := lines || jsonb_build_object(
      'id', prod.id, 'name', prod.name, 'price', prod.price, 'qty', qty, 'total', prod.price * qty);
    v_subtotal := v_subtotal + prod.price * qty;
    v_units := v_units + prod.units * qty;
  end loop;

  if v_units < s.min_order_units then raise exception 'below_minimum'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 then raise exception 'invalid_phone'; end if;
  if length(v_address) not between 3 and 200 then raise exception 'invalid_address'; end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'invalid_location';
  end if;
  if v_payment not in ('Efectivo', 'Transferencia') then raise exception 'invalid_payment'; end if;

  loop
    v_code := 'MAY-' || (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 5));
    begin
      insert into public.orders (code, customer_name, phone, address, reference, lat, lng,
                                 payment, cash_with, notes, items, subtotal, delivery_fee, total)
      values (v_code, v_name, v_phone, v_address,
              nullif(left(btrim(coalesce(p->>'reference', '')), 200), ''),
              v_lat, v_lng, v_payment,
              case when v_payment = 'Efectivo' then nullif((p->>'cash')::numeric, 0) end,
              nullif(left(btrim(coalesce(p->>'notes', '')), 500), ''),
              lines, v_subtotal, s.delivery_fee, v_subtotal + s.delivery_fee)
      returning * into o;
      exit;
    exception when unique_violation then
      -- código repetido: se genera otro
    end;
  end loop;

  return jsonb_build_object('code', o.code, 'items', o.items, 'subtotal', o.subtotal,
                            'delivery_fee', o.delivery_fee, 'total', o.total);
end $$;

-- ---------- Permisos ----------
revoke execute on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;
revoke execute on function public.log_order_status() from public, anon, authenticated;
revoke execute on function public.touch_order() from public, anon, authenticated;

alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.admins enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;

-- Menú y ajustes: lectura pública, edición solo administradores
create policy "lectura publica" on public.settings for select to anon, authenticated using (true);
create policy "admin edita" on public.settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "lectura publica" on public.categories for select to anon, authenticated using (true);
create policy "admin inserta" on public.categories for insert to authenticated with check ((select public.is_admin()));
create policy "admin edita" on public.categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin borra" on public.categories for delete to authenticated using ((select public.is_admin()));

create policy "lectura publica" on public.products for select to anon, authenticated using (true);
create policy "admin inserta" on public.products for insert to authenticated with check ((select public.is_admin()));
create policy "admin edita" on public.products for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin borra" on public.products for delete to authenticated using ((select public.is_admin()));

-- Cada usuario puede ver si él mismo es administrador
create policy "ver propio" on public.admins for select to authenticated using (user_id = (select auth.uid()));

-- Pedidos: solo administradores (los clientes crean pedidos con create_order)
create policy "admin lee" on public.orders for select to authenticated using ((select public.is_admin()));
create policy "admin edita" on public.orders for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "admin lee" on public.order_events for select to authenticated using ((select public.is_admin()));

-- Tiempo real para el panel
alter publication supabase_realtime add table public.orders;

-- ---------- Datos de ejemplo ----------
insert into public.settings (id, delivery_fee, min_order_units) values (1, 100, 6);

insert into public.categories (id, name, position) values
  ('clasicas', 'Clásicas', 1),
  ('especiales', 'Especiales', 2),
  ('combos', 'Combos', 3),
  ('bebidas', 'Bebidas', 4);

insert into public.products (id, category_id, name, description, price, units, position) values
  ('carne', 'clasicas', 'Carne', 'Carne molida sazonada con cebolla, ají y aceitunas.', 75, 1, 1),
  ('pollo', 'clasicas', 'Pollo', 'Pollo desmenuzado guisado al estilo de la casa.', 75, 1, 2),
  ('queso', 'clasicas', 'Queso', 'Bien rellena de queso derretido.', 65, 1, 3),
  ('jamon-queso', 'clasicas', 'Jamón y queso', 'La favorita de los niños.', 70, 1, 4),
  ('pizza', 'especiales', 'Pizza', 'Queso, salsa de tomate, pepperoni y orégano.', 85, 1, 1),
  ('pollo-queso', 'especiales', 'Pollo con queso', 'Nuestro pollo guisado con queso derretido.', 90, 1, 2),
  ('vegetales', 'especiales', 'Vegetales', 'Maíz, zanahoria, guisantes y queso.', 80, 1, 3),
  ('docena-clasica', 'combos', 'Docena clásica', '12 surtidas: carne, pollo y queso. Escribe tu mezcla en las notas.', 800, 12, 1),
  ('combo-familiar', 'combos', 'Combo familiar', '24 surtidas + refresco de 2 litros.', 1650, 24, 2),
  ('refresco', 'bebidas', 'Refresco 500 ml', 'Pregunta por los sabores disponibles.', 60, 0, 1),
  ('jugo', 'bebidas', 'Jugo natural', 'Chinola o limón, hecho al momento.', 80, 0, 2);
