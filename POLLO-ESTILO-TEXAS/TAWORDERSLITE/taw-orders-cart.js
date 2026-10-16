/*!
 * TAW Orders Lite V1 — taw-orders-cart.js
 * Estado del carrito: agregar, cambiar cantidades, quitar, subtotal y unidades.
 * No toca el DOM. Los importes se manejan en centavos (enteros) para evitar
 * errores de redondeo con decimales.
 * (c) TAW Sitios Web
 */
(function (window) {
  'use strict';

  var ns = (window.TAWOrders = window.TAWOrders || {});
  var DEFAULT_MAX_QUANTITY = 99;

  /**
   * Crea un carrito.
   * @param {Object}  options
   * @param {Object}  options.catalog      Mapa id -> producto normalizado
   *                                       ({ id, name, priceCents, available }).
   * @param {string=} options.storageKey   Clave de sessionStorage. Si se omite,
   *                                       el carrito solo vive en memoria.
   * @param {number=} options.maxQuantity  Máximo de unidades por producto (99).
   */
  function createCart(options) {
    var catalog = options.catalog;
    var storageKey = options.storageKey || null;
    var maxQuantity = options.maxQuantity || DEFAULT_MAX_QUANTITY;

    var quantities = Object.create(null); // id -> entero
    var order = []; // ids en el orden en que se agregaron (sin duplicados)
    var listeners = [];

    /* ---------------------------- Persistencia ---------------------------- */

    function persist() {
      if (!storageKey) return;
      try {
        var snapshot = {};
        order.forEach(function (id) { snapshot[id] = quantities[id]; });
        window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch (error) {
        /* sessionStorage puede estar bloqueado: el carrito sigue en memoria. */
      }
    }

    function restore() {
      if (!storageKey) return;
      try {
        var raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return;
        var snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object') return;
        Object.keys(snapshot).forEach(function (id) {
          var quantity = snapshot[id];
          var product = catalog[id];
          if (!product || !product.available) return; // el menú pudo cambiar
          if (typeof quantity !== 'number' || Math.floor(quantity) !== quantity) return;
          if (quantity < 1 || quantity > maxQuantity) return;
          quantities[id] = quantity;
          order.push(id);
        });
      } catch (error) {
        /* Datos corruptos o storage bloqueado: se ignoran. */
      }
    }

    /* ------------------------------ Eventos ------------------------------- */

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

    function remove(productId) {
      if (!(productId in quantities)) return false;
      delete quantities[productId];
      order.splice(order.indexOf(productId), 1);
      commit();
      return true;
    }

    function setQuantity(productId, quantity) {
      if (typeof quantity !== 'number' || !isFinite(quantity) || Math.floor(quantity) !== quantity) {
        return false; // solo enteros
      }
      if (quantity <= 0) return remove(productId);
      var product = catalog[productId];
      if (!product || !product.available) return false; // producto inexistente o agotado
      if (quantity > maxQuantity) return false;
      if (!(productId in quantities)) order.push(productId);
      quantities[productId] = quantity;
      commit();
      return true;
    }

    function getQuantity(productId) {
      return quantities[productId] || 0;
    }

    function add(productId) {
      var product = catalog[productId];
      if (!product || !product.available) return false;
      return setQuantity(productId, getQuantity(productId) + 1);
    }

    function increment(productId) {
      return add(productId);
    }

    function decrement(productId) {
      if (!(productId in quantities)) return false;
      return setQuantity(productId, quantities[productId] - 1);
    }

    function clear() {
      if (!order.length) return;
      quantities = Object.create(null);
      order = [];
      commit();
    }

    /* ------------------------------ Consultas ----------------------------- */

    function getLines() {
      return order.map(function (id) {
        var product = catalog[id];
        var quantity = quantities[id];
        return { product: product, quantity: quantity, lineCents: product.priceCents * quantity };
      });
    }

    function getUnits() {
      return order.reduce(function (total, id) { return total + quantities[id]; }, 0);
    }

    function getSubtotalCents() {
      return order.reduce(function (total, id) {
        return total + catalog[id].priceCents * quantities[id];
      }, 0);
    }

    function isEmpty() {
      return order.length === 0;
    }

    restore();

    return {
      maxQuantity: maxQuantity,
      add: add,
      increment: increment,
      decrement: decrement,
      setQuantity: setQuantity,
      remove: remove,
      clear: clear,
      getQuantity: getQuantity,
      getLines: getLines,
      getUnits: getUnits,
      getSubtotalCents: getSubtotalCents,
      isEmpty: isEmpty,
      subscribe: subscribe
    };
  }

  ns.createCart = createCart;
})(window);
