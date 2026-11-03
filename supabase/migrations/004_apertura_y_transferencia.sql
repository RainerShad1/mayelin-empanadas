-- ============================================================
--  Oferta de apertura, adicionales y confirmación manual
--  de transferencias.
-- ============================================================

-- Envío de apertura (luego pasará a 100)
update public.settings set delivery_fee = 75 where id = 1;

insert into public.categories (id, name, position) values ('adicionales', 'Adicionales', 4);
update public.categories set position = 5 where id = 'bebidas';

insert into public.products (id, category_id, name, description, price, units, position) values
  ('salsa-ajo', 'adicionales', 'Salsa de ajo', 'Porción para acompañar tus empanadas.', 25, 0, 1),
  ('mayoketchup', 'adicionales', 'Mayoketchup', 'La clásica, porción para acompañar.', 25, 0, 2),
  ('salsa-picante', 'adicionales', 'Salsa picante', 'Para los que les gusta con fuego.', 25, 0, 3),
  ('queso-extra', 'adicionales', 'Queso extra', 'Agrega queso a una empanada. Indica a cuál en las notas.', 30, 0, 4);

-- Confirmación manual de transferencias
alter table public.orders add column payment_confirmed boolean not null default false;

create or replace function public.notify_whatsapp_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text := 'https://fadxzqgiscluekrxbdkp.supabase.co/functions/v1/whatsapp/notify';
  v_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', public.whatsapp_internal_secret());
begin
  if new.wa_id is null then return null; end if;
  if new.status <> 'pending' and new.status is distinct from old.status then
    perform net.http_post(url := v_url, headers := v_headers,
      body := jsonb_build_object('order_id', new.id, 'status', new.status));
  end if;
  if new.payment_confirmed and not old.payment_confirmed then
    perform net.http_post(url := v_url, headers := v_headers,
      body := jsonb_build_object('order_id', new.id, 'status', 'payment_confirmed'));
  end if;
  return null;
end $$;
revoke execute on function public.notify_whatsapp_status() from public, anon, authenticated;

drop trigger orders_notify_whatsapp on public.orders;
create trigger orders_notify_whatsapp after update of status, payment_confirmed on public.orders
  for each row execute function public.notify_whatsapp_status();
