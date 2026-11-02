/*!
 * TAW Orders Lite — taw-orders-cart.js
 * Estado del carrito: líneas (platillo + ingredientes elegidos), cantidades, notas,
 * subtotal y unidades. No toca el DOM. Importes en centavos (enteros).
 * Un platillo sin ingredientes tiene una sola línea (clave = id del platillo); uno
 * personalizable tiene una línea por cada combinación distinta de ingredientes.
 * (c) TAW Sitios Web
 */
(function (window) {
  'use strict';

  var ns = (window.TAWOrders = window.TAWOrders || {});
  var DEFAULT_MAX_QUANTITY = 99;
  var MAX_NOTE = 120;

  function cleanNote(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  }

  /**
   * @param {Object}  options.catalog      Mapa id -> producto normalizado (con .ingredients).
   * @param {string=} options.storageKey   Clave de sessionStorage (si se omite, solo memoria).
   * @param {number=} options.maxQuantity  Máximo de unidades por línea (99).
   */
  function createCart(options) {
    var catalog = options.catalog;
    var storageKey = options.storageKey || null;
    var maxQuantity = options.maxQuantity || DEFAULT_MAX_QUANTITY;
    var lines = []; // { key, productId, ingredientIds, quantity, note }
    var listeners = [];

    /** Ingredientes válidos del platillo, sin repetir y en el orden del menú. */
    function selection(product, ids) {
      var wanted = {};
      (ids || []).forEach(function (id) { wanted[id] = true; });
      return product.ingredients.filter(function (ing) { return wanted[ing.id]; }).map(function (ing) { return ing.id; });
    }

    /** Cada paso (grupo) debe cumplir su mínimo y su máximo de opciones (max 0 = sin límite). */
    function validSelection(product, ids) {
      return product.groups.every(function (g) {
        var count = g.options.filter(function (o) { return ids.indexOf(o.id) !== -1; }).length;
        return count >= g.min && (g.max === 0 || count <= g.max);
      });
    }

    function keyFor(product, ids) {
      return product.ingredients.length ? product.id + '|' + ids.join(',') : product.id;
    }

    function find(key) {
      for (var i = 0; i < lines.length; i += 1) if (lines[i].key === key) return lines[i];
      return null;
    }

    /* ---------------------------- Persistencia ---------------------------- */

    function persist() {
      if (!storageKey) return;
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify({
          v: 2,
          lines: lines.map(function (l) { return { p: l.productId, i: l.ingredientIds, q: l.quantity, n: l.note }; })
        }));
      } catch (error) { /* storage bloqueado: el carrito sigue en memoria */ }
    }

    function restore() {
      if (!storageKey) return;
      try {
        var data = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
        if (!data || data.v !== 2 || !Array.isArray(data.lines)) return;
        data.lines.forEach(function (saved) {
          var product = saved && catalog[saved.p];
          if (!product || !product.available) return; // el menú pudo cambiar
          var quantity = saved.q;
          if (typeof quantity !== 'number' || Math.floor(quantity) !== quantity || quantity < 1 || quantity > maxQuantity) return;
          var ids = selection(product, Array.isArray(saved.i) ? saved.i : []);
          if (!validSelection(product, ids)) return;
          var key = keyFor(product, ids);
          if (find(key)) return;
          lines.push({ key: key, productId: product.id, ingredientIds: ids, quantity: quantity, note: typeof saved.n === 'string' ? cleanNote(saved.n) : '' });
        });
      } catch (error) { /* datos corruptos: se ignoran */ }
    }

    function commit() {
      persist();
      listeners.slice().forEach(function (listener) { listener(); });
    }

    function subscribe(listener) {
      listeners.push(listener);
      return function unsubscribe() {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    }

    /* ----------------------------- Operaciones ---------------------------- */

    /** Agrega (o suma a la línea existente) un platillo con los ingredientes elegidos. Devuelve la clave o null. */
    function addLine(productId, ingredientIds, quantity, note) {
      var product = catalog[productId];
      if (!product || !product.available) return null;
      var qty = quantity === undefined ? 1 : quantity;
      if (typeof qty !== 'number' || Math.floor(qty) !== qty || qty < 1) return null;
      var ids = selection(product, ingredientIds);
      if (!validSelection(product, ids)) return null;
      var key = keyFor(product, ids);
      var line = find(key);
      if (line) {
        if (line.quantity + qty > maxQuantity) return null;
        line.quantity += qty;
        if (cleanNote(note)) line.note = cleanNote(note);
      } else {
        if (qty > maxQuantity) return null;
        lines.push({ key: key, productId: productId, ingredientIds: ids, quantity: qty, note: cleanNote(note) });
      }
      commit();
      return key;
    }

    /** Suma una unidad de un platillo SIN ingredientes (los personalizables usan addLine). */
    function add(productId) {
      var product = catalog[productId];
      if (!product || product.ingredients.length) return false;
      return addLine(productId, [], 1) !== null;
    }

    function remove(key) {
      var line = find(key);
      if (!line) return false;
      lines.splice(lines.indexOf(line), 1);
      commit();
      return true;
    }

    function setQuantity(key, quantity) {
      if (typeof quantity !== 'number' || !isFinite(quantity) || Math.floor(quantity) !== quantity) return false;
      if (quantity <= 0) return remove(key);
      var line = find(key);
      if (!line || quantity > maxQuantity || !catalog[line.productId].available) return false;
      line.quantity = quantity;
      commit();
      return true;
    }

    function increment(key) {
      var line = find(key);
      return line ? setQuantity(key, line.quantity + 1) : false;
    }

    function decrement(key) {
      var line = find(key);
      return line ? setQuantity(key, line.quantity - 1) : false;
    }

    /** Nota de la línea (p. ej. «sin cebolla»). No notifica: no necesita volver a dibujar. */
    function setNote(key, text) {
      var line = find(key);
      if (!line) return false;
      line.note = cleanNote(text);
      persist();
      return true;
    }

    function getNote(key) {
      var line = find(key);
      return line ? line.note : '';
    }

    function clear() {
      if (!lines.length) return;
      lines = [];
      commit();
    }

    /* ------------------------------ Consultas ----------------------------- */

    /** Unidades de un platillo en total (sumando todas sus combinaciones). */
    function getQuantity(productId) {
      return lines.reduce(function (total, l) { return l.productId === productId ? total + l.quantity : total; }, 0);
    }

    function getLines() {
      return lines.map(function (l) {
        var product = catalog[l.productId];
        var chosen = product.ingredients.filter(function (ing) { return l.ingredientIds.indexOf(ing.id) !== -1; });
        var unitCents = chosen.reduce(function (sum, ing) { return sum + ing.priceCents; }, product.priceCents);
        return {
          key: l.key,
          product: product,
          quantity: l.quantity,
          ingredients: chosen,
          removed: product.ingredients.filter(function (ing) { return ing.default && l.ingredientIds.indexOf(ing.id) === -1; }),
          unitCents: unitCents,
          lineCents: unitCents * l.quantity,
          note: l.note
        };
      });
    }

    function getUnits() {
      return lines.reduce(function (total, l) { return total + l.quantity; }, 0);
    }

    function getSubtotalCents() {
      return getLines().reduce(function (total, l) { return total + l.lineCents; }, 0);
    }

    restore();

    return {
      maxQuantity: maxQuantity,
      maxNote: MAX_NOTE,
      add: add,
      addLine: addLine,
      increment: increment,
      decrement: decrement,
      setQuantity: setQuantity,
      remove: remove,
      clear: clear,
      setNote: setNote,
      getNote: getNote,
      getQuantity: getQuantity,
      getLines: getLines,
      getUnits: getUnits,
      getSubtotalCents: getSubtotalCents,
      isEmpty: function () { return lines.length === 0; },
      subscribe: subscribe
    };
  }

  ns.createCart = createCart;
})(window);
