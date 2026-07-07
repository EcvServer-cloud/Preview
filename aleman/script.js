
/* =========================================================
   HAMBURGUESAS ALEMÁN — script.js
   - Genera el contenido del modal "Ver menú completo"
   - Filtra por categoría según la tarjeta que se haya pulsado
   - Cierra el menú móvil al hacer click en un enlace
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {

  // ---------------------------------------------------------
  // 1) Datos del menú (nombre, categoría, imagen, precio)
  //    En un sitio real esto vendría de una API o CMS.
  // ---------------------------------------------------------
  const menuItems = [
    { cat: 'hamburguesas', name: 'Hamburguesa Clásica', price: '$85',
      img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=80' },
    { cat: 'hamburguesas', name: 'Hamburguesa Doble Tocino', price: '$110',
      img: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=700&q=80' },
    { cat: 'hamburguesas', name: 'Hamburguesa Especial Alemán', price: '$125',
      img: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=700&q=80' },
    { cat: 'papas', name: 'Papas a la Francesa', price: '$45',
      img: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=700&q=80' },
    { cat: 'papas', name: 'Papas Gratinadas', price: '$65',
      img: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=700&q=80' },
    { cat: 'alitas', name: 'Alitas BBQ (10 pzas)', price: '$95',
      img: 'https://images.unsplash.com/photo-1608039755401-742074f0548d?auto=format&fit=crop&w=700&q=80' },
    { cat: 'alitas', name: 'Alitas Picantes (10 pzas)', price: '$95',
      img: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=700&q=80' },
    { cat: 'bebidas', name: 'Refresco / Bebida embotellada', price: '$25',
      img: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=700&q=80' }
  ];

  const menuModal = document.getElementById('menuModal');
  const menuModalBody = document.getElementById('menuModalBody');
  const menuModalLabel = document.getElementById('menuModalLabel');

  const catTitles = {
    todos: 'Nuestro menú completo',
    hamburguesas: 'Hamburguesas',
    papas: 'Papas',
    alitas: 'Alitas',
    bebidas: 'Bebidas'
  };

  // ---------------------------------------------------------
  // 2) Al abrir el modal, pinta las fotos una debajo de otra
  //    filtradas por la categoría del botón/tarjeta pulsada
  // ---------------------------------------------------------
  menuModal.addEventListener('show.bs.modal', function (event) {
    const trigger = event.relatedTarget;
    const category = trigger && trigger.dataset.category ? trigger.dataset.category : 'todos';

    const items = category === 'todos'
      ? menuItems
      : menuItems.filter(function (item) { return item.cat === category; });

    menuModalLabel.innerHTML = '<i class="bi bi-journal-text"></i> ' + (catTitles[category] || 'Menú');

    menuModalBody.innerHTML = items.map(function (item) {
      return (
        '<div class="menu-modal-item">' +
          '<img src="' + item.img + '" alt="' + item.name + '" loading="lazy">' +
          '<div class="menu-modal-caption">' +
            '<span>' + item.name + '</span>' +
            '<span class="badge-cat">' + item.price + '</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  });

  // Limpia el contenido al cerrar para no duplicar imágenes en la próxima apertura
  menuModal.addEventListener('hidden.bs.modal', function () {
    menuModalBody.innerHTML = '';
  });

  // ---------------------------------------------------------
  // 3) Cierra el menú colapsado (móvil) al pulsar un enlace
  // ---------------------------------------------------------
  const navLinks = document.querySelectorAll('#navMenu .nav-link');
  const navCollapseEl = document.getElementById('navMenu');
  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (navCollapseEl.classList.contains('show')) {
        const collapse = bootstrap.Collapse.getOrCreateInstance(navCollapseEl);
        collapse.hide();
      }
      navLinks.forEach(function (l) { l.classList.remove('active'); });
      link.classList.add('active');
    });
  });

  // ---------------------------------------------------------
  // 4) Sombra dinámica en la navbar al hacer scroll
  // ---------------------------------------------------------
  const nav = document.getElementById('mainNav');
  window.addEventListener('scroll', function () {
    if (window.scrollY > 10) {
      nav.style.boxShadow = '0 4px 20px rgba(0,0,0,.35)';
    } else {
      nav.style.boxShadow = 'none';
    }
  });

});
        
