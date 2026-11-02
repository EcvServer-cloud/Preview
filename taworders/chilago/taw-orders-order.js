/*!
 * TAW Orders Lite — taw-orders-order.js
 * Finalización del pedido: formulario «Tus datos», modalidades (recoger, domicilio,
 * mesa), validación, IVA, entrega, total y objeto de pedido estructurado.
 * Los datos del cliente solo viven en memoria mientras la página está abierta.
 * (c) TAW Sitios Web
 */
(function (window, document) {
  'use strict';

  var ns = (window.TAWOrders = window.TAWOrders || {});

  var MAX_NAME = 60;
  var MAX_ADDRESS = 200;
  var MAX_REFERENCE = 200;
  var UNLOCK_DELAY_MS = 4000;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var METHOD_LABELS = { pickup: 'Recoger', delivery: 'A domicilio', dinein: 'Mesa' };

  /* Las utilidades viven en taw-orders-lite.js; se leen al usarlas. */
  function el(tag, props, children) { return ns.util.el(tag, props, children); }
  function clear(node) { ns.util.clear(node); }
  function singleLine(text) { return ns.util.singleLine(text); }
  function toCents(amount) { return ns.util.toCents(amount); }

  /* ----------------------------- Lógica pura ----------------------------- */

  function methodsOf(settings) {
    var methods = [];
    if (settings.pickup) methods.push('pickup');
    if (settings.delivery) methods.push('delivery');
    if (settings.dineIn) methods.push('dinein');
    return methods;
  }

  /** Recoger y Mesa se atienden en una sucursal; a domicilio no. */
  function needsBranch(method) { return method === 'pickup' || method === 'dinein'; }

  /** Subtotal + IVA (sobre el subtotal) + entrega (solo a domicilio). */
  function calculateTotals(subtotalCents, config, fulfillment) {
    var taxCents = Math.round(subtotalCents * config.business.taxRate / 100);
    var deliveryCents = fulfillment === 'delivery' ? toCents(config.orderSettings.deliveryFee) : 0;
    return { subtotalCents: subtotalCents, taxCents: taxCents, deliveryCents: deliveryCents, totalCents: subtotalCents + taxCents + deliveryCents };
  }

  function minimumShortfall(subtotalCents, config) {
    return Math.max(0, toCents(config.orderSettings.minimumOrder) - subtotalCents);
  }

  function findBranch(config, id) {
    var branches = config.business.branches;
    for (var i = 0; i < branches.length; i += 1) if (branches[i].id === id) return branches[i];
    return null;
  }

  /** Valida y limpia los datos del cliente. */
  function validateCustomer(values, config) {
    var settings = config.orderSettings;
    var errors = {};
    var clean = {};
    var fulfillment = values.fulfillment;

    var name = singleLine(values.name);
    if (name.length < 2) errors.name = 'Escribe tu nombre.';
    else if (name.length > MAX_NAME) errors.name = 'Usa un nombre de máximo ' + MAX_NAME + ' caracteres.';
    clean.name = name;

    var enabled = (fulfillment === 'pickup' && settings.pickup) || (fulfillment === 'delivery' && settings.delivery) ||
      (fulfillment === 'dinein' && settings.dineIn);
    if (enabled) clean.fulfillment = fulfillment;
    else errors.fulfillment = 'Elige cómo quieres recibir tu pedido.';

    // En mesa no se pide teléfono: basta el nombre y el número de mesa.
    var phoneText = singleLine(values.phone);
    var phoneDigits = phoneText.replace(/\D/g, '');
    if (clean.fulfillment === 'dinein') {
      clean.phone = '';
    } else {
      if (!phoneText) errors.phone = 'Escribe tu teléfono para que el restaurante pueda contactarte.';
      else if (!/^[0-9+()\-.\s]+$/.test(phoneText) || phoneDigits.length < 10 || phoneDigits.length > 15) errors.phone = 'Escribe un teléfono válido de 10 dígitos.';
      clean.phone = phoneDigits;
    }

    if (clean.fulfillment === 'dinein') {
      var table = singleLine(values.table);
      if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{0,9}$/.test(table)) errors.table = 'Escribe el número de tu mesa.';
      clean.table = table;
    }

    if (needsBranch(clean.fulfillment) && config.business.branches.length) {
      var branch = findBranch(config, values.branch);
      if (branch) clean.branch = branch;
      else errors.branch = clean.fulfillment === 'dinein' ? 'Elige la sucursal donde estás.' : 'Elige la sucursal donde recogerás tu pedido.';
    }

    if (clean.fulfillment === 'delivery') {
      var address = singleLine(values.address);
      if (address.length < 5) errors.address = 'Escribe la calle y el número para la entrega.';
      else if (address.length > MAX_ADDRESS) errors.address = 'La dirección es demasiado larga (máximo ' + MAX_ADDRESS + ' caracteres).';
      clean.address = address;
      var reference = singleLine(values.reference);
      if (reference.length > MAX_REFERENCE) errors.reference = 'La referencia es demasiado larga (máximo ' + MAX_REFERENCE + ' caracteres).';
      clean.reference = reference;
    }

    return { valid: Object.keys(errors).length === 0, errors: errors, clean: clean };
  }

  /**
   * Genera el pedido estructurado. Precios, IVA y totales salen del JSON validado,
   * nunca del DOM. El WhatsApp de destino es el de la sucursal (recoger o mesa)
   * o el general del negocio (domicilio).
   */
  function buildOrder(config, lines, customer) {
    var items = lines.map(function (line) {
      return {
        id: line.product.id,
        name: line.product.name,
        unitCents: line.unitCents,
        quantity: line.quantity,
        lineCents: line.lineCents,
        ingredients: line.ingredients.map(function (ing) { return { name: ing.name, priceCents: ing.priceCents, group: ing.groupName }; }),
        removed: line.removed.map(function (ing) { return ing.name; }),
        note: line.note || ''
      };
    });
    var subtotalCents = items.reduce(function (sum, item) { return sum + item.lineCents; }, 0);
    var totals = calculateTotals(subtotalCents, config, customer.fulfillment);
    var isDelivery = customer.fulfillment === 'delivery';
    var branch = customer.branch || null;

    return {
      business: { id: config.business.id, name: config.business.name, currency: config.business.currency, greeting: config.business.greeting },
      whatsapp: branch ? branch.whatsapp : config.business.whatsapp,
      branch: branch ? { id: branch.id, name: branch.name } : null,
      items: items,
      subtotalCents: totals.subtotalCents,
      taxRate: config.business.taxRate,
      taxCents: totals.taxCents,
      deliveryCents: totals.deliveryCents,
      totalCents: totals.totalCents,
      customer: { name: customer.name, phone: customer.phone },
      fulfillment: customer.fulfillment,
      table: customer.fulfillment === 'dinein' ? customer.table : '',
      address: isDelivery ? customer.address : '',
      reference: isDelivery ? customer.reference : ''
    };
  }

  /* ------------------------------ Interfaz ------------------------------- */

  function whatsappIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    [['viewBox', '0 0 32 32'], ['width', '26'], ['height', '26'], ['aria-hidden', 'true'], ['focusable', 'false']].forEach(function (a) { svg.setAttribute(a[0], a[1]); });
    var bubble = document.createElementNS(SVG_NS, 'path');
    bubble.setAttribute('d', 'M16 3C8.8 3 3 8.7 3 15.8c0 2.4.7 4.7 1.9 6.7L3 29l6.7-1.8A13 13 0 0 0 16 28.6c7.2 0 13-5.7 13-12.8S23.2 3 16 3z');
    bubble.setAttribute('fill', 'none');
    bubble.setAttribute('stroke', 'currentColor');
    bubble.setAttribute('stroke-width', '2.4');
    bubble.setAttribute('stroke-linejoin', 'round');
    var phone = document.createElementNS(SVG_NS, 'path');
    phone.setAttribute('d', 'M11.6 9.5c.4-.5 1.2-.5 1.5.1l1.1 2.3c.2.4.1.8-.2 1.1l-.8.8c.9 1.8 2.3 3.2 4.1 4.1l.9-.9c.3-.3.7-.4 1.1-.2l2.3 1.1c.6.3.6 1.1.1 1.5-1 1-2.3 1.4-3.6 1-3.8-1.1-6.7-4.1-7.8-7.8-.3-1.3.1-2.6 1.3-3.1z');
    phone.setAttribute('fill', 'currentColor');
    svg.appendChild(bubble);
    svg.appendChild(phone);
    return svg;
  }

  /**
   * Flujo de finalización dentro del panel «Tu pedido».
   * @param {Object}   options.config         Configuración validada.
   * @param {Object}   options.cart           Carrito de TAWOrders.createCart().
   * @param {string}   options.idPrefix       Prefijo único para ids del DOM.
   * @param {Function} options.onStateChange  Se llama al abrir/cerrar o cambiar la modalidad.
   */
  function createCheckout(options) {
    var config = options.config;
    var cart = options.cart;
    var settings = config.orderSettings;
    var branches = config.business.branches;
    var prefix = options.idPrefix + '-co';
    var methods = methodsOf(settings);

    function defaultValues() {
      return {
        name: '', phone: '', table: '', fulfillment: methods[0],
        branch: branches.length === 1 ? branches[0].id : '', address: '', reference: ''
      };
    }

    var values = defaultValues(); // solo en memoria; nunca se guarda en storage
    var step = 'idle'; // idle | form
    var locked = false;
    var lockTimer = null;
    var container = el('div', { 'class': 'tawo-checkout', hidden: true });

    function notify() { if (typeof options.onStateChange === 'function') options.onStateChange(); }

    function unlockWhatsApp() {
      window.clearTimeout(lockTimer);
      lockTimer = null;
      locked = false;
    }

    function canContinue() {
      return !cart.isEmpty() && minimumShortfall(cart.getSubtotalCents(), config) === 0;
    }

    function renderForm() {
      unlockWhatsApp();
      clear(container);
      var registry = {}; // key -> { control, error, focusTarget? }

      function setError(key, message) {
        var entry = registry[key];
        if (!entry) return;
        entry.error.textContent = message || '';
        entry.error.hidden = !message;
        if (message) entry.control.setAttribute('aria-invalid', 'true');
        else entry.control.removeAttribute('aria-invalid');
      }

      function field(key, label, control) {
        var errorId = prefix + '-' + key + '-error';
        control.setAttribute('aria-describedby', errorId);
        var error = el('p', { 'class': 'tawo-field-error', id: errorId, hidden: true });
        registry[key] = { control: control, error: error };
        return el('div', { 'class': 'tawo-field' }, [
          el('label', { 'class': 'tawo-label', 'for': control.id, text: label }),
          control,
          error
        ]);
      }

      function textInput(key, label, placeholder, extra) {
        var props = { 'class': 'tawo-input', id: prefix + '-' + key, name: key, type: 'text', placeholder: placeholder };
        Object.keys(extra || {}).forEach(function (prop) { props[prop] = extra[prop]; });
        var input = el('input', props);
        input.value = values[key];
        input.addEventListener('input', function () {
          values[key] = input.value;
          setError(key, '');
        });
        return field(key, label, input);
      }

      var nameField = textInput('name', 'Nombre', 'Tu nombre', { autocomplete: 'name', maxlength: MAX_NAME, required: true });
      var phoneField = textInput('phone', 'Teléfono', '10 dígitos', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: 20, required: true });
      var tableField = settings.dineIn ? textInput('table', 'Número de mesa', 'Ej. 5', { maxlength: 10, autocomplete: 'off', required: true }) : null;

      var branchField = null;
      if (branches.length && (settings.pickup || settings.dineIn)) {
        if (branches.length > 1) {
          var select = el('select', { 'class': 'tawo-input tawo-select', id: prefix + '-branch', name: 'branch' });
          select.appendChild(el('option', { value: '', text: 'Seleccionar sucursal' }));
          branches.forEach(function (branch) { select.appendChild(el('option', { value: branch.id, text: branch.name })); });
          select.value = values.branch;
          select.addEventListener('change', function () { values.branch = select.value; setError('branch', ''); });
          branchField = field('branch', 'Sucursal', select);
        } else {
          branchField = el('p', { 'class': 'tawo-fixed', text: 'Sucursal: ' + branches[0].name });
        }
      }

      var addressField = settings.delivery ? el('div', { 'class': 'tawo-stack' }, [
        textInput('address', 'Dirección de entrega', 'Calle, número, colonia, ciudad', { autocomplete: 'address-line1', maxlength: MAX_ADDRESS }),
        textInput('reference', 'Referencias (opcional)', 'Ej. casa con portón negro', { maxlength: MAX_REFERENCE })
      ]) : null;

      function sync() {
        var method = values.fulfillment;
        phoneField.hidden = method === 'dinein';
        if (tableField) tableField.hidden = method !== 'dinein';
        if (branchField) branchField.hidden = !needsBranch(method);
        if (addressField) addressField.hidden = method !== 'delivery';
      }

      /* Modalidad: solo las habilitadas en el JSON. */
      var methodBlock;
      if (methods.length > 1) {
        var methodError = el('p', { 'class': 'tawo-field-error', id: prefix + '-fulfillment-error', hidden: true });
        var segments = el('div', { 'class': 'tawo-segments' });
        var firstRadio = null;
        methods.forEach(function (method) {
          var radioId = prefix + '-f-' + method;
          var radio = el('input', { 'class': 'tawo-seg-input', type: 'radio', id: radioId, name: prefix + '-fulfillment', value: method });
          radio.checked = values.fulfillment === method;
          radio.addEventListener('change', function () {
            if (!radio.checked) return;
            values.fulfillment = method;
            setError('fulfillment', '');
            sync();
            notify();
          });
          if (!firstRadio) firstRadio = radio;
          segments.appendChild(el('label', { 'class': 'tawo-seg', 'for': radioId }, [radio, el('span', { 'class': 'tawo-seg-text', text: METHOD_LABELS[method] })]));
        });
        methodBlock = el('fieldset', { 'class': 'tawo-fieldset', 'aria-describedby': methodError.id }, [
          el('legend', { 'class': 'tawo-label', text: '¿Cómo quieres recibir tu pedido?' }), segments, methodError
        ]);
        registry.fulfillment = { control: methodBlock, error: methodError, focusTarget: firstRadio };
      } else {
        values.fulfillment = methods[0];
        methodBlock = el('p', { 'class': 'tawo-fixed', text: 'Modalidad: ' + METHOD_LABELS[methods[0]] });
      }

      var submitLabel = el('span', { text: 'Realizar pedido' });
      var submitButton = el('button', { 'class': 'tawo-btn tawo-btn--accent tawo-btn--block tawo-btn--lg', type: 'submit' }, [whatsappIcon(), submitLabel]);
      var status = el('div', { 'class': 'tawo-status', role: 'status', 'aria-live': 'polite', hidden: true });

      var form = el('form', { 'class': 'tawo-form', novalidate: true, 'aria-labelledby': prefix + '-title' }, [
        nameField, methodBlock, phoneField, tableField, branchField, addressField,
        el('div', { 'class': 'tawo-submit' }, [
          submitButton,
          el('p', { 'class': 'tawo-note', text: 'Se abrirá WhatsApp con tu pedido ya escrito. Pulsa «Enviar» allí para que el restaurante lo reciba.' })
        ]),
        status
      ]);

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (locked) return; // evita aperturas duplicadas por varios clics
        if (!canContinue()) { close(false); return; }

        var result = validateCustomer(values, config);
        Object.keys(registry).forEach(function (key) { setError(key, result.errors[key]); });
        clear(status);
        status.hidden = true;
        if (!result.valid) {
          var fieldOrder = ['name', 'fulfillment', 'phone', 'table', 'branch', 'address', 'reference'];
          for (var i = 0; i < fieldOrder.length; i += 1) {
            var entry = registry[fieldOrder[i]];
            if (result.errors[fieldOrder[i]] && entry) { (entry.focusTarget || entry.control).focus(); break; }
          }
          return;
        }

        var url = ns.WhatsApp.buildUrl(buildOrder(config, cart.getLines(), result.clean));
        status.hidden = false;
        if (!url) {
          status.className = 'tawo-status tawo-status--error';
          status.appendChild(el('p', { text: 'No se pudo preparar el mensaje. Revisa tu pedido: puede tener demasiados productos.' }));
          return;
        }

        locked = true;
        submitButton.setAttribute('aria-disabled', 'true');
        submitLabel.textContent = 'Abriendo WhatsApp…';
        ns.WhatsApp.open(url);
        status.className = 'tawo-status';
        status.appendChild(el('p', { text: 'Se abrió WhatsApp con tu pedido. Recuerda pulsar «Enviar» allí: el restaurante lo recibe hasta que lo envíes.' }));
        status.appendChild(el('a', { 'class': 'tawo-fallback-link', href: url, target: '_blank', rel: 'noopener noreferrer', text: '¿No se abrió? Toca aquí para abrirlo.' }));
        lockTimer = window.setTimeout(function () {
          locked = false;
          lockTimer = null;
          submitButton.removeAttribute('aria-disabled');
          submitLabel.textContent = 'Realizar pedido';
        }, UNLOCK_DELAY_MS);
      });

      sync();
      container.appendChild(el('button', { 'class': 'tawo-back', type: 'button', text: '‹ Volver al pedido', on: { click: function () { close(false); } } }));
      container.appendChild(el('h3', { 'class': 'tawo-checkout-title', id: prefix + '-title', tabindex: -1, text: 'Tus datos' }));
      container.appendChild(form);
      container.appendChild(el('p', { 'class': 'tawo-brand', text: 'TAWorders Lite' }));
    }

    /* ------------------------------ Control ------------------------------- */

    function open() {
      if (step !== 'idle' || !canContinue()) return;
      step = 'form';
      renderForm();
      container.hidden = false;
      notify();
      var firstInput = container.querySelector('input');
      if (firstInput) firstInput.focus();
    }

    function close(clearValues) {
      unlockWhatsApp();
      if (clearValues) values = defaultValues();
      step = 'idle';
      clear(container);
      container.hidden = true;
      notify();
    }

    /** Se llama cuando cambia el carrito: los totales se actualizan en el panel del pedido. */
    function refresh() {
      if (step !== 'idle' && !canContinue()) close(false);
    }

    return {
      element: container,
      open: open,
      close: close,
      refresh: refresh,
      isOpen: function () { return step !== 'idle'; },
      getFulfillment: function () { return step === 'idle' ? null : values.fulfillment; },
      destroy: function () { unlockWhatsApp(); if (container.parentNode) container.parentNode.removeChild(container); }
    };
  }

  ns.Order = {
    calculateTotals: calculateTotals,
    minimumShortfall: minimumShortfall,
    validateCustomer: validateCustomer,
    buildOrder: buildOrder,
    createCheckout: createCheckout
  };
})(window, document);
