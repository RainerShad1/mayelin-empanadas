// ============================================================
//  Bot de WhatsApp de Mayelin Empanadas
//
//  GET  /whatsapp          → verificación del webhook (Meta)
//  POST /whatsapp          → mensajes de clientes (Meta)
//  POST /whatsapp/notify   → aviso de cambio de estado (lo llama la base de datos)
//
//  Secretos (Supabase → Edge Functions → Secrets):
//    WA_TOKEN            token de acceso de la API de WhatsApp
//    WA_PHONE_NUMBER_ID  identificador del número del bot
//    WA_APP_SECRET       "clave secreta de la app" de Meta (firma de los webhooks)
//    WA_VERIFY_TOKEN     texto que inventas tú y pegas también en Meta
//    SITE_URL            dirección de la página de pedidos (opcional)
//    WA_GRAPH_VERSION    versión de la API de Meta (opcional, ej. "v23.0")
//
//  Sin WA_TOKEN el bot funciona en modo simulado: no envía nada,
//  solo guarda los mensajes que habría enviado en la tabla wa_messages.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("WA_TOKEN");
const PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID");
const APP_SECRET = Deno.env.get("WA_APP_SECRET");
const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN");
const SITE_URL = Deno.env.get("SITE_URL") ?? "";
const GRAPH_VERSION = Deno.env.get("WA_GRAPH_VERSION") ?? "v23.0";

const CURRENCY = "RD$";
const ACTIVE = ["pending", "confirmed", "preparing", "on_the_way"];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

type Order = {
  id: string;
  code: string;
  status: string;
  customer_name: string;
  phone: string;
  address: string;
  payment: string;
  cash_with: number | null;
  items: { name: string; qty: number; total: number }[];
  delivery_fee: number;
  total: number;
  wa_id: string | null;
  notified_status: string | null;
  created_at: string;
};

// ---------- Textos ----------
const money = (n: number) => CURRENCY + Math.round(Number(n)).toLocaleString("es");
const firstName = (o: Order) => o.customer_name.trim().split(/\s+/)[0];

const STATUS_LABEL: Record<string, string> = {
  pending: "esperando tu confirmación",
  confirmed: "confirmado ✅",
  preparing: "en preparación 👩‍🍳",
  on_the_way: "en camino 🛵",
  delivered: "entregado 🥟",
  cancelled: "cancelado",
};

const STATUS_MESSAGES: Record<string, (o: Order) => string> = {
  confirmed: (o) => `✅ ¡Orden *#${o.code}* recibida y confirmada! Te iremos avisando por aquí el estado de tu pedido.` +
    (o.payment === "Transferencia" ? `

🏦 Pagas por transferencia (${money(o.total)}). En breve te enviaremos los datos de la cuenta. Prepararemos tu pedido cuando confirmemos el pago.` : ""),
  payment_confirmed: (o) => `✅ ¡Recibimos tu transferencia del pedido *#${o.code}*! Gracias.`,
  preparing: (o) => `👩‍🍳 ¡Estamos preparando tu pedido *#${o.code}*!`,
  on_the_way: (o) => `🛵 ¡Tu pedido *#${o.code}* está en camino!` +
    (o.payment === "Efectivo" ? ` Ten listo el pago: ${money(o.total)} en efectivo.` : ""),
  delivered: (o) => `🥟 ¡Pedido *#${o.code}* entregado! Gracias por elegir Mayelin Empanadas, ${firstName(o)}. ¡Buen provecho!`,
  cancelled: (o) => `Tu pedido *#${o.code}* fue cancelado. Si tienes alguna duda, escríbenos por aquí.`,
};

