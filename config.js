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
  whatsapp: "18294569607",
  // Número que atiende una persona: se muestra en las páginas legales para
  // reclamos y pedidos de borrado, porque el número del bot no lo lee nadie.
  contactWhatsapp: "18097527776",

  // Código de país que se agrega a los teléfonos de clientes escritos sin él
  // (para el botón "Avisar por WhatsApp" del panel).
  phoneCountryCode: "1",

  currency: "RD$",

  // Oferta del envío: se muestra como etiqueta junto al costo. Pon "" cuando termine la oferta.
  deliveryNote: "Oferta de apertura",
  // Precio normal del envío: si es mayor que el actual, aparece tachado junto a la oferta.
  // Pon null cuando termine la oferta.
  deliveryRegularFee: 100,

  // Horario por día (0 = domingo … 6 = sábado). null = cerrado ese día.
  hours: {
    0: ["17:00", "22:30"],
    1: ["17:00", "22:30"],
    2: ["17:00", "22:30"],
    3: ["17:00", "22:30"],
    4: ["17:00", "22:30"],
    5: ["17:00", "22:30"],
    6: ["17:00", "22:30"],
  },
  // Días feriados: cerrado todo el día. Fecha "AAAA-MM-DD" del día que se descansa
  // (si el Gobierno mueve un feriado a lunes, pon la fecha del lunes).
  holidays: {
    "2026-11-09": "Día de la Constitución",
    "2026-12-25": "Navidad",
    "2027-01-01": "Año Nuevo",
    "2027-01-04": "Día de Reyes",
    "2027-01-21": "Día de la Altagracia",
    "2027-01-25": "Día de Duarte",
    "2027-02-27": "Día de la Independencia",
    "2027-03-26": "Viernes Santo",
    "2027-05-01": "Día del Trabajo",
    "2027-05-27": "Corpus Christi",
    "2027-08-16": "Día de la Restauración",
    "2027-09-24": "Día de las Mercedes",
    "2027-11-06": "Día de la Constitución",
    "2027-12-25": "Navidad",
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
