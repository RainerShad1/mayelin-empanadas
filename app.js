(() => {
  "use strict";

  const C = window.CONFIG;
  const $ = (sel, el = document) => el.querySelector(sel);
  const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const CART_KEY = "mayelin-cart";
  const CUSTOMER_KEY = "mayelin-customer";

  // Se llenan desde la base de datos al cargar
  let menu = [];      // [{ id, name, items: [product] }]
  let byId = {};
  let settings = null; // { delivery_fee, min_order_units, accepting_orders }

  // ---------- Utilidades ----------
  const money = (n) => C.currency + Math.round(Number(n)).toLocaleString("es");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function readStore(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento: seguimos igual */ }
  }

  // ---------- Base de datos ----------
  async function api(path, options = {}) {
    const res = await fetch(`${C.supabase.url}/rest/v1/${path}`, {
      ...options,
      headers: { apikey: C.supabase.key, "Content-Type": "application/json", ...options.headers },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message || `Error ${res.status}`);
    return body;
  }

  async function loadMenu() {
    const [cats, prods, sets] = await Promise.all([
      api("categories?select=id,name&order=position"),
      api("products?select=*&order=position"),
      api("settings?select=delivery_fee,min_order_units,accepting_orders&id=eq.1"),
    ]);
    settings = sets[0];
    settings.delivery_fee = Number(settings.delivery_fee);
    for (const p of prods) p.price = Number(p.price);
    byId = Object.fromEntries(prods.map((p) => [p.id, p]));
    menu = cats
      .map((c) => ({ ...c, items: prods.filter((p) => p.category_id === c.id) }))
      .filter((c) => c.items.length);
  }

  const ORDER_ERRORS = {
    not_accepting: "En este momento no estamos recibiendo pedidos.",
    below_minimum: "Tu pedido no llega al mínimo de empanadas.",
    invalid_name: "Revisa tu nombre.",
    invalid_phone: "Revisa tu número de teléfono.",
    invalid_address: "Revisa tu dirección.",
    invalid_location: "Marca tu ubicación en el mapa.",
    invalid_payment: "Elige una forma de pago.",
    invalid_items: "Hay un problema con tu pedido. Recarga la página e inténtalo de nuevo.",
  };
  function orderErrorText(message) {
    if (message.startsWith("product_unavailable:")) {
      const p = byId[message.split(":")[1]];
      return `${p ? p.name : "Un producto"} ya no está disponible. Quítalo del pedido para continuar.`;
    }
    return ORDER_ERRORS[message] || "No pudimos guardar tu pedido. Revisa tu conexión e inténtalo de nuevo.";
  }

  // ---------- Carrito ----------
  const cart = readStore(CART_KEY, {});

  function setQty(id, qty) {
    if (qty > 0 && byId[id]?.available) cart[id] = Math.min(qty, 99);
    else if (qty <= 0) delete cart[id];
    writeStore(CART_KEY, cart);
    renderItem(id);
    renderCart();
  }

  function summary() {
    const lines = Object.entries(cart)
      .filter(([id]) => byId[id])
      .map(([id, qty]) => ({ p: byId[id], qty, total: byId[id].price * qty }));
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const units = lines.reduce((s, l) => s + l.p.units * l.qty, 0);
    const count = lines.reduce((s, l) => s + l.qty, 0);
    const fee = lines.length && settings ? settings.delivery_fee : 0;
    return { lines, subtotal, units, count, fee, total: subtotal + fee };
  }

  // ---------- Horario ----------
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  function openStatus(now = new Date()) {
    if (settings && !settings.accepting_orders) return { open: false, text: "No estamos recibiendo pedidos ahora" };
    if (C.alwaysOpenForTesting) return { open: true, text: "Abierto" };
    const day = now.getDay();
    const cur = now.getHours() * 60 + now.getMinutes();
    const today = C.hours[day];
    if (today && cur >= toMin(today[0]) && cur < toMin(today[1])) {
      return { open: true, text: `Abierto · cierra a las ${today[1]}` };
    }
    for (let i = 0; i < 7; i++) {
      const d = (day + i) % 7;
      const h = C.hours[d];
      if (!h || (i === 0 && cur >= toMin(h[0]))) continue;
      const when = i === 0 ? "hoy" : i === 1 ? "mañana" : `el ${DAYS[d]}`;
      return { open: false, text: `Cerrado · abrimos ${when} a las ${h[0]}` };
    }
    return { open: false, text: "Cerrado por ahora" };
  }

  // ---------- Render: cabecera y menú ----------
  function renderHeader() {
    const st = openStatus();
    const el = $("#status");
    el.textContent = st.text;
    el.className = "status " + (st.open ? "open" : "closed");
    if (settings) {
      $("#fact-delivery").textContent = `🛵 Envío ${settings.delivery_fee ? money(settings.delivery_fee) : "gratis"}${C.deliveryNote ? ` (${C.deliveryNote})` : ""}`;
      $("#fact-min").textContent = `🥟 Pedido mínimo: ${settings.min_order_units} empanadas`;
    }
    $("#owner").textContent = C.owner;
    $("#hours-list").textContent = [1, 2, 3, 4, 5, 6, 0]
      .map((d) => `${DAYS[d][0].toUpperCase() + DAYS[d].slice(1)}: ${C.hours[d] ? C.hours[d].join("–") : "cerrado"}`)
      .join(" · ");
  }

  function stepperHtml(id) {
    if (!byId[id].available) return `<span class="soldout">Agotado</span>`;
    const qty = cart[id] || 0;
    if (!qty) return `<button class="btn btn-primary btn-add" type="button" data-act="inc" data-id="${id}">Agregar</button>`;
    return `<div class="stepper">
      <button type="button" data-act="dec" data-id="${id}" aria-label="Quitar uno">−</button>
      <span aria-live="polite">${qty}</span>
      <button type="button" data-act="inc" data-id="${id}" aria-label="Agregar uno">+</button>
    </div>`;
  }

  function renderMenu() {
    $("#tabs").innerHTML = menu.map((c) => `<a href="#cat-${esc(c.id)}">${esc(c.name)}</a>`).join("");
    $("#menu").innerHTML = menu.map((c) => `
      <section class="cat" id="cat-${esc(c.id)}">
        <h2>${esc(c.name)}</h2>
        <div class="grid">
          ${c.items.map((p) => `
            <article class="item${p.available ? "" : " is-soldout"}">
              ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : ""}
              <div class="item-body">
                <h3>${esc(p.name)}</h3>
                <p>${esc(p.description || "")}</p>
                <div class="item-foot">
                  <span class="price">${money(p.price)}</span>
                  <span class="slot" data-slot="${esc(p.id)}">${stepperHtml(p.id)}</span>
                </div>
              </div>
            </article>`).join("")}
        </div>
      </section>`).join("");
  }

  function renderItem(id) {
    const slot = document.querySelector(`[data-slot="${CSS.escape(id)}"]`);
    if (slot) slot.innerHTML = stepperHtml(id);
  }

  // ---------- Render: carrito ----------
  function renderCart() {
    const s = summary();
    const bar = $("#cartbar");
    bar.hidden = s.count === 0;
    $("#cart-count").textContent = s.count;
    $("#cart-total").textContent = money(s.subtotal);

    $("#lines").innerHTML = s.lines.length
      ? s.lines.map((l) => `
          <li>
            <span class="line-name">${esc(l.p.name)}<small>${l.p.available ? `${money(l.p.price)} c/u` : "Agotado: quítalo del pedido"}</small></span>
            <div class="stepper">
              <button type="button" data-act="dec" data-id="${esc(l.p.id)}" aria-label="Quitar uno">−</button>
              <span>${l.qty}</span>
              <button type="button" data-act="inc" data-id="${esc(l.p.id)}" aria-label="Agregar uno">+</button>
            </div>
            <span class="line-price">${money(l.total)}</span>
          </li>`).join("")
      : `<li class="empty">Tu pedido está vacío. ¡Agrega unas empanadas!</li>`;

    $("#t-sub").textContent = money(s.subtotal);
    $("#t-fee").textContent = s.fee ? money(s.fee) : "Gratis";
    $("#t-total").textContent = money(s.total);

    const warn = $("#min-warning");
    const missing = settings ? settings.min_order_units - s.units : 0;
    warn.hidden = !(s.lines.length && missing > 0);
    warn.textContent = `El pedido mínimo es de ${settings?.min_order_units} empanadas. Te faltan ${missing}.`;
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    setQty(id, (cart[id] || 0) + (btn.dataset.act === "inc" ? 1 : -1));
  });

  // ---------- Hoja de pedido ----------
  const sheet = $("#sheet");

  function openSheet() {
    $("#checkout").hidden = false;
    $("#done").hidden = true;
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    initMap();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = "";
  }
  $("#cartbar").addEventListener("click", openSheet);
  sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  // ---------- Mapa y ubicación ----------
  let map = null;
  let marker = null;
  let pin = null; // { lat, lng }

  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function outOfZone() {
    if (!pin || !C.store.location) return false;
    return distanceKm(C.store.location, [pin.lat, pin.lng]) > C.store.deliveryRadiusKm;
  }

  function setPin(lat, lng, source) {
    pin = { lat, lng };
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng(); setPin(p.lat, p.lng, "drag"); });
    } else {
      marker.setLatLng([lat, lng]);
    }
    $("#map").classList.remove("invalid");
    const status = $("#loc-status");
    if (outOfZone()) {
      status.className = "hint bad";
      status.textContent = `Esta ubicación está fuera de nuestra zona de entrega (${C.store.deliveryRadiusKm} km).`;
    } else {
      status.className = "hint ok";
      status.textContent = source === "gps"
        ? "✓ Ubicación encontrada. Si no es exacta, arrastra el pin hasta tu puerta."
        : "✓ Ubicación marcada.";
    }
  }

  function initMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
    if (!window.L) {
      $("#loc-status").textContent = "No se pudo cargar el mapa. Escribe tu dirección con detalle.";
      return;
    }
    map = L.map("map").setView(C.mapStart.center, C.mapStart.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    if (C.store.location) {
      L.circle(C.store.location, {
        radius: C.store.deliveryRadiusKm * 1000, color: "#e0761c", weight: 1, fillOpacity: 0.06,
      }).addTo(map);
    }
    map.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng, "tap"));
    setTimeout(() => map.invalidateSize(), 50);
  }

  $("#locate").addEventListener("click", () => {
    const status = $("#loc-status");
    if (!navigator.geolocation) {
      status.className = "hint bad";
      status.textContent = "Tu navegador no permite obtener la ubicación. Márcala tocando el mapa.";
      return;
    }
    status.className = "hint";
    status.textContent = "Buscando tu ubicación…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 17);
        setPin(latitude, longitude, "gps");
      },
      () => {
        status.className = "hint bad";
        status.textContent = "No pudimos obtener tu ubicación. Márcala tocando el mapa.";
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });

  // ---------- Formulario ----------
  const form = $("#order-form");
  const saved = readStore(CUSTOMER_KEY, {});
  for (const k of ["name", "phone", "address", "reference"]) if (saved[k]) form.elements[k].value = saved[k];

  function syncPayment() {
    $("#cash-field").hidden = form.elements.payment.value !== "Efectivo";
    $("#transfer-note").hidden = form.elements.payment.value !== "Transferencia";
  }
  form.addEventListener("change", syncPayment);
  syncPayment();

  // El mensaje usa lo que devolvió la base de datos (precios y total reales).
  function buildMessage(order, data) {
    const lines = [
      `¡Hola, ${C.businessName}! Quiero hacer un pedido 🥟`,
      `*Pedido #${order.code}*`,
      "",
      ...order.items.map((l) => `• ${l.qty} x ${l.name}: ${money(l.total)}`),
      "",
      `Subtotal: ${money(order.subtotal)}`,
      `Envío: ${Number(order.delivery_fee) ? money(order.delivery_fee) : "Gratis"}`,
      `*Total: ${money(order.total)}*`,
      "",
      `👤 ${data.name}`,
      `📞 ${data.phone}`,
      `🏠 ${data.address}`,
    ];
    if (data.reference) lines.push(`📌 Referencia: ${data.reference}`);
    lines.push(`📍 Ubicación: https://maps.google.com/?q=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`);
    let pay = `💵 Pago: ${data.payment}`;
    if (data.payment === "Efectivo" && Number(data.cash) > 0) pay += ` (paga con ${money(Number(data.cash))})`;
    lines.push(pay);
    if (data.notes) lines.push(`📝 Notas: ${data.notes}`);
    return lines.join("\n");
  }

  function fail(msg, field) {
    const el = $("#form-error");
    el.textContent = msg;
    el.hidden = false;
    if (field) {
      field.classList.add("invalid");
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      if (field.focus) field.focus({ preventScroll: true });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  form.addEventListener("input", (e) => e.target.classList.remove("invalid"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#form-error").hidden = true;
    const s = summary();
    const data = Object.fromEntries(new FormData(form));
    for (const k of Object.keys(data)) data[k] = String(data[k]).trim();

    if (!s.lines.length) return fail("Tu pedido está vacío.");
    const soldOut = s.lines.find((l) => !l.p.available);
    if (soldOut) return fail(`${soldOut.p.name} está agotado. Quítalo del pedido para continuar.`);
    if (s.units < settings.min_order_units) return fail(`El pedido mínimo es de ${settings.min_order_units} empanadas.`);
    const st = openStatus();
    if (!settings.accepting_orders || (!st.open && !C.acceptOrdersWhenClosed)) return fail(st.text + ".");
    if (!data.name) return fail("Escribe tu nombre.", form.elements.name);
    if (data.phone.replace(/\D/g, "").length < 7) return fail("Escribe un teléfono válido.", form.elements.phone);
    if (!pin) return fail("Marca tu ubicación en el mapa para que el delivery llegue a tu puerta.", $("#map"));
    if (outOfZone()) return fail("Tu ubicación está fuera de nuestra zona de entrega.", $("#map"));
    if (!data.address) return fail("Escribe tu dirección.", form.elements.address);
    if (data.payment === "Efectivo" && Number(data.cash) > 0 && Number(data.cash) < s.total) {
      return fail(`Con ${money(Number(data.cash))} no alcanza para el total de ${money(s.total)}.`, form.elements.cash);
    }
    if (!/^\d{8,15}$/.test(C.whatsapp)) {
      return fail("El negocio aún no configuró su número de WhatsApp (config.js → whatsapp).");
    }

    // Abrimos la pestaña ya, durante el toque del usuario, para que el navegador no la bloquee.
    const tab = window.open("", "_blank");
    const sendBtn = $("#send");
    sendBtn.disabled = true;
    sendBtn.textContent = "Guardando pedido…";

    let order;
    try {
      order = await api("rpc/create_order", {
        method: "POST",
        body: JSON.stringify({
          p: {
            items: s.lines.map((l) => ({ id: l.p.id, qty: l.qty })),
            name: data.name, phone: data.phone, address: data.address, reference: data.reference,
            lat: pin.lat, lng: pin.lng, payment: data.payment,
            cash: data.payment === "Efectivo" && Number(data.cash) > 0 ? Number(data.cash) : null,
            notes: data.notes,
          },
        }),
      });
    } catch (err) {
      if (tab) tab.close();
      if (err.message.startsWith("product_unavailable:") || err.message === "not_accepting") {
        loadMenu().then(() => { renderHeader(); renderMenu(); renderCart(); }).catch(() => {});
      }
      return fail(orderErrorText(err.message));
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Enviar pedido por WhatsApp";
    }

    writeStore(CUSTOMER_KEY, { name: data.name, phone: data.phone, address: data.address, reference: data.reference });

    const url = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(buildMessage(order, data))}`;
    if (tab) tab.location.href = url;
    else window.location.href = url;

    for (const id of Object.keys(cart)) delete cart[id];
    writeStore(CART_KEY, cart);
    Object.keys(byId).forEach(renderItem);
    renderCart();
    form.elements.notes.value = "";
    form.elements.cash.value = "";

    $("#done-code").textContent = "#" + order.code;
    $("#done-link").href = url;
    $("#checkout").hidden = true;
    $("#done").hidden = false;
  });

  // ---------- Inicio ----------
  renderHeader();
  $("#menu").innerHTML = `<p class="loading">Cargando menú…</p>`;
  loadMenu()
    .then(() => {
      for (const id of Object.keys(cart)) if (!byId[id] || !(cart[id] > 0)) delete cart[id];
      writeStore(CART_KEY, cart);
      renderHeader();
      renderMenu();
      renderCart();
    })
    .catch(() => {
      $("#menu").innerHTML = `<p class="loading">No pudimos cargar el menú. Revisa tu conexión y
        <a href="">recarga la página</a>.</p>`;
    });
  setInterval(renderHeader, 60_000);
})();
