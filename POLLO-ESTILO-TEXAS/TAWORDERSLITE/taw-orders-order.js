/*!
 * TAW Orders Lite V1 — taw-orders-order.js
 * Finalización del pedido: formulario «Tus datos», validación, IVA, entrega,
 * total, sucursal para recoger y objeto de pedido estructurado.
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

  /* Las utilidades viven en taw-orders-lite.js; se leen al usarlas. */
  function el(tag, props, children) { return ns.util.el(tag, props, children); }
  function clear(node) { ns.util.clear(node); }
  function singleLine(text) { return ns.util.singleLine(text); }
  function toCents(amount) { return ns.util.toCents(amount); }

  /* ----------------------------- Lógica pura ----------------------------- */

  /**
   * Subtotal + IVA (sobre el subtotal de productos) + entrega (solo a domicilio).
   * Con taxRate 0 no hay IVA: sirve cuando los precios ya lo incluyen.
   */
  function calculateTotals(subtotalCents, config, fulfillment) {
    var taxCents = Math.round(subtotalCents * config.business.taxRate / 100);
    var deliveryCents = fulfillment === 'delivery' ? toCents(config.orderSettings.deliveryFee) : 0;
    return {
      subtotalCents: subtotalCents,
      taxCents: taxCents,
      deliveryCents: deliveryCents,
      totalCents: subtotalCents + taxCents + deliveryCents
    };
  }

  /** Centavos que faltan para el pedido mínimo (0 si ya se alcanzó). */
  function minimumShortfall(subtotalCents, config) {
    return Math.max(0, toCents(config.orderSettings.minimumOrder) - subtotalCents);
  }

  function findBranch(config, id) {
    var branches = config.business.branches;
    for (var i = 0; i < branches.length; i += 1) {
      if (branches[i].id === id) return branches[i];
    }
    return null;
  }

  /** Valida y limpia los datos del cliente. */
  function validateCustomer(values, config) {
    var settings = config.orderSettings;
    var errors = {};
    var clean = {};

    var name = singleLine(values.name);
    if (name.length < 2) errors.name = 'Escribe tu nombre.';
    else if (name.length > MAX_NAME) errors.name = 'Usa un nombre de máximo ' + MAX_NAME + ' caracteres.';
    clean.name = name;

    var phoneText = singleLine(values.phone);
    var phoneDigits = phoneText.replace(/\D/g, '');
    if (!phoneText) {
      errors.phone = 'Escribe tu teléfono para que el restaurante pueda contactarte.';
    } else if (!/^[0-9+()\-.\s]+$/.test(phoneText) || phoneDigits.length < 10 || phoneDigits.length > 15) {
      errors.phone = 'Escribe un teléfono válido de 10 dígitos.';
    }
    clean.phone = phoneDigits;

    var fulfillment = values.fulfillment;
    if ((fulfillment === 'pickup' && settings.pickup) || (fulfillment === 'delivery' && settings.delivery)) {
      clean.fulfillment = fulfillment;
    } else {
      errors.fulfillment = 'Elige cómo quieres recibir tu pedido.';
    }

    if (clean.fulfillment === 'pickup' && config.business.branches.length) {
      var branch = findBranch(config, values.branch);
      if (branch) clean.branch = branch;
      else errors.branch = 'Elige la sucursal donde recogerás tu pedido.';
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
   * Genera el pedido estructurado. Precios, IVA y totales salen del JSON
   * validado, nunca de valores escritos en el DOM. El número de WhatsApp es el
   * de la sucursal elegida (recoger) o el general del negocio.
   */
  function buildOrder(config, lines, customer) {
    var items = lines.map(function (line) {
      return {
        id: line.product.id,
        name: line.product.name,
        unitCents: line.product.priceCents,
        quantity: line.quantity,
        lineCents: line.product.priceCents * line.quantity
      };
    });
    var subtotalCents = items.reduce(function (sum, item) { return sum + item.lineCents; }, 0);
    var totals = calculateTotals(subtotalCents, config, customer.fulfillment);
    var isDelivery = customer.fulfillment === 'delivery';
    var branch = customer.branch || null;

    return {
      business: {
        id: config.business.id,
        name: config.business.name,
        currency: config.business.currency,
        greeting: config.business.greeting
      },
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
      address: isDelivery ? customer.address : '',
      reference: isDelivery ? customer.reference : ''
    };
  }

  /* ------------------------------ Interfaz ------------------------------- */

  function whatsappIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('width', '34');
    svg.setAttribute('height', '34');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var bubble = document.createElementNS(SVG_NS, 'path');
    bubble.setAttribute('d', 'M16 3C8.8 3 3 8.7 3 15.8c0 2.4.7 4.700 1.900 6.700L3 29l6.700-1.800A13 13 0 0 0 16 28.600c7.200 0 13-5.700 13-12.800S23.200 3 16 3z');
    bubble.setAttribute('fill', 'none');
    bubble.setAttribute('stroke', 'currentColor');
    bubble.setAttribute('stroke-width', '2.4');
    bubble.setAttribute('stroke-linejoin', 'round');
    var phone = document.createElementNS(SVG_NS, 'path');
    phone.setAttribute('d', 'M11.600 9.500c.4-.5 1.200-.5 1.500.1l1.100 2.300c.2.400.1.800-.2 1.100l-.800.800c.9 1.800 2.300 3.200 4.100 4.100l.9-.9c.3-.3.700-.4 1.100-.2l2.300 1.100c.6.300.600 1.100.1 1.500-1 1-2.300 1.400-3.600 1-3.800-1.100-6.700-4.100-7.800-7.800-.3-1.300.1-2.600 1.300-3.100z');
    phone.setAttribute('fill', 'currentColor');
    svg.appendChild(bubble);
    svg.appendChild(phone);
    return svg;
  }

  /**
   * Crea el flujo de finalización: formulario «Tus datos» y envío a WhatsApp.
   * @param {Object}   options
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

    var methods = [];
    if (settings.pickup) methods.push('pickup');
    if (settings.delivery) methods.push('delivery');
    var methodLabels = { pickup: 'Recogerlo en tienda', delivery: 'A domicilio' };

    function defaultValues() {
      return {
        name: '',
        phone: '',
        fulfillment: methods[0],
        branch: branches.length === 1 ? branches[0].id : '',
        address: '',
        reference: ''
      };
    }

    var values = defaultValues(); // solo en memoria; nunca se guarda en storage
    var step = 'idle'; // idle | form
    var locked = false;
    var lockTimer = null;
    var container = el('div', { 'class': 'tawo-checkout', hidden: true });

    function notify() {
      if (typeof options.onStateChange === 'function') options.onStateChange();
    }

    function unlockWhatsApp() {
      window.clearTimeout(lockTimer);
      lockTimer = null;
      locked = false;
    }

    function canContinue() {
      return !cart.isEmpty() && minimumShortfall(cart.getSubtotalCents(), config) === 0;
    }

    /* ------------------------------ Formulario ---------------------------- */

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

      /* Campo con etiqueta oculta visualmente (el diseño usa texto de ejemplo). */
      function field(key, label, control) {
        var errorId = prefix + '-' + key + '-error';
        control.setAttribute('aria-describedby', errorId);
        var error = el('p', { 'class': 'tawo-field-error', id: errorId, hidden: true });
        registry[key] = { control: control, error: error };
        return el('div', { 'class': 'tawo-field' }, [
          el('label', { 'class': 'tawo-sr', 'for': control.id, text: label }),
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

      var backButton = el('button', {
        'class': 'tawo-back', type: 'button', text: '‹ Volver al menú',
        on: { click: function () { close(false); } }
      });
      var title = el('h3', { 'class': 'tawo-checkout-title', id: prefix + '-title', tabindex: -1, text: 'Tus datos' });

      var nameField = textInput('name', 'Nombre', 'Nombre', { autocomplete: 'name', maxlength: MAX_NAME, required: true });
      var phoneField = textInput('phone', 'Teléfono', 'Teléfono', {
        type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: 20, required: true
      });

      var pickupBlock = null;
      var addressBlock = null;

      /* Modalidad: solo se muestran las habilitadas en el JSON. */
      var methodBlock;
      if (methods.length > 1) {
        var methodError = el('p', { 'class': 'tawo-field-error', id: prefix + '-fulfillment-error', hidden: true });
        methodBlock = el('fieldset', { 'class': 'tawo-fieldset', 'aria-describedby': prefix + '-fulfillment-error' });
        methodBlock.appendChild(el('legend', { 'class': 'tawo-sr', text: '¿Cómo quieres recibir tu pedido?' }));
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
            if (pickupBlock) pickupBlock.hidden = method !== 'pickup';
            if (addressBlock) addressBlock.hidden = method !== 'delivery';
            notify();
          });
          if (!firstRadio) firstRadio = radio;
          segments.appendChild(el('label', { 'class': 'tawo-seg', 'for': radioId }, [
            radio,
            el('span', { 'class': 'tawo-seg-text', text: methodLabels[method] })
          ]));
        });
        methodBlock.appendChild(segments);
        methodBlock.appendChild(methodError);
        registry.fulfillment = { control: methodBlock, error: methodError, focusTarget: firstRadio };
      } else {
        values.fulfillment = methods[0];
        methodBlock = el('p', { 'class': 'tawo-fixed', text: 'Modalidad: ' + methodLabels[methods[0]] });
      }

      /* Sucursal: solo al recoger. Cada sucursal tiene su propio WhatsApp. */
      if (settings.pickup && branches.length) {
        if (branches.length > 1) {
          var select = el('select', { 'class': 'tawo-input tawo-select', id: prefix + '-branch', name: 'branch' });
          select.appendChild(el('option', { value: '', text: 'Seleccionar sucursal' }));
          branches.forEach(function (branch) {
            select.appendChild(el('option', { value: branch.id, text: branch.name }));
          });
          select.value = values.branch;
          select.addEventListener('change', function () {
            values.branch = select.value;
            setError('branch', '');
          });
          pickupBlock = field('branch', 'Sucursal para recoger', select);
        } else {
          pickupBlock = el('p', { 'class': 'tawo-fixed', text: 'Sucursal: ' + branches[0].name });
        }
        pickupBlock.hidden = values.fulfillment !== 'pickup';
      }

      /* Dirección y referencia: solo a domicilio. */
      if (settings.delivery) {
        addressBlock = el('div', { 'class': 'tawo-address', hidden: values.fulfillment !== 'delivery' }, [
          textInput('address', 'Dirección de entrega', 'Calle, número, colonia, ciudad', { autocomplete: 'address-line1', maxlength: MAX_ADDRESS }),
          textInput('reference', 'Referencias (opcional)', 'Referencias (opcional)', { maxlength: MAX_REFERENCE })
        ]);
      }

      var submitLabel = el('span', { text: 'Realizar pedido' });
      var submitButton = el('button', { 'class': 'tawo-btn tawo-btn--primary tawo-btn--xl', type: 'submit' }, [whatsappIcon(), submitLabel]);
      var status = el('div', { 'class': 'tawo-status', role: 'status', 'aria-live': 'polite', hidden: true });

      var form = el('form', { 'class': 'tawo-form', novalidate: true, 'aria-labelledby': prefix + '-title' }, [
        nameField,
        phoneField,
        methodBlock,
        pickupBlock,
        addressBlock,
        el('div', { 'class': 'tawo-submit' }, [
          submitButton,
          el('p', {
            'class': 'tawo-note',
            text: 'Se abrirá WhatsApp con tu pedido ya escrito. Pulsa «Enviar» allí para que el restaurante lo reciba.'
          })
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
          var order = ['name', 'phone', 'fulfillment', 'branch', 'address', 'reference'];
          for (var i = 0; i < order.length; i += 1) {
            var entry = registry[order[i]];
            if (result.errors[order[i]] && entry) {
              (entry.focusTarget || entry.control).focus();
              break;
            }
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
        status.appendChild(el('p', {
          text: 'Se abrió WhatsApp con tu pedido. Recuerda pulsar «Enviar» allí: el restaurante lo recibe hasta que lo envíes.'
        }));
        status.appendChild(el('a', {
          'class': 'tawo-fallback-link', href: url, target: '_blank', rel: 'noopener noreferrer',
          text: '¿No se abrió? Toca aquí para abrirlo.'
        }));
        lockTimer = window.setTimeout(function () {
          locked = false;
          lockTimer = null;
          submitButton.removeAttribute('aria-disabled');
          submitLabel.textContent = 'Realizar pedido';
        }, UNLOCK_DELAY_MS);
      });

      container.appendChild(backButton);
      container.appendChild(title);
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

    /** Se llama cuando cambia el carrito: el total se actualiza en el panel del pedido. */
    function refresh() {
      if (step === 'idle') return;
      if (!canContinue()) close(false);
    }

    function getFulfillment() {
      return step === 'idle' ? null : values.fulfillment;
    }

    function destroy() {
      unlockWhatsApp();
      if (container.parentNode) container.parentNode.removeChild(container);
    }

    return {
      element: container,
      open: open,
      close: close,
      refresh: refresh,
      isOpen: function () { return step !== 'idle'; },
      getFulfillment: getFulfillment,
      destroy: destroy
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
