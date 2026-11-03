(() => {
  "use strict";

  const C = window.CONFIG;
  const $ = (sel, el = document) => el.querySelector(sel);
  const db = window.supabase.createClient(C.supabase.url, C.supabase.key);

  const STATUS = {
    pending: "Nuevo",
    confirmed: "Confirmado",
    preparing: "Preparando",
    on_the_way: "En camino",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };
  const ACTIVE = ["pending", "confirmed", "preparing", "on_the_way"];
  // Botón principal de cada estado: [estado siguiente, texto]
  const NEXT = {
    pending: ["preparing", "Aceptar y preparar"],
    confirmed: ["preparing", "Aceptar y preparar"],
    preparing: ["on_the_way", "🛵 Salió a entregar"],
    on_the_way: ["delivered", "✓ Entregado"],
  };

  let orders = [];
  let seenIds = new Set();
  let firstLoad = true;

  // ---------- Utilidades ----------
  const money = (n) => C.currency + Math.round(Number(n)).toLocaleString("es");
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function timeAgo(iso) {
    const min = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (min < 1) return "ahora";
    if (min < 60) return `hace ${min} min`;
    const d = new Date(iso);
    const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString("es")} ${time}`;
  }

  function waNumber(phone) {
    const digits = phone.replace(/\D/g, "");
    return digits.length <= 10 ? C.phoneCountryCode + digits : digits;
  }

  function statusMessage(o) {
    const tpl = C.statusMessages[o.status];
    return tpl && tpl.replace("{code}", o.code).replace("{name}", o.customer_name.split(" ")[0]).replace("{total}", money(o.total));
  }

  let toastTimer;
  function toast(text, bad = false) {
    const el = $("#toast");
    el.textContent = text;
    el.className = "toast" + (bad ? " bad" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // Sonido corto para pedidos nuevos (no necesita archivos)
  function ding() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.4);
      });
    } catch { /* sin audio */ }
  }

  // ---------- Sesión ----------
  async function showForSession(session) {
    if (!session) {
      $("#login-view").hidden = false;
      $("#app-view").hidden = true;
      return;
    }
    const { data: admin } = await db.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
    if (!admin) {
      await db.auth.signOut();
      $("#login-view").hidden = false;
      $("#app-view").hidden = true;
      const err = $("#login-error");
      err.textContent = "Esta cuenta no tiene acceso al panel.";
      err.hidden = false;
      return;
    }
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    await Promise.all([loadOrders(), loadSettings(), loadProducts()]);
    subscribe();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $("#login-error");
    err.hidden = true;
    const btn = f.querySelector("button");
    btn.disabled = true;
    const { data, error } = await db.auth.signInWithPassword({
      email: f.elements.email.value.trim(),
      password: f.elements.password.value,
    });
    btn.disabled = false;
    if (error) {
      err.textContent = "Correo o contraseña incorrectos.";
      err.hidden = false;
      return;
    }
    f.elements.password.value = "";
    showForSession(data.session);
  });

  $("#logout").addEventListener("click", async () => {
    await db.removeAllChannels();
    channel = null;
    await db.auth.signOut();
    showForSession(null);
  });

  // ---------- Pestañas ----------
  document.querySelectorAll("[data-tab]").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== "tab-" + btn.dataset.tab; });
    }));

  // ---------- Pedidos ----------
  async function loadOrders() {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db
      .from("orders")
      .select("*")
      .or(`status.in.(${ACTIVE.join(",")}),created_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return toast("No se pudieron cargar los pedidos.", true);

    const fresh = data.filter((o) => o.status === "pending" && !seenIds.has(o.id));
    if (!firstLoad && fresh.length) {
      ding();
      toast(fresh.length === 1 ? `Nuevo pedido ${fresh[0].code}` : `${fresh.length} pedidos nuevos`);
    }
    const highlight = firstLoad ? new Set() : new Set(fresh.map((o) => o.id));
    data.forEach((o) => seenIds.add(o.id));
    firstLoad = false;
    orders = data;
    renderOrders(highlight);
  }

  // El bot avisa solo cuando el cliente ya escribió por WhatsApp (wa_id).
  // El botón manual queda para cuando no escribió o el aviso automático falló.
  const needsManualNotice = (o) => !o.wa_id || !!o.notify_error;

  function botLine(o) {
    const chat = `<a href="https://wa.me/${waNumber(o.wa_id || o.phone)}" target="_blank" rel="noopener">Escribir al cliente</a>`;
    if (!o.wa_id) {
      return o.status === "pending"
        ? `<p class="bot-line wait">⏳ Esperando que el cliente envíe el WhatsApp del pedido.</p>`
        : "";
    }
    if (o.notify_error) return `<p class="bot-line bad">⚠️ No se pudo avisar al cliente: ${esc(o.notify_error)}. Usa el botón verde.</p>`;
    if (o.status === "pending") return `<p class="bot-line wait">💬 El bot le preguntó al cliente si confirma · ${chat}</p>`;
    if (o.notified_status === o.status) return `<p class="bot-line ok">✓ Cliente avisado por WhatsApp · ${chat}</p>`;
    return `<p class="bot-line wait">Enviando aviso al cliente… · ${chat}</p>`;
  }

  const transferPending = (o) => o.payment === "Transferencia" && !o.payment_confirmed;

  function transferLine(o) {
    if (o.payment !== "Transferencia" || o.status === "cancelled") return "";
    if (o.payment_confirmed) return `<p class="bot-line ok">✓ Transferencia confirmada</p>`;
    return `<p class="bot-line bad">⏳ Transferencia sin confirmar. Revisa tu banco antes de preparar.
      <button class="btn btn-secondary btn-small" type="button" data-pay="${o.id}">Confirmar transferencia</button></p>`;
  }

  function orderCard(o, highlight) {
    const msg = statusMessage(o);
    const next = NEXT[o.status];
    const maps = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
    const pay = o.payment + (o.cash_with ? ` · paga con ${money(o.cash_with)} (cambio ${money(o.cash_with - o.total)})` : "");
    return `
      <article class="order${highlight.has(o.id) ? " is-new" : ""}" data-status="${o.status}">
        <div class="order-head">
          <span class="order-code">#${esc(o.code)}</span>
          <span class="pill" data-status="${o.status}">${STATUS[o.status]}</span>
          <span class="order-time" title="${new Date(o.created_at).toLocaleString("es")}">${timeAgo(o.created_at)}</span>
        </div>
        <p class="order-customer">
          <strong>${esc(o.customer_name)}</strong> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a><br>
          ${esc(o.address)}${o.reference ? ` · <em>${esc(o.reference)}</em>` : ""}<br>
          <a href="${maps}" target="_blank" rel="noopener">📍 Ver ubicación en el mapa</a>
        </p>
        <ul class="order-items">
          ${o.items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.total)}</span></li>`).join("")}
        </ul>
        <div class="order-total"><span>Total (envío ${money(o.delivery_fee)})</span><span>${money(o.total)}</span></div>
        <p class="order-meta">💵 ${esc(pay)}</p>
        ${transferLine(o)}
        ${o.notes ? `<p class="order-notes">📝 ${esc(o.notes)}</p>` : ""}
        ${botLine(o)}
        <div class="order-actions">
          ${next ? `<button class="btn btn-primary" type="button" data-set="${next[0]}" data-id="${o.id}">${next[1]}</button>` : ""}
          ${msg && needsManualNotice(o) ? `<a class="btn btn-whatsapp" target="_blank" rel="noopener"
              href="https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(msg)}">${o.status === "pending" ? "Pedir confirmación" : `Avisar: ${STATUS[o.status]}`}</a>` : ""}
          ${o.status === "pending" && !o.wa_id ? `<button class="btn btn-secondary" type="button" data-set="confirmed" data-id="${o.id}">Cliente confirmó</button>` : ""}
          ${ACTIVE.includes(o.status) ? `<button class="btn btn-ghost" type="button" data-set="cancelled" data-id="${o.id}">Cancelar</button>` : ""}
        </div>
      </article>`;
  }

  function renderOrders(highlight = new Set()) {
    const active = orders.filter((o) => ACTIVE.includes(o.status))
      .sort((a, b) => ACTIVE.indexOf(a.status) - ACTIVE.indexOf(b.status) || new Date(a.created_at) - new Date(b.created_at));
    const history = orders.filter((o) => !ACTIVE.includes(o.status));

    $("#active-count").textContent = active.length;
    document.title = (active.some((o) => o.status === "pending") ? "🔔 " : "") + "Panel · Mayelin Empanadas";

    $("#orders-active").innerHTML = active.length
      ? active.map((o) => orderCard(o, highlight)).join("")
      : `<p class="empty-state">No hay pedidos activos. Los nuevos aparecerán aquí solos, con un sonido.</p>`;
    $("#orders-history").innerHTML = history.length
      ? history.map((o) => orderCard(o, highlight)).join("")
      : `<p class="empty-state">Todavía no hay pedidos terminados esta semana.</p>`;

    const today = new Date().toDateString();
    const deliveredToday = history.filter((o) => o.status === "delivered" && new Date(o.updated_at).toDateString() === today);
    const deliveredWeek = history.filter((o) => o.status === "delivered");
    $("#stats").innerHTML = `
      <div class="stat"><span>Entregados hoy</span><strong>${deliveredToday.length}</strong></div>
      <div class="stat"><span>Vendido hoy</span><strong>${money(deliveredToday.reduce((s, o) => s + Number(o.total), 0))}</strong></div>
      <div class="stat"><span>Vendido en 7 días</span><strong>${money(deliveredWeek.reduce((s, o) => s + Number(o.total), 0))}</strong></div>`;
  }

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-set]");
    if (!btn) return;
    const status = btn.dataset.set;
    const o = orders.find((x) => x.id === btn.dataset.id);
    if (status === "cancelled" && !confirm(`¿Cancelar el pedido #${o.code}?`)) return;
    if (status === "preparing" && transferPending(o) &&
        !confirm(`La transferencia del pedido #${o.code} no está confirmada. ¿Preparar de todos modos?`)) return;
    btn.disabled = true;
    const { data, error } = await db.from("orders").update({ status }).eq("id", o.id).select().single();
    if (error) {
      btn.disabled = false;
      return toast("No se pudo actualizar el pedido.", true);
    }
    Object.assign(o, data);
    renderOrders();
    toast(`#${o.code}: ${STATUS[status]}. Toca "Avisar" para enviarle el mensaje al cliente.`);
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pay]");
    if (!btn) return;
    const o = orders.find((x) => x.id === btn.dataset.pay);
    if (!confirm(`¿Confirmas que recibiste ${money(o.total)} del pedido #${o.code}?`)) return;
    btn.disabled = true;
    const { data, error } = await db.from("orders").update({ payment_confirmed: true }).eq("id", o.id).select().single();
    if (error) {
      btn.disabled = false;
      return toast("No se pudo confirmar la transferencia.", true);
    }
    Object.assign(o, data);
    renderOrders();
    toast(`#${o.code}: transferencia confirmada.`);
  });

  // Tiempo real: cualquier cambio en pedidos recarga la lista
  let reloadTimer;
  let channel = null;
  async function subscribe() {
    if (channel) return;
    // El tiempo real respeta los permisos: necesita la sesión de la administradora
    const { data } = await db.auth.getSession();
    if (data.session) db.realtime.setAuth(data.session.access_token);
    channel = db.channel("orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(loadOrders, 300);
      })
      .subscribe();
  }
  // Respaldo por si se corta la conexión en tiempo real, y para refrescar "hace X min"
  setInterval(() => { if (!$("#app-view").hidden) loadOrders(); }, 60_000);

  // ---------- Ajustes ----------
  async function loadSettings() {
    const { data } = await db.from("settings").select("*").eq("id", 1).single();
    if (!data) return;
    $("#accepting").checked = data.accepting_orders;
    $("#accepting-label").textContent = data.accepting_orders ? "Recibiendo pedidos" : "Pedidos pausados";
    $("#set-fee").value = Number(data.delivery_fee);
    $("#set-min").value = data.min_order_units;
  }

  async function saveSettings(patch, okText) {
    const { error } = await db.from("settings").update(patch).eq("id", 1);
    if (error) { toast("No se pudo guardar.", true); return loadSettings(); }
    toast(okText);
    loadSettings();
  }

  $("#accepting").addEventListener("change", (e) =>
    saveSettings({ accepting_orders: e.target.checked },
      e.target.checked ? "La página vuelve a recibir pedidos." : "Pedidos pausados: la página no acepta pedidos nuevos."));
  $("#set-fee").addEventListener("change", (e) =>
    saveSettings({ delivery_fee: Math.max(0, Number(e.target.value) || 0) }, "Costo de envío guardado."));
  $("#set-min").addEventListener("change", (e) =>
    saveSettings({ min_order_units: Math.max(0, parseInt(e.target.value, 10) || 0) }, "Pedido mínimo guardado."));

  // ---------- Menú ----------
  let products = [];

  async function loadProducts() {
    const [{ data: cats }, { data: prods }] = await Promise.all([
      db.from("categories").select("*").order("position"),
      db.from("products").select("*").order("position"),
    ]);
    products = prods || [];
    $("#products").innerHTML = (cats || []).map((c) => `
      <section class="products-cat">
        <h2>${esc(c.name)}</h2>
        ${products.filter((p) => p.category_id === c.id).map((p) => `
          <div class="product-row">
            <label class="thumb${p.image_url ? "" : " is-empty"}" title="${p.image_url ? "Cambiar foto" : "Agregar foto"}">
              ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" width="64" height="64">` : `<span>Agregar foto</span>`}
              <input type="file" accept="image/*" data-photo="${esc(p.id)}" aria-label="Foto de ${esc(p.name)}">
            </label>
            <span class="name">${esc(p.name)}<small>${esc(p.description)}</small>
              ${p.image_url ? `<button class="link-btn" type="button" data-unphoto="${esc(p.id)}">Quitar foto</button>` : ""}
            </span>
            <input type="number" min="0" step="1" value="${Number(p.price)}" data-price="${esc(p.id)}" aria-label="Precio de ${esc(p.name)}">
            <label class="switch" title="Disponible">
              <input type="checkbox" data-available="${esc(p.id)}" ${p.available ? "checked" : ""}>
              <span class="switch-track"></span>
            </label>
          </div>`).join("")}
      </section>`).join("");
  }

  // ---------- Fotos de productos ----------
  const PHOTO_BUCKET = "product-images";
  const PHOTO_MAX_PX = 900;

  // Achica la foto en el navegador: las del celular pesan varios MB y la página solo necesita unos 900 px
  async function shrinkPhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
    const webp = await toBlob("image/webp", 0.82);
    // Safari viejo no genera WebP y devuelve PNG: en ese caso usamos JPEG
    return webp && webp.type === "image/webp" ? webp : toBlob("image/jpeg", 0.85);
  }

  function photoPath(url) {
    const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
    const i = url ? url.indexOf(marker) : -1;
    return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
  }

  async function savePhoto(input) {
    const file = input.files[0];
    const p = products.find((x) => x.id === input.dataset.photo);
    if (!file || !p) return;
    if (!file.type.startsWith("image/")) return toast("Elige una imagen (foto JPG, PNG o WebP).", true);
    const thumb = input.closest(".thumb");
    thumb.classList.add("is-busy");
    try {
      const blob = await shrinkPhoto(file);
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${p.id}/${Date.now()}.${ext}`;
      const up = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
      if (up.error) throw up.error;
      const url = db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await db.from("products").update({ image_url: url }).eq("id", p.id);
      if (error) {
        await db.storage.from(PHOTO_BUCKET).remove([path]);
        throw error;
      }
      const old = photoPath(p.image_url);
      if (old) await db.storage.from(PHOTO_BUCKET).remove([old]);
      toast(`Foto de ${p.name} guardada.`);
    } catch {
      toast("No se pudo guardar la foto. Prueba con otra imagen.", true);
    }
    loadProducts();
  }

  $("#products").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-unphoto]");
    if (!btn) return;
    const p = products.find((x) => x.id === btn.dataset.unphoto);
    if (!p || !confirm(`¿Quitar la foto de ${p.name}?`)) return;
    btn.disabled = true;
    const { error } = await db.from("products").update({ image_url: null }).eq("id", p.id);
    if (error) { btn.disabled = false; return toast("No se pudo quitar la foto.", true); }
    const old = photoPath(p.image_url);
    if (old) await db.storage.from(PHOTO_BUCKET).remove([old]);
    toast(`Foto de ${p.name} quitada.`);
    loadProducts();
  });

  $("#products").addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.photo) return savePhoto(t);
    let patch, id, okText;
    if (t.dataset.price) {
      id = t.dataset.price;
      patch = { price: Math.max(0, Number(t.value) || 0) };
      okText = "Precio guardado.";
    } else if (t.dataset.available) {
      id = t.dataset.available;
      patch = { available: t.checked };
      okText = t.checked ? "Producto disponible otra vez." : "Producto marcado como agotado.";
    } else return;
    const { error } = await db.from("products").update(patch).eq("id", id);
    if (error) { toast("No se pudo guardar.", true); return loadProducts(); }
    toast(okText);
  });

  // ---------- Eliminación de datos ----------
  $("#delete-data-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.target.elements.phone;
    const phone = input.value.trim();
    if (phone.replace(/\D/g, "").length < 8) return toast("Escribe el teléfono completo.", true);
    if (!confirm(`¿Eliminar los datos del cliente ${phone}? No se puede deshacer.`)) return;
    const { data, error } = await db.rpc("delete_customer_data", { p_phone: phone });
    if (error) return toast("No se pudieron eliminar los datos.", true);
    input.value = "";
    loadOrders();
    toast(data.active
      ? `Eliminados ${data.orders} pedidos terminados. Hay ${data.active} en curso: repítelo cuando terminen.`
      : `Listo: ${data.orders} pedidos y ${data.messages} mensajes eliminados. Avísale al cliente.`);
  });

  // ---------- Inicio ----------
  db.auth.getSession().then(({ data }) => showForSession(data.session));
})();