function confirmPrompt(o: Order) {
  const lines = o.items.map((i) => `• ${i.qty} x ${i.name}: ${money(i.total)}`);
  let pay = `💵 ${o.payment}`;
  if (o.cash_with) pay += ` (pagas con ${money(o.cash_with)})`;
  const head = `¡Hola ${firstName(o)}! 👋 Recibimos tu pedido *#${o.code}*:\n\n`;
  const tail = `\n\nEnvío: ${money(o.delivery_fee)}\n*Total: ${money(o.total)}*\n${pay}\n📍 ${o.address}\n\n¿Confirmas tu pedido?`;
  let body = lines.join("\n");
  // El cuerpo de un mensaje con botones admite como máximo 1024 caracteres
  const room = 1024 - head.length - tail.length;
  if (body.length > room) body = body.slice(0, room - 2) + "…";
  return head + body + tail;
}

function statusReply(o: Order) {
  return `Tu pedido *#${o.code}* está ${STATUS_LABEL[o.status] ?? o.status}. ` +
    (ACTIVE.includes(o.status) ? "Te avisaremos por aquí cuando cambie. Si necesitas algo, escríbenos y te responderemos pronto." : "");
}

const notFoundReply = () =>
  "¡Hola! 👋 Gracias por escribir a Mayelin Empanadas. " +
  (SITE_URL ? `Para pedir, entra aquí: ${SITE_URL}` : "Para pedir, entra a nuestra página y envíanos el mensaje que se genera.") +
  "\n\nSi ya hiciste un pedido, envíanos su código (por ejemplo: MAY-AB12C).";

// ---------- Envío de mensajes ----------
async function logMessage(row: Record<string, unknown>) {
  const { error } = await db.from("wa_messages").insert(row);
  if (error) console.error("wa_messages insert", error);
}

async function send(to: string, payload: Record<string, unknown>, orderId: string | null, kind: string) {
  const body = { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload };
  if (!TOKEN || !PHONE_ID) {
    await logMessage({ direction: "out", wa_id: to, order_id: orderId, kind, body, status: "simulated" });
    return { ok: true };
  }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = json?.error?.message ?? `HTTP ${res.status}`;
    await logMessage({ direction: "out", wa_id: to, order_id: orderId, kind, body, status: "failed", error });
    return { ok: false, error };
  }
  await logMessage({
    direction: "out", wa_id: to, order_id: orderId, kind, body, status: "sent",
    wa_message_id: json?.messages?.[0]?.id ?? null,
  });
  return { ok: true };
}

const text = (body: string) => ({ type: "text", text: { body, preview_url: false } });

const buttons = (body: string, items: { id: string; title: string }[]) => ({
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: { buttons: items.map((b) => ({ type: "reply", reply: b })) },
  },
});

// ---------- Búsqueda de pedidos ----------
const digits = (s: string) => s.replace(/\D/g, "");
const sameNumber = (a: string, b: string) => digits(a).slice(-8) === digits(b).slice(-8);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

async function findByCode(code: string) {
  const { data } = await db.from("orders").select("*").eq("code", code).gte("created_at", hoursAgo(48)).maybeSingle();
  return data as Order | null;
}

// Si el cliente borró o cambió el código: su pedido activo más reciente, por número de WhatsApp
async function findByPhone(from: string) {
  const { data } = await db.from("orders").select("*")
    .in("status", ACTIVE).gte("created_at", hoursAgo(24))
    .order("created_at", { ascending: false }).limit(30);
  return ((data ?? []) as Order[]).find((o) => o.wa_id === from || (!o.wa_id && sameNumber(o.phone, from))) ?? null;
}

