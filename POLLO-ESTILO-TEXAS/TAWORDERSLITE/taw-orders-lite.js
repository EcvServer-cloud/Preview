/*!
 * TAW Orders Lite V1 — taw-orders-lite.js
 * Punto de entrada: lee y valida el menú, renderiza menú y carrito, y conecta
 * los demás módulos. API pública: TAWOrders.init(options).
 *
 * Orden de carga: taw-orders-cart.js, taw-orders-order.js,
 * taw-orders-whatsapp.js y por último este archivo.
 * (c) TAW Sitios Web
 */
(function (window, document) {
  'use strict';

  var ns = (window.TAWOrders = window.TAWOrders || {});
  var VERSION = '1.1.0';

  var instanceCounter = 0;
  var instances = new WeakMap(); // contenedor -> instancia activa
  var pending = new WeakMap(); // contenedor -> promesa de init en curso

  /* ------------------------------------------------------------------------ *
   * Utilidades compartidas (también las usan los demás módulos)
   * Todo el contenido dinámico se inserta con textContent: nunca innerHTML.
   * ------------------------------------------------------------------------ */

  var currencyFormatters = {};

  function append(node, children) {
    if (children === undefined || children === null) return;
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child === undefined || child === null || child === false) return;
      node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    });
  }

  /**
   * Crea un elemento. props: 'class', 'text' (textContent), 'on' (eventos) y
   * cualquier otro valor se asigna como atributo (true = atributo vacío,
   * false/null/undefined = se omite).
   */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === undefined || value === null || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'on') {
          Object.keys(value).forEach(function (eventName) {
            node.addEventListener(eventName, value[eventName]);
          });
        } else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    append(node, children);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function toCents(amount) {
    return Math.round(Number(amount) * 100);
  }

  function formatMoney(cents, currency) {
    var amount = cents / 100;
    try {
      if (!currencyFormatters[currency]) {
        currencyFormatters[currency] = new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency });
      }
      return currencyFormatters[currency].format(amount);
    } catch (error) {
      return '$' + amount.toFixed(2) + ' ' + currency;
    }
  }

  /** Texto en una sola línea: sin saltos ni caracteres de control. */
  function singleLine(text, maxLength) {
    var value = String(text === undefined || text === null ? '' : text)
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return maxLength ? value.slice(0, maxLength) : value;
  }

  ns.util = { el: el, clear: clear, toCents: toCents, formatMoney: formatMoney, singleLine: singleLine };

  /* ------------------------------------------------------------------------ *
   * Validación y normalización de la configuración (menu.json)
   * ------------------------------------------------------------------------ */

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonNegativeNumber(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0;
  }

  function digitsOf(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\D/g, '') : '';
  }

  function configError(details) {
    var error = new Error('El menú tiene errores de configuración:\n- ' + details.join('\n- '));
    error.name = 'TAWConfigError';
    error.details = details;
    return error;
  }

  /**
   * Valida la estructura del JSON y devuelve una copia normalizada.
   * Lanza TAWConfigError con la lista completa de problemas si algo está mal.
   */
  function validateConfig(raw) {
    var errors = [];
    var catalog = Object.create(null);

    if (!isPlainObject(raw)) {
      throw configError(['El menú debe ser un objeto JSON con "business", "orderSettings" y "categories".']);
    }

    /* business */
    var b = raw.business;
    if (!isPlainObject(b)) {
      errors.push('Falta el bloque "business".');
      b = {};
    }
    var businessName = singleLine(b.name, 80);
    if (!businessName) errors.push('"business.name" es obligatorio.');
    var currency = typeof b.currency === 'string' ? b.currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) errors.push('"business.currency" debe ser un código de 3 letras (por ejemplo "MXN").');

    // IVA en porcentaje: 16 = 16 %. Con 0 no se agrega IVA (precios que ya lo incluyen).
    var taxRate = b.taxRate === undefined ? 0 : b.taxRate;
    if (typeof taxRate !== 'number' || !isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      errors.push('"business.taxRate" debe ser un número entre 0 y 100 (16 para IVA del 16 %; 0 si los precios ya incluyen IVA).');
    }

    /* orderSettings */
    var s = raw.orderSettings === undefined ? {} : raw.orderSettings;
    if (!isPlainObject(s)) {
      errors.push('"orderSettings" debe ser un objeto.');
      s = {};
    }
    var pickup = s.pickup === undefined ? true : s.pickup;
    var delivery = s.delivery === undefined ? false : s.delivery;
    if (typeof pickup !== 'boolean') errors.push('"orderSettings.pickup" debe ser true o false.');
    if (typeof delivery !== 'boolean') errors.push('"orderSettings.delivery" debe ser true o false.');
    if (pickup === false && delivery === false) errors.push('Habilita al menos una modalidad: "pickup" o "delivery".');
    var deliveryFee = s.deliveryFee === undefined ? 0 : s.deliveryFee;
    if (!isNonNegativeNumber(deliveryFee)) errors.push('"orderSettings.deliveryFee" debe ser un número igual o mayor que 0.');
    var minimumOrder = s.minimumOrder === undefined ? 0 : s.minimumOrder;
    if (!isNonNegativeNumber(minimumOrder)) errors.push('"orderSettings.minimumOrder" debe ser un número igual o mayor que 0.');

    /* business.branches: sucursales para recoger, cada una con su WhatsApp */
    var branches = [];
    if (b.branches !== undefined) {
      if (!Array.isArray(b.branches)) {
        errors.push('"business.branches" debe ser una lista.');
      } else {
        var seenBranches = Object.create(null);
        b.branches.forEach(function (branch, index) {
          var label = 'business.branches[' + index + ']';
          if (!isPlainObject(branch)) {
            errors.push(label + ' debe ser un objeto.');
            return;
          }
          var before = errors.length;
          var id = singleLine(branch.id, 60);
          if (!id) errors.push(label + '.id es obligatorio.');
          else if (seenBranches[id]) errors.push(label + '.id "' + id + '" está duplicado.');
          var name = singleLine(branch.name, 80);
          if (!name) errors.push(label + '.name es obligatorio.');
          var phone = digitsOf(branch.whatsapp);
          if (phone.length < 10 || phone.length > 15) errors.push(label + '.whatsapp debe tener entre 10 y 15 dígitos con código de país.');
          if (errors.length !== before) return;
          seenBranches[id] = true;
          branches.push({ id: id, name: name, whatsapp: phone });
        });
      }
    }

    /* business.whatsapp: obligatorio para entregas o si no hay sucursales */
    var whatsapp = digitsOf(b.whatsapp);
    var needsGeneralNumber = delivery === true || !branches.length;
    if (whatsapp ? whatsapp.length < 10 || whatsapp.length > 15 : needsGeneralNumber) {
      errors.push('"business.whatsapp" debe tener entre 10 y 15 dígitos con código de país (por ejemplo "528995271233").');
    }

    /* categories y products */
    var categories = [];
    var seenCategories = Object.create(null);
    var productCount = 0;

    if (!Array.isArray(raw.categories) || !raw.categories.length) {
      errors.push('"categories" debe ser una lista con al menos una categoría.');
    } else {
      raw.categories.forEach(function (category, categoryIndex) {
        var categoryLabel = 'categories[' + categoryIndex + ']';
        if (!isPlainObject(category)) {
          errors.push(categoryLabel + ' debe ser un objeto.');
          return;
        }
        var categoryId = singleLine(category.id, 60);
        if (!categoryId) errors.push(categoryLabel + '.id es obligatorio.');
        else if (seenCategories[categoryId]) errors.push(categoryLabel + '.id "' + categoryId + '" está duplicado.');
        else seenCategories[categoryId] = true;
        var categoryName = singleLine(category.name, 80);
        if (!categoryName) errors.push(categoryLabel + '.name es obligatorio.');
        if (!Array.isArray(category.products)) {
          errors.push(categoryLabel + '.products debe ser una lista.');
          return;
        }

        var products = [];
        category.products.forEach(function (product, productIndex) {
          var label = categoryLabel + '.products[' + productIndex + ']';
          if (!isPlainObject(product)) {
            errors.push(label + ' debe ser un objeto.');
            return;
          }
          var before = errors.length;
          var productId = singleLine(product.id, 60);
          if (!productId) errors.push(label + '.id es obligatorio.');
          else if (catalog[productId]) errors.push(label + '.id "' + productId + '" está duplicado.');
          var productName = singleLine(product.name, 80);
          if (!productName) errors.push(label + '.name es obligatorio.');
          if (!isNonNegativeNumber(product.price)) errors.push(label + '.price debe ser un número igual o mayor que 0.');
          if (product.available !== undefined && typeof product.available !== 'boolean') errors.push(label + '.available debe ser true o false.');
          if (product.description !== undefined && typeof product.description !== 'string') errors.push(label + '.description debe ser texto.');
          if (product.image !== undefined && typeof product.image !== 'string') errors.push(label + '.image debe ser texto.');
          if (errors.length !== before) return;

          var normalized = {
            id: productId,
            name: productName,
            description: singleLine(product.description, 300),
            price: product.price,
            priceCents: toCents(product.price),
            image: typeof product.image === 'string' ? product.image.trim() : '',
            available: product.available !== false
          };
          catalog[productId] = normalized;
          products.push(normalized);
          productCount += 1;
        });

        categories.push({ id: categoryId, name: categoryName, products: products });
      });
      if (!productCount && !errors.length) errors.push('El menú no tiene ningún producto.');
    }

    if (errors.length) throw configError(errors);

    return {
      business: {
        id: singleLine(b.id, 60) || 'restaurante',
        name: businessName,
        currency: currency,
        whatsapp: whatsapp,
        greeting: singleLine(b.greeting, 30) || 'Hola',
        taxRate: taxRate,
        branches: branches
      },
      orderSettings: { pickup: pickup, delivery: delivery, deliveryFee: deliveryFee, minimumOrder: minimumOrder },
      categories: categories,
      catalog: catalog
    };
  }

  ns.validateConfig = validateConfig;

  /* ------------------------------------------------------------------------ *
   * Tema
   * ------------------------------------------------------------------------ */

  var THEME_VARIABLES = {
    panelColor: '--taw-panel',
    onPanelColor: '--taw-on-panel',
    primaryColor: '--taw-primary',
    onPrimaryColor: '--taw-on-primary',
    accentColor: '--taw-accent',
    onAccentColor: '--taw-on-accent',
    secondaryColor: '--taw-secondary',
    onSecondaryColor: '--taw-on-secondary',
    dangerColor: '--taw-danger',
    surfaceColor: '--taw-surface',
    textColor: '--taw-text',
    mutedColor: '--taw-muted',
    borderColor: '--taw-border',
    borderRadius: '--taw-radius',
    fontFamily: '--taw-font'
  };

  function applyTheme(root, theme) {
    if (!isPlainObject(theme)) return;
    Object.keys(THEME_VARIABLES).forEach(function (key) {
      var value = theme[key];
      if (typeof value === 'string' && value.trim() && value.length <= 200) {
        root.style.setProperty(THEME_VARIABLES[key], value.trim());
      }
    });
  }

  /* ------------------------------------------------------------------------ *
   * Carga e inicialización
   * ------------------------------------------------------------------------ */

  function resolveTarget(target) {
    if (typeof target === 'string') {
      try { return document.querySelector(target); } catch (error) { return null; }
    }
    return target && target.nodeType === 1 ? target : null;
  }

  function assertModules() {
    var missing = [];
    if (typeof ns.createCart !== 'function') missing.push('taw-orders-cart.js');
    if (!ns.Order || typeof ns.Order.createCheckout !== 'function') missing.push('taw-orders-order.js');
    if (!ns.WhatsApp || typeof ns.WhatsApp.buildUrl !== 'function') missing.push('taw-orders-whatsapp.js');
    if (missing.length) {
      throw new Error('Faltan archivos del módulo: ' + missing.join(', ') + '. Cárgalos antes de llamar a TAWOrders.init().');
    }
  }

  function loadConfig(options) {
    if (options.config !== undefined) return Promise.resolve(options.config);
    if (typeof options.menuUrl !== 'string' || !options.menuUrl) {
      return Promise.reject(new Error('TAWOrders.init: falta la opción "menuUrl".'));
    }
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('Este navegador no admite fetch().'));
    }
    return window.fetch(options.menuUrl, { headers: { Accept: 'application/json' } }).then(function (response) {
      if (!response.ok) {
        throw new Error('No se pudo cargar "' + options.menuUrl + '" (HTTP ' + response.status + ').');
      }
      return response.json().catch(function () {
        throw new Error('"' + options.menuUrl + '" no contiene JSON válido.');
      });
    });
  }

  function showFailure(target, root, error, fallbackNodes) {
    if (window.console && window.console.error) window.console.error('[TAW Orders]', error);
    clear(root);
    var children = [
      el('p', { 'class': 'tawo-notice-title', text: 'No pudimos mostrar el menú en este momento.' }),
      el('p', { text: 'Recarga la página o contáctanos directamente para hacer tu pedido.' })
    ];
    if (window.location && window.location.protocol === 'file:') {
      children.push(el('p', {
        'class': 'tawo-notice-hint',
        text: 'Para desarrolladores: la página se abrió como archivo (file://) y el navegador bloquea la lectura del JSON. Sírvela por HTTP, por ejemplo con "python3 -m http.server".'
      }));
    }
    root.appendChild(el('div', { 'class': 'tawo-notice tawo-notice--error', role: 'alert' }, children));
    fallbackNodes.forEach(function (node) { target.appendChild(node); });
  }

  /**
   * TAWOrders.init(options) -> Promise<instancia>
   *   target       Selector CSS o elemento donde se monta el módulo (obligatorio).
   *   menuUrl      URL del menu.json (o usa "config" con el objeto ya cargado).
   *   theme        { primaryColor, accentColor, panelColor, ... } (ver README).
   *   title        Título del panel del menú (por defecto "Menú").
   *   showTitle    false para ocultar el título (true por defecto).
   *   persistCart  false para no guardar el carrito en sessionStorage.
   */
  function init(options) {
    options = options || {};
    var target = resolveTarget(options.target);
    if (!target) {
      return Promise.reject(new Error('TAWOrders.init: no se encontró el contenedor ' + String(options.target) + '.'));
    }
    if (instances.has(target)) return Promise.resolve(instances.get(target));
    if (pending.has(target)) return pending.get(target);

    // El contenido original del contenedor sirve de respaldo si algo falla.
    var fallbackNodes = Array.prototype.slice.call(target.childNodes);
    var root = el('div', { 'class': 'taw-orders', lang: 'es', 'data-taw-orders': '' });
    applyTheme(root, options.theme);
    root.appendChild(el('div', { 'class': 'tawo-notice', role: 'status', text: 'Cargando menú…' }));
    clear(target);
    target.appendChild(root);

    var promise = Promise.resolve()
      .then(assertModules)
      .then(function () { return loadConfig(options); })
      .then(validateConfig)
      .then(function (config) {
        var app = createApp(target, root, config, options, fallbackNodes);
        instances.set(target, app);
        return app;
      })
      .catch(function (error) {
        showFailure(target, root, error, fallbackNodes);
        throw error;
      })
      .finally(function () { pending.delete(target); });

    pending.set(target, promise);
    return promise;
  }

  /* ------------------------------------------------------------------------ *
   * Aplicación: menú, carrito y conexión con el flujo de pedido
   * ------------------------------------------------------------------------ */

  function createApp(target, root, config, options, fallbackNodes) {
    var uid = 'tawo' + (instanceCounter += 1);
    var business = config.business;
    var settings = config.orderSettings;
    var money = function (cents) { return formatMoney(cents, business.currency); };

    var cart = ns.createCart({
      catalog: config.catalog,
      storageKey: options.persistCart === false ? null : 'taw-orders:' + business.id + ':cart'
    });
    var checkout = ns.Order.createCheckout({
      config: config,
      cart: cart,
      idPrefix: uid,
      onStateChange: onCheckoutChange
    });

    var productViews = Object.create(null); // id -> referencias del DOM de la tarjeta
    var announceTimer = null;
    var checkoutWasOpen = false;

    /* ---------------------------- Panel del carrito ------------------------ */

    var announcer = el('div', { 'class': 'tawo-sr', role: 'status', 'aria-live': 'polite' });
    var cartCount = el('span', { text: '0' });
    var cartTitle = el('h3', { 'class': 'tawo-cart-title', id: uid + '-cart-title', tabindex: -1, text: 'Tu pedido' });
    var cartEmpty = el('p', { 'class': 'tawo-empty', text: 'Tu pedido está vacío. Elige algo del menú y toca «Agregar».' });
    var cartList = el('ul', { 'class': 'tawo-lines' });
    var totalsBox = el('dl', { 'class': 'tawo-totals' });
    var hint = el('p', { 'class': 'tawo-hint', hidden: true });
    var continueButton = el('button', {
      'class': 'tawo-btn tawo-btn--primary tawo-btn--block tawo-btn--lg',
      type: 'button',
      text: 'Continuar pedido',
      on: { click: function () { checkout.open(); } }
    });
    var side = el('aside', { 'class': 'tawo-panel tawo-side', 'aria-labelledby': uid + '-cart-title' }, [
      el('div', { 'class': 'tawo-cart-head' }, [
        cartTitle,
        el('span', { 'class': 'tawo-cart-count' }, [cartCount, el('span', { 'class': 'tawo-sr', text: ' productos' })])
      ]),
      el('div', { 'class': 'tawo-cart-body' }, [cartEmpty, cartList]),
      totalsBox,
      hint,
      continueButton
    ]);

    var bar = el('button', {
      'class': 'tawo-bar',
      type: 'button',
      hidden: true,
      on: {
        click: function () {
          var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          side.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          cartTitle.focus({ preventScroll: true });
        }
      }
    });

    /* ----------------------------- Anuncios (a11y) ------------------------- */

    function announce(message) {
      announcer.textContent = '';
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(function () { announcer.textContent = message; }, 30);
    }

    function announceLine(productId) {
      var product = config.catalog[productId];
      var quantity = cart.getQuantity(productId);
      announce(
        quantity > 0
          ? product.name + ': ' + quantity + ' en tu pedido. Subtotal ' + money(cart.getSubtotalCents()) + '.'
          : product.name + ' quitado del pedido.'
      );
    }

    /* ------------------------------ Controles ------------------------------ */

    function setDisabled(button, disabled) {
      // aria-disabled conserva el foco del teclado; los manejadores validan.
      if (disabled) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }

    function isDisabled(button) {
      return button.getAttribute('aria-disabled') === 'true';
    }

    function buildStepper(product, quantity, small) {
      var refs = {};
      refs.minus = el('button', {
        'class': 'tawo-btn tawo-step', type: 'button',
        'aria-label': 'Quitar una unidad de ' + product.name, text: '−'
      });
      refs.qty = el('span', { 'class': 'tawo-qty', text: String(quantity) });
      refs.plus = el('button', {
        'class': 'tawo-btn tawo-step', type: 'button',
        'aria-label': 'Agregar una unidad de ' + product.name, text: '+'
      });
      refs.root = el('div', {
        'class': 'tawo-stepper' + (small ? ' tawo-stepper--sm' : ''), role: 'group', 'aria-label': 'Cantidad de ' + product.name
      }, [refs.minus, refs.qty, refs.plus]);
      return refs;
    }

    /* ------------------------------ Menú ----------------------------------- */

    /**
     * Tarjeta de producto. El selector (−/+) elige cuántas unidades agregar
     * (empieza en 1) y «+ Agregar» las suma al pedido.
     */
    function buildProduct(product) {
      var card = el('article', { 'class': 'tawo-product' + (product.available ? '' : ' tawo-product--off') });
      var top = el('div', { 'class': 'tawo-product-top' });
      var foot = el('div', { 'class': 'tawo-product-foot' });
      card.appendChild(top);
      card.appendChild(foot);

      if (product.image) {
        var media = el('div', { 'class': 'tawo-product-media' });
        var image = el('img', { 'class': 'tawo-product-img', src: product.image, alt: '', loading: 'lazy', decoding: 'async' });
        image.addEventListener('error', function () {
          if (media.parentNode) media.parentNode.removeChild(media); // sin imagen, la tarjeta sigue funcionando
        });
        media.appendChild(image);
        top.appendChild(media);
      }

      var inCart = el('p', { 'class': 'tawo-in-cart', hidden: true });
      top.appendChild(el('div', { 'class': 'tawo-product-body' }, [
        el('h4', { 'class': 'tawo-product-name', text: product.name }),
        product.description ? el('p', { 'class': 'tawo-product-desc', text: product.description }) : null,
        inCart
      ]));

      foot.appendChild(el('span', { 'class': 'tawo-price', text: 'Precio: ' + money(product.priceCents) }));

      if (!product.available) {
        foot.appendChild(el('span', { 'class': 'tawo-badge', text: 'Agotado' }));
        return card;
      }

      var view = { card: card, inCart: inCart, pending: 1 };
      view.stepper = buildStepper(product, 1, false);
      view.addButton = el('button', { 'class': 'tawo-btn tawo-btn--accent tawo-add', type: 'button' });

      function room() { return cart.maxQuantity - cart.getQuantity(product.id); }
      view.sync = function () {
        if (view.pending > room()) view.pending = Math.max(1, room());
        view.stepper.qty.textContent = String(view.pending);
        setDisabled(view.stepper.minus, view.pending <= 1);
        setDisabled(view.stepper.plus, view.pending >= room());
        setDisabled(view.addButton, room() < 1);
        view.addButton.textContent = '+ Agregar';
        view.addButton.setAttribute('aria-label', 'Agregar ' + view.pending + ' de ' + product.name + ' al pedido');
      };

      view.stepper.minus.addEventListener('click', function () {
        if (isDisabled(view.stepper.minus)) return;
        view.pending -= 1;
        view.sync();
      });
      view.stepper.plus.addEventListener('click', function () {
        if (isDisabled(view.stepper.plus)) return;
        view.pending += 1;
        view.sync();
      });
      view.addButton.addEventListener('click', function () {
        if (isDisabled(view.addButton)) return;
        var amount = Math.min(view.pending, room());
        if (cart.setQuantity(product.id, cart.getQuantity(product.id) + amount)) {
          view.pending = 1;
          view.sync();
          announceLine(product.id);
        }
      });

      productViews[product.id] = view;
      foot.appendChild(view.stepper.root);
      foot.appendChild(view.addButton);
      view.sync();
      return card;
    }

    var visibleCategories = config.categories.filter(function (category) { return category.products.length > 0; });
    var menuBody = el('div', { 'class': 'tawo-menu-body' });
    var categorySections = [];
    var chips = [];
    visibleCategories.forEach(function (category, index) {
      var section = el('section', { 'class': 'tawo-category', 'aria-label': category.name, hidden: index !== 0 },
        [el('div', { 'class': 'tawo-list' }, category.products.map(buildProduct))]
      );
      categorySections.push(section);
      menuBody.appendChild(section);
    });

    function showCategory(index) {
      categorySections.forEach(function (section, i) { section.hidden = i !== index; });
      chips.forEach(function (chip, i) {
        chip.classList.toggle('tawo-chip--on', i === index);
        chip.setAttribute('aria-pressed', i === index ? 'true' : 'false');
      });
    }

    var menuHead = el('div', { 'class': 'tawo-menu-head' });
    if (options.showTitle !== false) {
      menuHead.appendChild(el('h2', { 'class': 'tawo-title', text: singleLine(options.title, 40) || 'Menú' }));
    }
    if (visibleCategories.length > 1) {
      chips = visibleCategories.map(function (category, index) {
        return el('button', {
          'class': 'tawo-chip', type: 'button', text: category.name,
          on: { click: function () { showCategory(index); } }
        });
      });
      menuHead.appendChild(el('nav', { 'class': 'tawo-nav', 'aria-label': 'Secciones del menú' }, chips));
      showCategory(0);
    }
    var menuView = el('div', { 'class': 'tawo-menu-view' }, [menuHead, menuBody]);
    var main = el('section', { 'class': 'tawo-panel tawo-main' }, [menuView, checkout.element]);

    /* --------------------------- Render reactivo --------------------------- */

    function updateProductViews() {
      Object.keys(productViews).forEach(function (id) {
        var view = productViews[id];
        var quantity = cart.getQuantity(id);
        view.inCart.hidden = quantity === 0;
        view.inCart.textContent = quantity > 0 ? 'En tu pedido: ' + quantity : '';
        view.card.classList.toggle('tawo-product--in-cart', quantity > 0);
        view.sync();
      });
    }

    function focusKeyInCart() {
      var active = document.activeElement;
      return active && cartList.contains(active) ? active.getAttribute('data-focus-key') : null;
    }

    function restoreFocus(key) {
      if (!key) return;
      var buttons = cartList.querySelectorAll('[data-focus-key]');
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i].getAttribute('data-focus-key') === key && buttons[i].getAttribute('aria-disabled') !== 'true') {
          buttons[i].focus();
          return;
        }
      }
      cartTitle.focus({ preventScroll: true }); // la línea ya no existe
    }

    function renderCartList() {
      var focusKey = focusKeyInCart();
      clear(cartList);
      cart.getLines().forEach(function (line) {
        var product = line.product;
        var stepper = buildStepper(product, line.quantity, true);
        stepper.minus.setAttribute('data-focus-key', 'minus:' + product.id);
        stepper.plus.setAttribute('data-focus-key', 'plus:' + product.id);
        setDisabled(stepper.plus, line.quantity >= cart.maxQuantity);
        stepper.minus.addEventListener('click', function () {
          if (cart.decrement(product.id)) announceLine(product.id);
        });
        stepper.plus.addEventListener('click', function () {
          if (isDisabled(stepper.plus)) return;
          if (cart.increment(product.id)) announceLine(product.id);
        });
        var removeButton = el('button', {
          'class': 'tawo-btn tawo-remove', type: 'button', text: '×',
          'aria-label': 'Quitar ' + product.name + ' del pedido',
          'data-focus-key': 'remove:' + product.id
        });
        removeButton.addEventListener('click', function () {
          if (cart.remove(product.id)) announceLine(product.id);
        });
        cartList.appendChild(el('li', { 'class': 'tawo-line' }, [
          el('div', { 'class': 'tawo-line-main' }, [
            el('span', { 'class': 'tawo-line-name', text: product.name }),
            el('div', { 'class': 'tawo-line-controls' }, [stepper.root, removeButton])
          ]),
          el('span', { 'class': 'tawo-line-sub', text: money(product.priceCents) + ' c/u · ' + money(line.lineCents) })
        ]));
      });
      restoreFocus(focusKey);
    }

    function renderTotals() {
      var subtotal = cart.getSubtotalCents();
      var units = cart.getUnits();
      var isEmpty = cart.isEmpty();
      var active = checkout.isOpen();
      var fulfillment = active ? checkout.getFulfillment() : null;
      var totals = ns.Order.calculateTotals(subtotal, config, fulfillment);
      var shortfall = ns.Order.minimumShortfall(subtotal, config);

      cartCount.textContent = String(units);
      cartEmpty.hidden = !isEmpty;
      cartList.hidden = isEmpty;
      totalsBox.hidden = isEmpty;

      clear(totalsBox);
      function row(label, value, isTotal) {
        totalsBox.appendChild(el('div', { 'class': 'tawo-row' + (isTotal ? ' tawo-row--total' : '') }, [
          el('dt', { text: label }),
          el('dd', { text: value })
        ]));
      }
      row('Subtotal', money(totals.subtotalCents));
      if (business.taxRate > 0) row('IVA (' + String(business.taxRate) + '%)', money(totals.taxCents));
      if (active && fulfillment === 'delivery') row('Entrega', totals.deliveryCents > 0 ? money(totals.deliveryCents) : 'Sin costo');
      row('Total', money(totals.totalCents), true);

      var message = '';
      if (!isEmpty && shortfall > 0) {
        message = 'Pedido mínimo: ' + money(toCents(settings.minimumOrder)) + '. Agrega ' + money(shortfall) + ' más para continuar.';
      } else if (!isEmpty && !active && settings.delivery && settings.deliveryFee > 0) {
        message = 'La entrega a domicilio agrega ' + money(toCents(settings.deliveryFee)) + '.';
      }
      hint.textContent = message;
      hint.hidden = !message;

      continueButton.hidden = isEmpty || active;
      setDisabled(continueButton, shortfall > 0);
      continueButton.disabled = shortfall > 0;

      bar.hidden = isEmpty;
      bar.textContent = 'Ver mi pedido · ' + units + (units === 1 ? ' producto' : ' productos') + ' · ' + money(totals.totalCents);
    }

    function onCheckoutChange() {
      var open = checkout.isOpen();
      menuView.hidden = open; // el panel del menú se convierte en el formulario
      renderTotals();
      if (checkoutWasOpen && !open && !continueButton.hidden && !continueButton.disabled) continueButton.focus();
      checkoutWasOpen = open;
    }

    function onCartChange() {
      updateProductViews();
      renderCartList();
      renderTotals();
      checkout.refresh();
    }

    /* ------------------------------ Montaje -------------------------------- */

    clear(root);
    append(root, [el('div', { 'class': 'tawo-layout' }, [main, side]), bar, announcer]);

    onCartChange(); // refleja un carrito restaurado de la sesión
    var unsubscribe = cart.subscribe(onCartChange);

    function destroy() {
      unsubscribe();
      checkout.destroy();
      window.clearTimeout(announceTimer);
      if (root.parentNode) root.parentNode.removeChild(root);
      fallbackNodes.forEach(function (node) { target.appendChild(node); });
      instances.delete(target);
    }

    return {
      version: VERSION,
      business: { id: business.id, name: business.name },
      getUnits: cart.getUnits,
      getSubtotalCents: cart.getSubtotalCents,
      clearCart: cart.clear,
      destroy: destroy
    };
  }

  ns.version = VERSION;
  ns.init = init;
})(window, document);
