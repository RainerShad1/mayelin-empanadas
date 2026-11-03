// Service worker mínimo: hace que la página se pueda instalar como app.
// No guarda copias de la página, así el menú, los precios y el horario siempre son los del momento.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Sin conexión · Mayelin Empanadas</title>
      <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fbf3e6;color:#3f1f12;font-family:system-ui,sans-serif;text-align:center;padding:24px">
      <div><h1 style="font-size:1.4rem">Sin conexión</h1><p>Revisa tu internet y vuelve a abrir la app para hacer tu pedido.</p></div>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    )),
  );
});