// ---------- Mensajes entrantes ----------
async function handleMessage(msg: any) {
  const from: string = msg.from;

  // Meta puede reenviar el mismo mensaje: si ya lo guardamos, no se procesa otra vez
  const { error: dup } = await db.from("wa_messages").insert({
    wa_message_id: msg.id, direction: "in", wa_id: from, kind: msg.type, body: msg, status: "received",
  });
  if (dup) {
    if (dup.code !== "23505") console.error("wa_messages insert", dup);
    return;
  }

  if (msg.type === "interactive" && msg.interactive?.type === "button_reply") {
    return handleButton(from, msg.interactive.button_reply.id);
  }

  const body: string = msg.type === "text" ? msg.text?.body ?? "" : "";
  const code = body.toUpperCase().match(/MAY-[A-Z0-9]{5}/)?.[0];

  let order = code ? await findByCode(code) : null;
  if (order?.wa_id && order.wa_id !== from) order = null; // ya está vinculado a otro número
  if (!order) order = await findByPhone(from);
  if (!order) return send(from, text(notFoundReply()), null, "not_found");

  if (!order.wa_id) {
    await db.from("orders").update({ wa_id: from }).eq("id", order.id);
    order.wa_id = from;
  }
  await db.from("wa_messages").update({ order_id: order.id }).eq("wa_message_id", msg.id);

  if (order.status === "pending") {
    return send(from, buttons(confirmPrompt(order), [
      { id: `confirm:${order.id}`, title: "✅ Confirmar" },
      { id: `cancel:${order.id}`, title: "❌ Cancelar" },
    ]), order.id, "confirm_prompt");
  }
  return send(from, text(statusReply(order)), order.id, "status_reply");
}

async function handleButton(from: string, buttonId: string) {
  const [action, orderId] = buttonId.split(":");
  const { data } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  const order = data as Order | null;
  if (!order || order.wa_id !== from) return send(from, text(notFoundReply()), null, "not_found");
  if (order.status !== "pending") return send(from, text(statusReply(order)), order.id, "status_reply");

  // El cambio de estado dispara el aviso (confirmado o cancelado) desde la base de datos
  const status = action === "confirm" ? "confirmed" : action === "cancel" ? "cancelled" : null;
  if (!status) return;
  const { error } = await db.from("orders").update({ status }).eq("id", order.id).eq("status", "pending");
  if (error) console.error("orders update", error);
}

// ---------- Aviso de cambio de estado ----------
async function handleNotify(orderId: string, status: string) {
  const { data } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  const order = data as Order | null;
  const message = STATUS_MESSAGES[status];
  if (!order?.wa_id || !message || order.notified_status === status) return;
  const r = await send(order.wa_id, text(message({ ...order, status })), order.id, `status:${status}`);
  // La confirmación de pago no es un estado del pedido: solo se registra si falla
  if (status === "payment_confirmed") {
    if (!r.ok) await db.from("orders").update({ notify_error: r.error }).eq("id", order.id);
    return;
  }
  await db.from("orders").update(
    r.ok
      ? { notified_status: status, notified_at: new Date().toISOString(), notify_error: null }
      : { notify_error: r.error },
  ).eq("id", order.id);
}

// ---------- Seguridad ----------
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSignature(raw: Uint8Array, header: string | null) {
  if (!APP_SECRET || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, header.slice(7));
}

let internalSecret: string | null = null;
async function isInternal(req: Request) {
  const given = req.headers.get("x-internal-secret");
  if (!given) return false;
  if (!internalSecret) {
    const { data, error } = await db.rpc("whatsapp_internal_secret");
    if (error || !data) return false;
    internalSecret = data as string;
  }
  return safeEqual(given, internalSecret);
}

// ---------- Servidor ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Meta comprueba el webhook al configurarlo
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      !!VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok
      ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 })
      : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = new Uint8Array(await req.arrayBuffer());

  if (url.pathname.endsWith("/notify")) {
    if (!(await isInternal(req))) return new Response("Forbidden", { status: 403 });
    const { order_id, status } = JSON.parse(new TextDecoder().decode(raw));
    await handleNotify(order_id, status);
    return new Response("ok");
  }

  // Webhook de Meta: firmado con la clave secreta de la app.
  // También se aceptan pruebas internas con la clave interna (para simular mensajes).
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"))) && !(await isInternal(req))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(new TextDecoder().decode(raw));
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        try {
          await handleMessage(msg);
        } catch (err) {
          console.error("handleMessage", err);
        }
      }
    }
  }
  // Siempre 200 para que Meta no reintente mensajes ya procesados
  return new Response("ok");
});
