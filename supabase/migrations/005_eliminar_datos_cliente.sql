-- ============================================================
--  Eliminación de datos de un cliente (solo administradores).
--  Conserva productos, totales y fechas sin datos personales.
--  No toca pedidos en curso: esos se atienden al terminar.
-- ============================================================

create function public.delete_customer_data(p_phone text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
  v_active int;
  v_orders int;
  v_messages int;
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  if length(v_tail) < 8 then raise exception 'invalid_phone'; end if;

  select count(*) into v_active from public.orders
  where status in ('pending', 'confirmed', 'preparing', 'on_the_way')
    and (right(regexp_replace(phone, '\D', '', 'g'), 8) = v_tail or right(coalesce(wa_id, ''), 8) = v_tail);

  update public.orders set
    customer_name = 'Datos eliminados', phone = '', address = '', reference = null,
    lat = 0, lng = 0, notes = null, cash_with = null, wa_id = null
  where status in ('delivered', 'cancelled')
    and (right(regexp_replace(phone, '\D', '', 'g'), 8) = v_tail or right(coalesce(wa_id, ''), 8) = v_tail);
  get diagnostics v_orders = row_count;

  -- Sin pedidos en curso se borran todos sus mensajes; con pedidos en curso se conservan hasta terminar
  v_messages := 0;
  if v_active = 0 then
    delete from public.wa_messages where right(regexp_replace(wa_id, '\D', '', 'g'), 8) = v_tail;
    get diagnostics v_messages = row_count;
  end if;

  return jsonb_build_object('orders', v_orders, 'messages', v_messages, 'active', v_active);
end $$;

revoke execute on function public.delete_customer_data(text) from public, anon;
grant execute on function public.delete_customer_data(text) to authenticated;
