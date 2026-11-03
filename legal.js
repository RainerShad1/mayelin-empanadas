// Muestra el WhatsApp del negocio en las páginas legales
(() => {
  const C = window.CONFIG || {};
  const number = C.contactWhatsapp || C.whatsapp;
  if (!number) return;
  document.querySelectorAll(".legal-contact").forEach((el) => {
    el.innerHTML = ` al <a href="https://wa.me/${number}">+${number}</a>`;
  });
})();
