-- ============================================================
--  Un solo aviso por cambio.
--  Al confirmar una transferencia, el panel también pasa el pedido
--  a "preparando". En ese caso el aviso de preparación ya dice que
--  se recibió la transferencia, así que no se manda un segundo mensaje.
-- ============================================================

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
  elsif new.payment_confirmed and not old.payment_confirmed then
    perform net.http_post(url := v_url, headers := v_headers,
      body := jsonb_build_object('order_id', new.id, 'status', 'payment_confirmed'));
  end if;
  return null;
end $$;
revoke execute on function public.notify_whatsapp_status() from public, anon, authenticated;
