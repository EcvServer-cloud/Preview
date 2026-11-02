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
  var VERSION = '2.0.0';

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
      if (Array.isArray(child)) { append(node, child); return; } // listas anidadas
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

  function isCount(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;
  }

  function digitsOf(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\D/g, '') : '';
  }

  function validLatLng(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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

    // Ubicación general (opcional) para el mapa si las sucursales no traen coordenadas.
    var location = null;
    if (b.location !== undefined) {
      if (isPlainObject(b.location) && validLatLng(b.location.lat, b.location.lng)) location = { lat: b.location.lat, lng: b.location.lng };
      else errors.push('"business.location" debe tener "lat" y "lng" numéricos (por ejemplo lat 26.05, lng -98.29).');
    }

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
    var dineIn = s.dineIn === undefined ? false : s.dineIn;
    if (typeof dineIn !== 'boolean') errors.push('"orderSettings.dineIn" debe ser true o false.');
    if (pickup === false && delivery === false && dineIn !== true) errors.push('Habilita al menos una modalidad: "pickup", "delivery" o "dineIn".');
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
          var hasGeo = branch.lat !== undefined || branch.lng !== undefined;
          if (hasGeo && !validLatLng(branch.lat, branch.lng)) errors.push(label + '.lat y .lng deben ser números válidos.');
          if (errors.length !== before) return;
          seenBranches[id] = true;
          branches.push({
            id: id, name: name, whatsapp: phone, address: singleLine(branch.address, 120),
            lat: hasGeo ? branch.lat : null, lng: hasGeo ? branch.lng : null
          });
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

          // groups (opcional): pasos para armar el platillo. Cada paso tiene un mínimo y un máximo de opciones
          // (max 0 = sin límite) y cada opción un costo opcional (price 0 o ausente = sin costo).
          // También se acepta el formato anterior "ingredients" (una lista de opciones sueltas).
          var groups = [];
          var rawGroups = product.groups;
          if (rawGroups === undefined && product.ingredients !== undefined) {
            rawGroups = [{ id: 'ingredientes', name: 'Ingredientes', min: 0, max: 0, options: product.ingredients }];
          }
          if (rawGroups !== undefined) {
            if (!Array.isArray(rawGroups) || rawGroups.length > 12) {
              errors.push(label + '.groups debe ser una lista de hasta 12 pasos.');
            } else {
              var seenGroups = Object.create(null);
              var seenOptions = Object.create(null);
              var optionCount = 0;
              rawGroups.forEach(function (group, gi) {
                var glabel = label + '.groups[' + gi + ']';
                if (!isPlainObject(group)) { errors.push(glabel + ' debe ser un objeto.'); return; }
                var gid = singleLine(group.id, 60);
                var gname = singleLine(group.name, 80);
                var gmin = group.min === undefined ? 0 : group.min;
                var gmax = group.max === undefined ? 0 : group.max;
                if (!gid) errors.push(glabel + '.id es obligatorio.');
                else if (seenGroups[gid]) errors.push(glabel + '.id "' + gid + '" está duplicado.');
                else seenGroups[gid] = true;
                if (!gname) errors.push(glabel + '.name es obligatorio.');
                if (!isCount(gmin) || !isCount(gmax)) errors.push(glabel + '.min y .max deben ser enteros iguales o mayores que 0 (max 0 = sin límite).');
                else if (gmax > 0 && gmin > gmax) errors.push(glabel + '.min no puede ser mayor que .max.');
                if (!Array.isArray(group.options) || !group.options.length) { errors.push(glabel + '.options debe ser una lista con al menos una opción.'); return; }
                var options = [];
                group.options.forEach(function (opt, k) {
                  var olabel = glabel + '.options[' + k + ']';
                  if (!isPlainObject(opt)) { errors.push(olabel + ' debe ser un objeto.'); return; }
                  var oid = singleLine(opt.id, 60);
                  var oname = singleLine(opt.name, 60);
                  var oprice = opt.price === undefined ? 0 : opt.price;
                  if (!oid) errors.push(olabel + '.id es obligatorio.');
                  else if (seenOptions[oid]) errors.push(olabel + '.id "' + oid + '" está duplicado en el platillo.');
                  else seenOptions[oid] = true;
                  if (!oname) errors.push(olabel + '.name es obligatorio.');
                  if (!isNonNegativeNumber(oprice)) errors.push(olabel + '.price debe ser un número igual o mayor que 0 (0 = sin costo).');
                  if (opt['default'] !== undefined && typeof opt['default'] !== 'boolean') errors.push(olabel + '.default debe ser true o false.');
                  optionCount += 1;
                  options.push({
                    id: oid, name: oname, price: oprice, priceCents: toCents(oprice), 'default': opt['default'] === true,
                    groupId: gid, groupName: gname
                  });
                });
                var defaults = options.filter(function (o) { return o['default']; }).length;
                if (isCount(gmin) && gmin > options.length) errors.push(glabel + '.min es mayor que la cantidad de opciones.');
                if (isCount(gmax) && gmax > 0 && defaults > gmax) errors.push(glabel + ' tiene más opciones preseleccionadas que su máximo.');
                groups.push({ id: gid, name: gname, min: gmin, max: gmax, options: options });
              });
              if (optionCount > 80) errors.push(label + ' tiene más de 80 opciones en total.');
            }
          }
          var ingredients = []; // lista plana de todas las opciones (la usa el carrito)
          groups.forEach(function (g) { g.options.forEach(function (o) { ingredients.push(o); }); });
          if (errors.length !== before) return;

          var normalized = {
            id: productId,
            name: productName,
            description: singleLine(product.description, 300),
            price: product.price,
            priceCents: toCents(product.price),
            image: typeof product.image === 'string' ? product.image.trim() : '',
            available: product.available !== false,
            groups: groups,
            ingredients: ingredients
          };
          catalog[productId] = normalized;
          products.push(normalized);
          productCount += 1;
        });

        categories.push({ id: categoryId, name: categoryName, products: products });
      });
      if (!productCount && !errors.length) errors.push('El menú no tiene ningún producto.');
    }

    /* promotions (opcional): banners de la parte superior del menú */
    var promotions = [];
    if (raw.promotions !== undefined) {
      if (!Array.isArray(raw.promotions)) {
        errors.push('"promotions" debe ser una lista.');
      } else {
        raw.promotions.forEach(function (promo, index) {
          var label = 'promotions[' + index + ']';
          if (!isPlainObject(promo)) { errors.push(label + ' debe ser un objeto.'); return; }
          var title = singleLine(promo.title, 60);
          if (!title) { errors.push(label + '.title es obligatorio.'); return; }
          if (promo.active === false) return; // promoción apagada
          var productId = singleLine(promo.productId, 60);
          if (productId && !catalog[productId]) errors.push(label + '.productId "' + productId + '" no existe en el menú.');
          promotions.push({
            title: title, text: singleLine(promo.text, 160), productId: productId,
            image: typeof promo.image === 'string' ? promo.image.trim() : ''
          });
        });
      }
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
        branches: branches,
        logo: typeof b.logo === 'string' ? b.logo.trim() : '',
        cover: typeof b.cover === 'string' ? b.cover.trim() : '',
        category: singleLine(b.category, 40),
        hours: singleLine(b.hours, 120),
        address: singleLine(b.address, 160),
        location: location
      },
      orderSettings: { pickup: pickup, delivery: delivery, dineIn: dineIn, deliveryFee: deliveryFee, minimumOrder: minimumOrder },
      categories: categories,
      promotions: promotions,
      catalog: catalog
    };
  }

  ns.validateConfig = validateConfig;

  /* ------------------------------------------------------------------------ *
   * Tema
   * ------------------------------------------------------------------------ */

  var THEME_VARIABLES = {
    primaryColor: '--taw-primary',
    onPrimaryColor: '--taw-on-primary',
    accentColor: '--taw-accent',
    onAccentColor: '--taw-on-accent',
    backgroundColor: '--taw-bg',
    surfaceColor: '--taw-surface',
    textColor: '--taw-text',
    mutedColor: '--taw-muted',
    borderColor: '--taw-border',
    dangerColor: '--taw-danger',
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
    // (se ignora un montaje anterior fallido para poder reintentar init sin duplicar avisos)
    var fallbackNodes = Array.prototype.slice.call(target.childNodes).filter(function (node) {
      return !(node.nodeType === 1 && node.hasAttribute('data-taw-orders'));
    });
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
   * Aplicación: portada, menú, pedido y mapa
   * ------------------------------------------------------------------------ */

  /** Sucursales con coordenadas; si no hay, la ubicación general del negocio. */
  function placesOf(config) {
    var business = config.business;
    var located = business.branches.filter(function (branch) { return branch.lat !== null && branch.lng !== null; });
    if (located.length) {
      return located.map(function (b) { return { name: b.name, address: b.address, lat: b.lat, lng: b.lng }; });
    }
    if (business.location) {
      return [{ name: business.name, address: business.address, lat: business.location.lat, lng: business.location.lng }];
    }
    return [];
  }

  function directionsUrl(place) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + place.lat + ',' + place.lng;
  }

  function createApp(target, root, config, options, fallbackNodes) {
    var uid = 'tawo' + (instanceCounter += 1);
    var business = config.business;
    var settings = config.orderSettings;
    var places = placesOf(config);
    var money = function (cents) { return formatMoney(cents, business.currency); };
    var smooth = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; };
    var isMobile = function () { return !!(window.matchMedia && window.matchMedia('(max-width: 899px)').matches); };

    var cart = ns.createCart({
      catalog: config.catalog,
      storageKey: options.persistCart === false ? null : 'taw-orders:' + business.id + ':cart'
    });
    var checkout = ns.Order.createCheckout({ config: config, cart: cart, idPrefix: uid, onStateChange: onCheckoutChange });

    var productViews = Object.create(null);
    var announceTimer = null;
    var observer = null;
    var map = null;
    var tab = 'menu';
    var sheetOpen = false;
    var sheetReturnFocus = null;
    var savedOverflow = '';
    var checkoutWasOpen = false;
    var customDialog = null;

    var announcer = el('div', { 'class': 'tawo-sr', role: 'status', 'aria-live': 'polite' });

    function announce(message) {
      announcer.textContent = '';
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(function () { announcer.textContent = message; }, 30);
    }

    function announceLine(productId) {
      var product = config.catalog[productId];
      var quantity = cart.getQuantity(productId);
      announce(quantity > 0
        ? product.name + ': ' + quantity + ' en tu pedido. Subtotal ' + money(cart.getSubtotalCents()) + '.'
        : product.name + ' quitado del pedido.');
    }

    // aria-disabled conserva el foco del teclado; los manejadores validan.
    function setDisabled(button, disabled) {
      if (disabled) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
    function isDisabled(button) { return button.getAttribute('aria-disabled') === 'true'; }

    function buildStepper(product, quantity) {
      var refs = {};
      refs.minus = el('button', { 'class': 'tawo-step', type: 'button', 'aria-label': 'Quitar una unidad de ' + product.name, text: '−' });
      refs.qty = el('span', { 'class': 'tawo-qty', text: String(quantity) });
      refs.plus = el('button', { 'class': 'tawo-step', type: 'button', 'aria-label': 'Agregar una unidad de ' + product.name, text: '+' });
      refs.root = el('div', { 'class': 'tawo-stepper', role: 'group', 'aria-label': 'Cantidad de ' + product.name }, [refs.minus, refs.qty, refs.plus]);
      return refs;
    }

    /* ------------------------------ Portada --------------------------------- */

    function buildHero() {
      var cover = el('div', { 'class': 'tawo-cover' });
      if (business.cover) {
        var coverImage = el('img', { src: business.cover, alt: '', decoding: 'async' });
        coverImage.addEventListener('error', function () { coverImage.hidden = true; });
        cover.appendChild(coverImage);
      }
      var logo = el('span', { 'class': 'tawo-logo tawo-logo--text', 'aria-hidden': 'true', text: business.name.charAt(0).toUpperCase() });
      if (business.logo) {
        var fallbackLogo = logo;
        logo = el('img', { 'class': 'tawo-logo', src: business.logo, alt: 'Logo de ' + business.name });
        logo.addEventListener('error', function () { if (logo.parentNode) logo.parentNode.replaceChild(fallbackLogo, logo); });
      }
      var meta = el('ul', { 'class': 'tawo-meta' }, [
        business.hours ? el('li', {}, [el('strong', { text: 'Horario' }), el('span', { text: business.hours })]) : null,
        business.address ? el('li', {}, [el('strong', { text: 'Dirección' }), el('span', { text: business.address })]) : null
      ]);
      return el('header', { 'class': 'tawo-hero' }, [
        cover,
        el('div', { 'class': 'tawo-wrap tawo-hero-body' }, [
          logo,
          el('div', { 'class': 'tawo-hero-text' }, [
            business.category ? el('p', { 'class': 'tawo-kicker', text: business.category }) : null,
            el('h1', { 'class': 'tawo-name', text: business.name })
          ]),
          meta.childNodes.length ? meta : null
        ])
      ]);
    }

    /* ------------------------------ Promociones ----------------------------- */

    /** Ventana para armar el platillo por pasos (salsa, complementos, proteína…), con cantidad y notas. */
    function openCustomizer(product) {
      if (!customDialog) {
        customDialog = el('dialog', { 'class': 'tawo-dialog' });
        customDialog.addEventListener('click', function (event) { if (event.target === customDialog) customDialog.close(); });
        root.appendChild(customDialog);
      }
      var selected = {};
      product.ingredients.forEach(function (opt) { if (opt['default']) selected[opt.id] = true; });
      var quantity = 1;
      var titleId = uid + '-dlg-title';
      var totalLabel = el('span');
      var qtyLabel = el('span', { 'class': 'tawo-qty', text: '1' });
      var minus = el('button', { 'class': 'tawo-step', type: 'button', 'aria-label': 'Quitar una unidad', text: '−' });
      var plus = el('button', { 'class': 'tawo-step', type: 'button', 'aria-label': 'Agregar una unidad', text: '+' });
      var views = [];

      function chosen(group) { return group.options.filter(function (o) { return selected[o.id]; }).length; }
      function unitCents() {
        return product.ingredients.reduce(function (sum, o) { return selected[o.id] ? sum + o.priceCents : sum; }, product.priceCents);
      }
      function hintFor(g) {
        if (g.max === 1) return g.min >= 1 ? 'Obligatorio · elige 1' : 'Opcional · elige 1';
        if (g.min > 0 && g.max > 0) return g.min === g.max ? 'Elige ' + g.min : 'Elige de ' + g.min + ' a ' + g.max;
        if (g.min > 0) return 'Elige al menos ' + g.min;
        if (g.max > 0) return 'Opcional · hasta ' + g.max;
        return 'Opcional';
      }
      function paint() {
        qtyLabel.textContent = String(quantity);
        totalLabel.textContent = ' · ' + money(unitCents() * quantity);
        setDisabled(minus, quantity <= 1);
        setDisabled(plus, quantity >= cart.maxQuantity);
        views.forEach(function (v) { // al llegar al máximo del paso, el resto de opciones se bloquea
          if (v.group.max > 1) {
            var full = chosen(v.group) >= v.group.max;
            v.inputs.forEach(function (input) { input.disabled = full && !input.checked; });
          }
        });
      }
      minus.addEventListener('click', function () { if (!isDisabled(minus)) { quantity -= 1; paint(); } });
      plus.addEventListener('click', function () { if (!isDisabled(plus)) { quantity += 1; paint(); } });

      var groupNodes = product.groups.map(function (g, gi) {
        var single = g.max === 1;
        var gid = uid + '-g' + gi;
        var view = { group: g, inputs: [], first: null, box: null, error: el('p', { 'class': 'tawo-field-error', role: 'alert', hidden: true }) };
        var list = el('ul', { 'class': 'tawo-ings' });
        function addRow(label, priceText, input) {
          list.appendChild(el('li', {}, el('label', { 'class': 'tawo-ing', 'for': input.id }, [
            input,
            el('span', { 'class': 'tawo-ing-name', text: label }),
            priceText ? el('span', { 'class': 'tawo-ing-price', text: priceText }) : null
          ])));
        }
        if (single && g.min === 0) { // elegir uno, pero opcional: se puede dejar sin elegir
          var none = el('input', { type: 'radio', id: gid + '-none', name: gid });
          none.checked = chosen(g) === 0;
          none.addEventListener('change', function () {
            g.options.forEach(function (o) { delete selected[o.id]; });
            view.error.hidden = true;
            paint();
          });
          view.first = none;
          addRow('Ninguna', '', none);
        }
        g.options.forEach(function (o, oi) {
          var input = el('input', { type: single ? 'radio' : 'checkbox', id: gid + '-' + oi, name: gid });
          input.checked = !!selected[o.id];
          input.addEventListener('change', function () {
            if (single) {
              g.options.forEach(function (x) { delete selected[x.id]; });
              if (input.checked) selected[o.id] = true;
            } else if (input.checked) selected[o.id] = true;
            else delete selected[o.id];
            view.error.hidden = true;
            paint();
          });
          if (!view.first) view.first = input;
          view.inputs.push(input);
          addRow(o.name, o.priceCents > 0 ? '+' + money(o.priceCents) : '', input);
        });
        var headId = gid + '-head';
        view.box = el('div', { 'class': 'tawo-group', role: 'group', 'aria-labelledby': headId }, [
          el('div', { 'class': 'tawo-group-head', id: headId }, [
            el('h3', { 'class': 'tawo-dialog-sub', text: g.name }),
            el('span', { 'class': 'tawo-group-hint', text: hintFor(g) })
          ]),
          list,
          view.error
        ]);
        views.push(view);
        return view.box;
      });

      var noteId = uid + '-dlg-note';
      var note = el('input', { 'class': 'tawo-note-input', id: noteId, type: 'text', maxlength: cart.maxNote, placeholder: 'Notas (ej. sin picante)', autocomplete: 'off' });
      var addButton = el('button', { 'class': 'tawo-btn tawo-btn--primary tawo-btn--lg tawo-grow', type: 'button' }, ['Agregar al pedido', totalLabel]);
      addButton.addEventListener('click', function () {
        var firstBad = null;
        views.forEach(function (v) {
          var n = chosen(v.group);
          var message = n < v.group.min ? (v.group.min === 1 ? 'Elige una opción.' : 'Elige al menos ' + v.group.min + '.') : '';
          v.error.textContent = message;
          v.error.hidden = !message;
          if (message && !firstBad) firstBad = v;
        });
        if (firstBad) { firstBad.box.scrollIntoView({ block: 'nearest' }); firstBad.first.focus(); return; }
        var ids = product.ingredients.filter(function (o) { return selected[o.id]; }).map(function (o) { return o.id; });
        if (!cart.addLine(product.id, ids, quantity, note.value)) { announce('No se pudo agregar: llegaste al máximo de unidades.'); return; }
        announceLine(product.id);
        customDialog.close();
      });
      customDialog.setAttribute('aria-labelledby', titleId);
      customDialog.replaceChildren(el('div', { 'class': 'tawo-dialog-box' }, [
        el('div', { 'class': 'tawo-dialog-head' }, [
          el('div', {}, [
            el('h2', { 'class': 'tawo-dialog-title', id: titleId, text: product.name }),
            product.description ? el('p', { 'class': 'tawo-item-desc', text: product.description }) : null
          ]),
          el('button', { 'class': 'tawo-dialog-close', type: 'button', 'aria-label': 'Cerrar', text: '×', on: { click: function () { customDialog.close(); } } })
        ]),
        groupNodes,
        el('label', { 'class': 'tawo-label', 'for': noteId, text: 'Notas para este platillo' }),
        note,
        el('div', { 'class': 'tawo-dialog-foot' }, [el('div', { 'class': 'tawo-stepper' }, [minus, qtyLabel, plus]), addButton])
      ]));
      paint();
      customDialog.showModal();
    }

    function buildPromos() {
      if (!config.promotions.length) return null;
      var list = el('ul', { 'class': 'tawo-promo-list' });
      config.promotions.forEach(function (promo) {
        var product = promo.productId ? config.catalog[promo.productId] : null;
        var image = null;
        if (promo.image) {
          image = el('img', { 'class': 'tawo-promo-img', src: promo.image, alt: '', loading: 'lazy' });
          image.addEventListener('error', function () { image.hidden = true; });
        }
        list.appendChild(el('li', { 'class': 'tawo-promo' }, [
          el('div', { 'class': 'tawo-promo-body' }, [
            el('h3', { 'class': 'tawo-promo-title', text: promo.title }),
            promo.text ? el('p', { 'class': 'tawo-promo-text', text: promo.text }) : null,
            product && product.available ? el('button', {
              'class': 'tawo-btn tawo-btn--light tawo-btn--sm', type: 'button',
              text: product.ingredients.length ? 'Personalizar' : 'Agregar',
              'aria-label': (product.ingredients.length ? 'Personalizar ' : 'Agregar ') + product.name,
              on: { click: function () {
                if (product.ingredients.length) openCustomizer(product);
                else if (cart.add(product.id)) announceLine(product.id);
              } }
            }) : null
          ]),
          image
        ]));
      });
      return el('section', { 'class': 'tawo-promos', 'aria-label': 'Promociones' }, [list]);
    }

    /* ------------------------------ Menú ------------------------------------ */

    function buildItem(product) {
      var item = el('article', { 'class': 'tawo-item' + (product.available ? '' : ' tawo-item--off') });
      var side = el('div', { 'class': 'tawo-item-side' });

      if (product.image) {
        var media = el('div', { 'class': 'tawo-item-media' });
        var image = el('img', { src: product.image, alt: '', loading: 'lazy', decoding: 'async' });
        image.addEventListener('error', function () {
          if (media.parentNode) media.parentNode.removeChild(media);
          side.classList.add('tawo-item-side--bare');
        });
        media.appendChild(image);
        side.appendChild(media);
      } else {
        side.classList.add('tawo-item-side--bare');
      }

      var hasExtras = product.ingredients.some(function (ing) { return ing.priceCents > 0; });
      var textBox = el('div', { 'class': 'tawo-item-text' }, [
        el('h4', { 'class': 'tawo-item-name', text: product.name }),
        product.description ? el('p', { 'class': 'tawo-item-desc', text: product.description }) : null,
        product.ingredients.length ? el('span', { 'class': 'tawo-custom', text: 'Personalizable' }) : null,
        el('span', { 'class': 'tawo-price', text: (hasExtras ? 'Desde ' : '') + money(product.priceCents) })
      ]);
      item.appendChild(textBox);

      if (!product.available) {
        side.appendChild(el('span', { 'class': 'tawo-badge', text: 'Agotado' }));
      } else {
        var view = { item: item };
        view.addButton = el('button', { 'class': 'tawo-add', type: 'button', text: '+', 'aria-label': 'Agregar ' + product.name + ' al pedido' });
        if (product.ingredients.length) {
          // Personalizable: «+» abre la ventana para elegir ingredientes.
          view.addButton.setAttribute('aria-label', 'Personalizar ' + product.name);
          view.addButton.addEventListener('click', function () { openCustomizer(product); });
          view.badge = el('span', { 'class': 'tawo-incart', hidden: true });
          textBox.appendChild(view.badge);
          side.appendChild(el('div', { 'class': 'tawo-ctl' }, [view.addButton]));
        } else {
          view.stepper = buildStepper(product, 0);
          view.stepper.root.hidden = true;
          view.addButton.addEventListener('click', function () {
            if (cart.add(product.id)) { announceLine(product.id); view.stepper.plus.focus(); }
          });
          view.stepper.plus.addEventListener('click', function () {
            if (!isDisabled(view.stepper.plus) && cart.add(product.id)) announceLine(product.id);
          });
          view.stepper.minus.addEventListener('click', function () {
            var removed = cart.getQuantity(product.id) === 1;
            if (cart.decrement(product.id)) { announceLine(product.id); if (removed) view.addButton.focus(); }
          });
          side.appendChild(el('div', { 'class': 'tawo-ctl' }, [view.addButton, view.stepper.root]));
        }
        productViews[product.id] = view;
      }
      item.appendChild(side);
      return item;
    }

    var categories = config.categories.filter(function (category) { return category.products.length > 0; });
    var sections = [];
    var chips = [];
    var menuBody = el('div', { 'class': 'tawo-menu' });
    categories.forEach(function (category, index) {
      var heading = el('h2', { 'class': 'tawo-category-title', id: uid + '-cat-' + index, text: category.name });
      var section = el('section', { 'class': 'tawo-category', 'aria-labelledby': heading.id }, [
        heading,
        el('div', { 'class': 'tawo-items' }, category.products.map(buildItem))
      ]);
      sections.push(section);
      menuBody.appendChild(section);
    });

    function setActiveChip(index) {
      chips.forEach(function (chip, i) {
        chip.classList.toggle('tawo-chip--on', i === index);
        if (i === index) chip.setAttribute('aria-current', 'true'); else chip.removeAttribute('aria-current');
      });
      var nav = chips[index] && chips[index].parentNode;
      if (nav) nav.scrollLeft = chips[index].offsetLeft - (nav.clientWidth - chips[index].offsetWidth) / 2;
    }

    var catsNav = null;
    if (categories.length > 1) {
      chips = categories.map(function (category, index) {
        return el('button', {
          'class': 'tawo-chip', type: 'button', text: category.name,
          on: { click: function () { setActiveChip(index); sections[index].scrollIntoView({ behavior: smooth(), block: 'start' }); } }
        });
      });
      catsNav = el('nav', { 'class': 'tawo-cats', 'aria-label': 'Categorías del menú' }, chips);
      setActiveChip(0);
      if (typeof window.IntersectionObserver === 'function') {
        observer = new window.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) { if (entry.isIntersecting) setActiveChip(sections.indexOf(entry.target)); });
        }, { rootMargin: '-25% 0px -65% 0px' });
        sections.forEach(function (section) { observer.observe(section); });
      }
    }

    /* ---------------------------- Panel «Tu pedido» ------------------------- */

    var panelCount = el('span', { 'class': 'tawo-count', text: '0' });
    var panelTitle = el('h2', { 'class': 'tawo-panel-title', id: uid + '-orders-title', tabindex: -1, text: 'Tu pedido' });
    var cartEmpty = el('p', { 'class': 'tawo-empty', text: 'Tu pedido está vacío. Toca «+» en un platillo para agregarlo.' });
    var cartList = el('ul', { 'class': 'tawo-lines' });
    var totalsBox = el('dl', { 'class': 'tawo-totals' });
    var hint = el('p', { 'class': 'tawo-hint', hidden: true });
    var continueButton = el('button', {
      'class': 'tawo-btn tawo-btn--primary tawo-btn--block tawo-btn--lg', type: 'button', text: 'Continuar pedido',
      on: { click: function () { checkout.open(); } }
    });
    var ordersPanel = el('aside', { 'class': 'tawo-orders', 'aria-labelledby': panelTitle.id }, [
      el('div', { 'class': 'tawo-panel-head' }, [
        panelTitle,
        el('span', { 'class': 'tawo-count-wrap' }, [panelCount, el('span', { 'class': 'tawo-sr', text: ' productos' })]),
        el('button', { 'class': 'tawo-close', type: 'button', 'aria-label': 'Cerrar pedido', text: '×', on: { click: function () { closeSheet(); } } })
      ]),
      cartEmpty, cartList, totalsBox, hint, continueButton, checkout.element
    ]);

    function focusKeyInCart() {
      var active = document.activeElement;
      return active && cartList.contains(active) ? active.getAttribute('data-focus-key') : null;
    }

    function restoreFocus(key) {
      if (!key) return;
      var buttons = cartList.querySelectorAll('[data-focus-key]');
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i].getAttribute('data-focus-key') === key && !isDisabled(buttons[i])) { buttons[i].focus(); return; }
      }
      panelTitle.focus({ preventScroll: true }); // la línea ya no existe
    }

    function renderCartList() {
      var focusKey = focusKeyInCart();
      clear(cartList);
      cart.getLines().forEach(function (line, index) {
        var product = line.product;
        var key = line.key;
        var stepper = buildStepper(product, line.quantity);
        stepper.minus.setAttribute('data-focus-key', 'minus:' + key);
        stepper.plus.setAttribute('data-focus-key', 'plus:' + key);
        setDisabled(stepper.plus, line.quantity >= cart.maxQuantity);
        stepper.minus.addEventListener('click', function () { if (cart.decrement(key)) announceLine(product.id); });
        stepper.plus.addEventListener('click', function () {
          if (!isDisabled(stepper.plus) && cart.increment(key)) announceLine(product.id);
        });
        var removeButton = el('button', {
          'class': 'tawo-remove', type: 'button', text: 'Quitar', 'aria-label': 'Quitar ' + product.name + ' del pedido',
          'data-focus-key': 'remove:' + key,
          on: { click: function () { if (cart.remove(key)) announceLine(product.id); } }
        });
        // Nota del platillo (p. ej. «sin cebolla»): se guarda al escribir, sin volver a dibujar.
        var noteId = uid + '-note-' + index;
        var note = el('input', {
          'class': 'tawo-note-input', id: noteId, type: 'text', maxlength: cart.maxNote,
          placeholder: 'Notas (ej. sin cebolla)', autocomplete: 'off'
        });
        note.value = line.note;
        note.addEventListener('input', function () { cart.setNote(key, note.value); });
        var details = [];
        var groupOrder = [];
        var byGroup = Object.create(null);
        line.ingredients.forEach(function (ing) {
          var groupName = ing.groupName || 'Ingredientes';
          if (!byGroup[groupName]) { byGroup[groupName] = []; groupOrder.push(groupName); }
          byGroup[groupName].push(ing.name + (ing.priceCents > 0 ? ' (+' + money(ing.priceCents) + ')' : ''));
        });
        groupOrder.forEach(function (groupName) { details.push(groupName + ': ' + byGroup[groupName].join(', ')); });
        if (line.removed.length) details.push('Sin: ' + line.removed.map(function (ing) { return ing.name; }).join(', '));
        cartList.appendChild(el('li', { 'class': 'tawo-line' }, [
          el('div', { 'class': 'tawo-line-main' }, [
            el('span', { 'class': 'tawo-line-name', text: product.name }),
            el('span', { 'class': 'tawo-line-total', text: money(line.lineCents) })
          ]),
          details.length ? el('p', { 'class': 'tawo-line-ings', text: details.join(' · ') }) : null,
          el('div', { 'class': 'tawo-line-row' }, [stepper.root, removeButton]),
          el('label', { 'class': 'tawo-sr', 'for': noteId, text: 'Notas para ' + product.name }),
          note
        ]));
      });
      restoreFocus(focusKey);
    }

    function updateProductViews() {
      Object.keys(productViews).forEach(function (id) {
        var view = productViews[id];
        var quantity = cart.getQuantity(id);
        if (view.badge) { // personalizable: solo muestra cuántas lleva en el pedido
          view.badge.hidden = quantity === 0;
          view.badge.textContent = quantity + ' en tu pedido';
          view.item.classList.toggle('tawo-item--in-cart', quantity > 0);
          return;
        }
        view.addButton.hidden = quantity > 0;
        view.stepper.root.hidden = quantity === 0;
        view.stepper.qty.textContent = String(quantity);
        setDisabled(view.stepper.plus, quantity >= cart.maxQuantity);
        view.item.classList.toggle('tawo-item--in-cart', quantity > 0);
      });
    }

    /* ----------------------- Barra inferior (móvil) y hoja ------------------- */

    var ordersBar = el('button', {
      'class': 'tawo-pill tawo-pill--primary', type: 'button', hidden: true, 'aria-haspopup': 'dialog',
      on: { click: function () { openSheet(); } }
    });
    var directionsLink = places.length === 1 ? el('a', {
      'class': 'tawo-pill tawo-pill--accent', href: directionsUrl(places[0]), target: '_blank', rel: 'noopener noreferrer',
      hidden: true, text: 'Cómo llegar'
    }) : null;
    var bottom = el('div', { 'class': 'tawo-bottom', hidden: true }, [ordersBar, directionsLink]);
    var backdrop = el('div', { 'class': 'tawo-backdrop', hidden: true, on: { click: function () { closeSheet(); } } });

    function updateBars() {
      ordersBar.hidden = !(tab === 'menu' && cart.getUnits() > 0);
      if (directionsLink) directionsLink.hidden = tab !== 'map';
      bottom.hidden = ordersBar.hidden && (!directionsLink || directionsLink.hidden);
    }

    function openSheet() {
      if (sheetOpen || !isMobile()) return;
      sheetOpen = true;
      sheetReturnFocus = document.activeElement;
      root.classList.add('tawo-sheet-open');
      backdrop.hidden = false;
      ordersPanel.setAttribute('role', 'dialog');
      ordersPanel.setAttribute('aria-modal', 'true');
      savedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      panelTitle.focus();
    }

    function closeSheet() {
      if (!sheetOpen) return;
      sheetOpen = false;
      root.classList.remove('tawo-sheet-open');
      backdrop.hidden = true;
      ordersPanel.removeAttribute('role');
      ordersPanel.removeAttribute('aria-modal');
      document.documentElement.style.overflow = savedOverflow;
      if (sheetReturnFocus && typeof sheetReturnFocus.focus === 'function') sheetReturnFocus.focus();
    }

    function onKeydown(event) { if (event.key === 'Escape') closeSheet(); }
    function onResize() { if (sheetOpen && !isMobile()) closeSheet(); }
    root.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);

    /* ------------------------ Totales y estado del pedido -------------------- */

    function renderTotals() {
      var subtotal = cart.getSubtotalCents();
      var units = cart.getUnits();
      var isEmpty = cart.isEmpty();
      var active = checkout.isOpen();
      var fulfillment = active ? checkout.getFulfillment() : null;
      var totals = ns.Order.calculateTotals(subtotal, config, fulfillment);
      var shortfall = ns.Order.minimumShortfall(subtotal, config);

      panelCount.textContent = String(units);
      cartEmpty.hidden = !isEmpty;
      cartList.hidden = isEmpty;
      totalsBox.hidden = isEmpty;

      clear(totalsBox);
      function row(label, value, isTotal) {
        totalsBox.appendChild(el('div', { 'class': 'tawo-row' + (isTotal ? ' tawo-row--total' : '') }, [el('dt', { text: label }), el('dd', { text: value })]));
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
      continueButton.disabled = shortfall > 0;
      ordersBar.textContent = 'Ver pedido · ' + units + (units === 1 ? ' producto' : ' productos') + ' · ' + money(totals.totalCents);
      updateBars();
    }

    function onCheckoutChange() {
      var open = checkout.isOpen();
      renderTotals();
      if (checkoutWasOpen && !open && !continueButton.hidden && !continueButton.disabled) continueButton.focus();
      checkoutWasOpen = open;
    }

    function onCartChange() {
      updateProductViews();
      renderCartList();
      renderTotals();
      checkout.refresh();
      if (cart.isEmpty()) closeSheet();
    }

    /* ------------------------------ Mapa y pestañas -------------------------- */

    var mapCard = null;
    var tabButtons = [];
    var tabsNav = null;
    if (places.length) {
      map = ns.createMap({ places: places, logo: business.logo, initial: business.name.charAt(0), label: 'Mapa con la ubicación de ' + business.name });
      mapCard = el('section', { 'class': 'tawo-map-card', 'aria-labelledby': uid + '-map-title' }, [
        el('h2', { 'class': 'tawo-card-title', id: uid + '-map-title', text: 'Cómo llegar' }),
        map.element,
        el('ul', { 'class': 'tawo-places' }, places.map(function (place) {
          return el('li', { 'class': 'tawo-place' }, [
            el('div', { 'class': 'tawo-place-text' }, [
              el('strong', { text: place.name }),
              place.address ? el('span', { text: place.address }) : null
            ]),
            el('a', {
              'class': 'tawo-btn tawo-btn--primary tawo-btn--sm', href: directionsUrl(place), target: '_blank',
              rel: 'noopener noreferrer', text: 'Cómo llegar', 'aria-label': 'Cómo llegar a ' + place.name
            })
          ]);
        }))
      ]);
      tabButtons = [['menu', 'Menú'], ['map', 'Cómo llegar']].map(function (item) {
        return el('button', {
          'class': 'tawo-tab', type: 'button', text: item[1], 'aria-pressed': item[0] === 'menu' ? 'true' : 'false',
          on: { click: function () { setTab(item[0]); } }
        });
      });
      tabsNav = el('nav', { 'class': 'tawo-wrap tawo-tabs', 'aria-label': 'Secciones' }, tabButtons);
    }

    function setTab(name) {
      tab = name;
      root.setAttribute('data-tab', name);
      tabButtons.forEach(function (button, index) { button.setAttribute('aria-pressed', ['menu', 'map'][index] === name ? 'true' : 'false'); });
      updateBars();
      if (name === 'map' && map) map.refresh();
    }

    /* ------------------------------ Montaje ---------------------------------- */

    clear(root);
    root.setAttribute('data-tab', 'menu');
    append(root, [
      buildHero(),
      tabsNav,
      el('div', { 'class': 'tawo-wrap tawo-layout' }, [
        el('div', { 'class': 'tawo-col-menu' }, [buildPromos(), catsNav, menuBody]),
        el('div', { 'class': 'tawo-col-side' }, [ordersPanel, mapCard])
      ]),
      bottom, backdrop, announcer
    ]);

    onCartChange(); // refleja un carrito restaurado de la sesión
    var unsubscribe = cart.subscribe(onCartChange);

    function destroy() {
      unsubscribe();
      closeSheet();
      if (customDialog && customDialog.open) customDialog.close();
      checkout.destroy();
      if (observer) observer.disconnect();
      if (map) map.destroy();
      root.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onResize);
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
