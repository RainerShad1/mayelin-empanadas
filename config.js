// ============================================================
//  Configuración de Mayelin Empanadas
//  El menú, los precios, el envío y el pedido mínimo se editan
//  desde el panel (admin.html), no aquí.
// ============================================================

window.CONFIG = {
  businessName: "Mayelin Empanadas",
  owner: "Wanda Castro",

  // Base de datos (Supabase). La clave "publishable" es pública por diseño:
  // la seguridad la dan las reglas de la base de datos.
  supabase: {
    url: "https://fadxzqgiscluekrxbdkp.supabase.co",
    key: "sb_publishable_3-DdDkc3qLuTE6PL2bmKNw_Qaf_KD4a",
  },

  // Número de WhatsApp que recibe los pedidos (el del bot): solo dígitos, con código de país.
  // Ejemplo: "18095551234" (sin +, espacios ni guiones).
  whatsapp: "18298531204",
  // Número que atiende una persona: se muestra en las páginas legales para
  // reclamos y pedidos de borrado, porque el número del bot no lo lee nadie.
  contactWhatsapp: "18097527776",

  // Código de país que se agrega a los teléfonos de clientes escritos sin él
  // (para el botón "Avisar por WhatsApp" del panel).
  phoneCountryCode: "1",

  currency: "RD$",

  // Texto junto al costo de envío en la página. Pon "" cuando termine la oferta.
  deliveryNote: "oferta de apertura",

  // Horario por día (0 = domingo … 6 = sábado). null = cerrado ese día.
  hours: {
    0: ["18:00", "22:00"],
    1: ["18:00", "22:00"],
    2: ["18:00", "22:00"],
    3: ["18:00", "22:00"],
    4: ["18:00", "22:00"],
    5: ["18:00", "22:00"],
    6: ["18:00", "22:00"],
  },
  // PRUEBAS: true = la página aparece siempre abierta. Ponlo en false al abrir al público.
  alwaysOpenForTesting: true,
  // true = se pueden enviar pedidos aunque esté cerrado.
  acceptOrdersWhenClosed: false,

  // Ubicación del local [latitud, longitud] y radio de entrega en km.
  // Con location: null no se valida la zona de entrega.
  store: {
    location: [18.43119, -68.967513],
    deliveryRadiusKm: 6,
  },
  // Dónde arranca el mapa antes de que el cliente marque su ubicación.
  mapStart: { center: [18.43119, -68.967513], zoom: 14 },

  // Mensajes que se le envían al cliente en cada estado.
  // {code} = número de pedido, {name} = nombre del cliente, {total} = total.
  // Los usa el botón "Avisar por WhatsApp" del panel cuando el bot no puede avisar.
  // Los mensajes automáticos del bot están en supabase/functions/whatsapp/index.ts.
  statusMessages: {
    pending: "¡Hola {name}! Recibimos tu pedido #{code} por {total}. ¿Nos confirmas que todo está correcto?",
    confirmed: "✅ ¡Orden #{code} recibida y confirmada! Te iremos avisando el estado de tu pedido.",
    preparing: "👩‍🍳 ¡Estamos preparando tu pedido #{code}!",
    on_the_way: "🛵 ¡Tu pedido #{code} está en camino!",
    delivered: "🥟 ¡Pedido #{code} entregado! Gracias por elegir Mayelin Empanadas. ¡Buen provecho!",
    cancelled: "Tu pedido #{code} fue cancelado. Si tienes alguna duda, escríbenos.",
  },
};
