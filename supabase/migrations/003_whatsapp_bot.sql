-- ============================================================
--  Bot de WhatsApp: vínculo pedido ↔ cliente, registro de
--  mensajes y aviso automático al cambiar el estado.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- Número de WhatsApp desde el que el cliente escribió, y resultado del último aviso
alter table public.orders
  add column wa_id text,
  add column notified_status public.order_status,
  add column notified_at timestamptz,
  add column notify_error text;
create index orders_wa_id_idx on public.orders(wa_id);

-- Registro de mensajes entrantes y salientes (también evita procesar dos veces el mismo)
create table public.wa_messages (
  id bigint generated always as identity primary key,
  wa_message_id text unique,
  direction text not null check (direction in ('in', 'out')),
  wa_id text not null,
  order_id uuid references public.orders(id) on delete set null,
  kind text,
  body jsonb,
  status text not null,          -- received | sent | simulated | failed
  error text,
  created_at timestamptz not null default now()
);
create index wa_messages_order_idx on public.wa_messages(order_id);

alter table public.wa_messages enable row level security;
create policy "admin lee" on public.wa_messages for select to authenticated using ((select public.is_admin()));

-- Clave interna para que la base de datos le hable a la función del bot
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'whatsapp_internal_secret');

create function public.whatsapp_internal_secret() returns text
language sql stable security definer set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_internal_secret' $$;
revoke execute on function public.whatsapp_internal_secret() from public, anon, authenticated;
grant execute on function public.whatsapp_internal_secret() to service_role;

-- Al cambiar el estado de un pedido vinculado a WhatsApp, se le pide al bot que avise
create function public.notify_whatsapp_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.wa_id is not null and new.status <> 'pending' and new.status is distinct from old.status then
    perform net.http_post(
      url := 'https://fadxzqgiscluekrxbdkp.supabase.co/functions/v1/whatsapp/notify',
      body := jsonb_build_object('order_id', new.id, 'status', new.status),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', public.whatsapp_internal_secret())
    );
  end if;
  return null;
end $$;
revoke execute on function public.notify_whatsapp_status() from public, anon, authenticated;

create trigger orders_notify_whatsapp after update of status on public.orders
  for each row execute function public.notify_whatsapp_status();
