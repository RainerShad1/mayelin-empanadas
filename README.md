# Mayelin Empanadas

Página de pedidos a domicilio para Mayelin Empanadas (La Romana, República Dominicana), con panel del negocio y bot de WhatsApp que confirma pedidos y avisa cada cambio de estado.

## Cómo funciona

1. El cliente arma su pedido en la página, marca su ubicación en el mapa y lo envía. El pedido se guarda en la base de datos con un código (`MAY-XXXXX`) y se abre WhatsApp con el resumen.
2. El cliente envía ese mensaje al número del bot. El bot enlaza el pedido a su chat y le pide confirmarlo con botones.
3. El negocio cambia el estado del pedido en el panel (`/admin`). Cada cambio dispara un aviso automático por WhatsApp.

## Partes

| Parte | Archivos | Dónde corre |
|---|---|---|
| Página de pedidos | `index.html`, `app.js`, `styles.css`, `config.js` | Vercel (sitio estático) |
| Panel del negocio | `admin.html`, `admin.js`, `admin.css` | Vercel, en `/admin` |
| Páginas legales | `privacidad.html`, `terminos.html`, `eliminar-datos.html`, `legal.js` | Vercel |
| Base de datos | `supabase/migrations/*.sql` | Supabase (Postgres con RLS) |
| Bot de WhatsApp | `supabase/functions/whatsapp/index.ts` | Supabase Edge Functions |

Sin paso de compilación: HTML, CSS y JavaScript sin dependencias, más Leaflet (mapa) y supabase-js desde CDN.

## Configuración

- `config.js`: número de WhatsApp del bot, número de contacto, horario, zona de entrega, textos. La clave de Supabase que aparece ahí es la pública ("publishable"); la seguridad la dan las reglas de la base de datos.
- Menú, precios, costo de envío y pedido mínimo: desde el panel.
- Claves del bot (en Supabase → Edge Functions → Secrets, nunca en el repositorio): `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `SITE_URL`.

## Publicar

```bash
npx vercel deploy . --prod
```

Las migraciones se aplican en orden en el proyecto de Supabase y la función del bot se publica como `whatsapp` con verificación JWT desactivada (Meta firma sus llamadas con `WA_APP_SECRET`).
