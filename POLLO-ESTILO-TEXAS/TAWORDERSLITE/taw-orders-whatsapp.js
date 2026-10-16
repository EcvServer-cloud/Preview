/*!
 * TAW Orders Lite V1 — taw-orders-whatsapp.js
 * Construye el mensaje del pedido y el enlace https://wa.me/NUMERO?text=...
 * El número de destino viene en el pedido (order.whatsapp): el de la sucursal
 * elegida para recoger, o el general del negocio.
 * No envía nada: solo prepara el enlace. El cliente debe pulsar «Enviar»
 * dentro de WhatsApp.
 * (c) TAW Sitios Web
 */
(function (window) {
  'use strict';

  var ns = (window.TAWOrders = window.TAWOrders || {});

  // Límite prudente para la longitud de la URL completa.
  var MAX_URL_LENGTH = 6000;

  var FULFILLMENT_LABELS = {
    pickup: 'Recoger en el local',
    delivery: 'Entrega a domicilio'
  };

  function timeGreeting(date) {
    var hour = (date || new Date()).getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  /** Genera el texto del mensaje a partir de un pedido de TAWOrders.Order.buildOrder(). */
  function buildMessage(order, date) {
    var util = ns.util;
    var lines = [];

    function money(cents) { return util.formatMoney(cents, order.business.currency); }
    function addField(label, value) {
      var clean = util.singleLine(value);
      if (clean) lines.push(label + ': ' + clean); // nunca campos vacíos
    }

    var greeting = util.singleLine(order.business.greeting) || 'Hola';
    lines.push(
      '¡' + greeting + '! ' + timeGreeting(date) +
      '. Me gustaría realizar el siguiente pedido en ' + util.singleLine(order.business.name) + ':'
    );
    lines.push('');
    lines.push('*PEDIDO*');
    order.items.forEach(function (item) {
      lines.push(
        '- ' + item.quantity + ' × ' + util.singleLine(item.name) +
        ' (' + money(item.unitCents) + ' c/u) — ' + money(item.lineCents)
      );
    });
    lines.push('');
    lines.push('Subtotal: ' + money(order.subtotalCents));
    if (order.taxRate > 0) {
      lines.push('IVA (' + String(order.taxRate) + '%): ' + money(order.taxCents));
    }
    if (order.fulfillment === 'delivery') {
      lines.push('Entrega: ' + (order.deliveryCents > 0 ? money(order.deliveryCents) : 'Sin costo'));
    }
    lines.push('*TOTAL: ' + money(order.totalCents) + '*');
    lines.push('');
    addField('Nombre', order.customer.name);
    addField('Teléfono', order.customer.phone);
    addField('Modalidad', FULFILLMENT_LABELS[order.fulfillment]);
    if (order.fulfillment === 'pickup' && order.branch) addField('Sucursal', order.branch.name);
    if (order.fulfillment === 'delivery') {
      addField('Dirección', order.address);
      addField('Referencia', order.reference);
    }
    lines.push('');
    lines.push(
      order.fulfillment === 'delivery'
        ? '¿Podrían confirmarme la disponibilidad y el tiempo aproximado de entrega? Gracias.'
        : '¿Podrían confirmarme la disponibilidad y el tiempo aproximado de preparación? Gracias.'
    );

    return lines.join('\n');
  }

  /**
   * Devuelve la URL de WhatsApp lista para abrir, o null si no se puede
   * construir (número inválido o mensaje demasiado largo).
   *
   * Se usa encodeURIComponent (espacio = %20, salto de línea = %0A) en lugar de
   * URLSearchParams, porque este último codifica los espacios como "+", y ese
   * símbolo puede llegar literal al mensaje.
   */
  function buildUrl(order, date) {
    var phone = String(order.whatsapp || '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) return null;
    var url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(buildMessage(order, date));
    return url.length <= MAX_URL_LENGTH ? url : null;
  }

  /** Abre WhatsApp. Debe llamarse desde un manejador de clic del usuario. */
  function open(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  ns.WhatsApp = {
    buildMessage: buildMessage,
    buildUrl: buildUrl,
    open: open
  };
})(window);
