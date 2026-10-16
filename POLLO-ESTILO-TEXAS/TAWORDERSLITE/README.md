# TAW Orders Lite V1

Módulo de pedidos para sitios web de restaurantes, creado por TAW Sitios Web. El visitante consulta el menú por secciones, arma su pedido, escribe sus datos y **abre WhatsApp con el pedido ya escrito**. JavaScript vanilla, HTML5, CSS3 y JSON; sin frameworks, sin dependencias externas y sin backend.

> **Importante:** el módulo no procesa pagos, no usa la API de WhatsApp y no envía nada por sí solo. El cliente debe pulsar «Enviar» dentro de WhatsApp. La interfaz nunca afirma que el pedido fue enviado, recibido o aceptado.

## Estructura de archivos

```
taw-orders-lite/
├── taw-orders-lite.js       Punto de entrada: valida el JSON, dibuja menú y pedido, API TAWOrders.init
├── taw-orders-cart.js       Estado del carrito (cantidades, subtotal, unidades, sesión)
├── taw-orders-order.js      Formulario «Tus datos», validación, IVA, entrega, sucursal y pedido
├── taw-orders-whatsapp.js   Mensaje en español y enlace https://wa.me/NUMERO?text=...
├── taw-orders-lite.css      Estilos aislados con variables CSS
├── menu.json                Configuración de ejemplo (restaurante de pollo frito)
├── demo.html                Página de prueba que simula un sitio existente
└── README.md
```

Todos los módulos cuelgan del único objeto global `window.TAWOrders`.

## Cómo se ve y cómo funciona

1. **Menú** (panel azul marino): título, secciones como pestañas y una tarjeta por platillo. En cada tarjeta, el selector −/+ elige cuántas unidades y **«+ Agregar»** las suma al pedido. Los agotados muestran «Agotado».
2. **Tu pedido** (panel al lado): cada línea tiene −/+ y **×** para quitarla; abajo, Subtotal, IVA y Total, y el botón **Continuar pedido**.
3. Al continuar, el panel del menú se convierte en **Tus datos**: nombre, teléfono y modalidad (**Recogerlo en tienda** / **A domicilio**). El pedido sigue visible al lado.
   - **Recogerlo en tienda:** se elige la sucursal; el mensaje se envía al WhatsApp de *esa* sucursal.
   - **A domicilio:** dirección y referencias (opcional); el mensaje va al WhatsApp general del negocio y se suma el costo de entrega.
4. **Realizar pedido** valida y abre `https://wa.me/NUMERO?text=...` con el mensaje prellenado. «Volver al menú» regresa sin perder el pedido.

En celular los paneles se apilan y aparece una barra «Ver mi pedido» que lleva al carrito.

## Ejecutar la demo

`menu.json` se carga con `fetch`, y los navegadores bloquean `fetch` sobre `file://`. Sirve la carpeta por HTTP (Python, Live Server de VS Code, `php -S`, tu hosting…):

```
cd taw-orders-lite
python3 -m http.server 8080
```

Abre `http://localhost:8080/demo.html`. Los números de WhatsApp de `menu.json` son marcadores: cámbialos por tus números de prueba antes de probar el envío.

## Configurar un restaurante (`menu.json`)

```json
{
  "business": {
    "id": "pollo-estilo-texas",
    "name": "Pollo Estilo Texas",
    "currency": "MXN",
    "whatsapp": "528995271233",
    "greeting": "Hola",
    "taxRate": 16,
    "branches": [
      { "id": "juarez", "name": "Sucursal Juárez", "whatsapp": "528990000001" },
      { "id": "balcones", "name": "Sucursal Balcones", "whatsapp": "528990000002" }
    ]
  },
  "orderSettings": { "pickup": true, "delivery": true, "deliveryFee": 30, "minimumOrder": 0 },
  "categories": [
    {
      "id": "paquetes",
      "name": "Paquetes familiares",
      "products": [
        { "id": "paquete-8", "name": "Paquete de 8 piezas", "description": "8 piezas de pollo con complementos", "price": 249, "image": "img/paquete-8.webp", "available": true }
      ]
    }
  ]
}
```

| Campo | Reglas |
|---|---|
| `business.id` | Texto corto. Se usa para guardar el carrito de la sesión (opcional). |
| `business.name` | Obligatorio. Aparece en el mensaje de WhatsApp. |
| `business.currency` | Obligatorio. Código de 3 letras (`MXN`, `USD`…). |
| `business.whatsapp` | Dígitos con código de país (10 a 15). Recibe los pedidos **a domicilio**. Obligatorio si hay entrega a domicilio o si no hay sucursales. |
| `business.greeting` | Opcional. Saludo del mensaje (por defecto `Hola`). |
| `business.taxRate` | IVA en porcentaje: `16` = 16 %. **Con `0` (o sin el campo) no se agrega IVA**, que es lo correcto si los precios ya lo incluyen. Acepta decimales. |
| `business.branches` | Opcional. Lista de sucursales para recoger: `id` único, `name` y `whatsapp` propio. Con 2 o más, el cliente elige una; con 1, se usa automáticamente; sin sucursales, recoger usa `business.whatsapp`. |
| `orderSettings.pickup` / `delivery` | `true`/`false`. Debe haber al menos una. La modalidad deshabilitada no aparece. Si falta `pickup` se asume `true`; si falta `delivery`, `false`. |
| `orderSettings.deliveryFee` | Número ≥ 0. Solo se cobra a domicilio. |
| `orderSettings.minimumOrder` | Número ≥ 0 (con 0 no hay mínimo). Se compara contra el subtotal, antes de IVA. |
| `products[].id` | Único en **todo** el menú. |
| `products[].price` | Número ≥ 0 (no texto). Precio de lista: si `taxRate` > 0, el IVA se suma encima. |
| `products[].available` | `false` muestra «Agotado» y bloquea el producto. Por defecto `true`. |
| `products[].description`, `image` | Opcionales. Si la imagen no carga, la tarjeta se muestra sin ella. |

**Cómo se calcula el total:** `Subtotal + IVA + Entrega`. El IVA es `subtotal × taxRate / 100` (redondeado al centavo) y **no se aplica al costo de entrega**: `deliveryFee` se cobra tal cual. La línea de IVA solo aparece cuando `taxRate` es mayor que 0.

Si el JSON tiene errores, el módulo muestra un aviso al visitante y escribe en la consola la lista completa (por ejemplo `business.branches[1].whatsapp debe tener entre 10 y 15 dígitos…`).

## Integrar en un sitio existente

```html
<link rel="stylesheet" href="/taw-orders/taw-orders-lite.css">

<div id="taw-orders">
  <!-- Contenido de respaldo: se muestra si el módulo no puede cargar -->
  <p>Para pedir, escríbenos por WhatsApp.</p>
</div>

<script src="/taw-orders/taw-orders-cart.js"></script>
<script src="/taw-orders/taw-orders-order.js"></script>
<script src="/taw-orders/taw-orders-whatsapp.js"></script>
<script src="/taw-orders/taw-orders-lite.js"></script>
<script>
  TAWOrders.init({
    menuUrl: "/taw-orders/menu.json",
    target: "#taw-orders"
  }).catch(function () {});
</script>
```

Los scripts van **en este orden**. El módulo no depende de la estructura HTML del sitio.

### API pública

`TAWOrders.init(options)` devuelve una `Promise` con la instancia (o rechaza si algo falla; el aviso en pantalla ya se mostró).

| Opción | Descripción |
|---|---|
| `target` | **Obligatoria.** Selector CSS o elemento DOM donde se monta. |
| `menuUrl` | URL del JSON. Obligatoria salvo que uses `config`. |
| `config` | Objeto de configuración ya cargado (alternativa a `menuUrl`). |
| `theme` | Colores y tipografía (ver abajo). |
| `title` | Título del panel del menú. Por defecto `Menú`. |
| `showTitle` | `false` oculta el título. |
| `persistCart` | `false` no guarda el carrito en `sessionStorage`. |

La instancia expone `getUnits()`, `getSubtotalCents()`, `clearCart()` y `destroy()`. También están `TAWOrders.version` y `TAWOrders.validateConfig(objeto)`.

## Personalización visual

Con la opción `theme` o sobrescribiendo las variables en tu CSS (`.taw-orders { --taw-primary: #b00020; }`):

| Clave de `theme` | Variable | Por defecto | Se usa en |
|---|---|---|---|
| `panelColor` / `onPanelColor` | `--taw-panel` / `--taw-on-panel` | `#08172b` / `#fff` | Paneles del menú, formulario y pedido |
| `primaryColor` / `onPrimaryColor` | `--taw-primary` / `--taw-on-primary` | `#14b02a` / `#fff` | Precio, Continuar pedido, Realizar pedido, modalidad elegida |
| `accentColor` / `onAccentColor` | `--taw-accent` / `--taw-on-accent` | `#1bbfc4` / `#fff` | «+ Agregar» y contador del pedido |
| `secondaryColor` / `onSecondaryColor` | `--taw-secondary` / `--taw-on-secondary` | `#ee9f1f` / `#fff` | Selectores de cantidad |
| `dangerColor` | `--taw-danger` | `#c1403d` | Botón × |
| `surfaceColor`, `textColor`, `mutedColor`, `borderColor` | `--taw-surface`… | claros | Tarjetas y textos |
| `borderRadius`, `fontFamily` | `--taw-radius`, `--taw-font` | `16px`, Open Sans/sistema | Forma y tipografía |

Otras variables sin clave de `theme`: `--taw-highlight` (fondo de líneas del pedido), `--taw-mint` (fondo de totales), `--taw-field` (fondo de campos) y `--taw-focus` (anillo de foco).

**Tipografía:** el diseño usa Open Sans. El módulo no la descarga; si el sitio ya la carga, se usa automáticamente (o indícala con `fontFamily`).

**Contraste:** el texto blanco sobre naranja y turquesa del diseño tiene un contraste bajo (alrededor de 2:1). Si necesitas cumplir WCAG AA, oscurece esos fondos o usa `onSecondaryColor`/`onAccentColor` con un color oscuro.

**Aislamiento:** todo está bajo `.taw-orders`, las clases usan el prefijo `tawo-` y los selectores llevan dos clases para resistir reglas globales como `button {}`. Una regla del sitio con `!important` o con mayor especificidad podría afectarlo.

El mensaje se codifica con `encodeURIComponent` (espacio → `%20`, salto de línea → `%0A`) en lugar de `URLSearchParams`, porque este último convierte los espacios en `+`.

## Pruebas funcionales

Sirve la demo por HTTP y comprueba:

**Menú y pedido**
- [ ] Las pestañas cambian de sección; solo se ve una a la vez.
- [ ] El selector −/+ de la tarjeta no baja de 1; «+ Agregar» suma esa cantidad y el selector vuelve a 1.
- [ ] El pedido muestra líneas, contador, Subtotal, IVA y Total; − y × funcionan; con cantidad 0 la línea desaparece.
- [ ] El producto agotado no se puede agregar.
- [ ] Recargar la página conserva el pedido (misma pestaña).
- [ ] Con `taxRate: 0` desaparece la línea de IVA.

**Formulario**
- [ ] «Continuar pedido» reemplaza el menú por «Tus datos» y el pedido sigue visible.
- [ ] Enviar vacío muestra errores y enfoca el primer campo.
- [ ] Recoger: pide sucursal y no muestra dirección. A domicilio: pide dirección, referencia opcional, y el pedido suma «Entrega».
- [ ] «Volver al menú» conserva pedido y datos escritos.
- [ ] Con `minimumOrder` mayor que 0, por debajo del mínimo el botón está deshabilitado y se indica cuánto falta.

**WhatsApp**
- [ ] Recoger en «Sucursal Balcones» abre el chat con **el número de Balcones**; a domicilio, con el número general.
- [ ] El mensaje trae IVA, no tiene campos vacíos y no incluye dirección al recoger.
- [ ] Doble clic rápido en «Realizar pedido» abre WhatsApp una sola vez; aparece «¿No se abrió?».
- [ ] Acentos, `&`, `#` y `+` llegan correctos.

**Robustez**
- [ ] `file://` muestra el aviso y el contenido de respaldo.
- [ ] Un JSON con precio de texto, `id` repetido, `taxRate: 150` o una sucursal sin número muestra el aviso y lista los errores en la consola.
- [ ] Un producto llamado `<b>negritas</b>` se muestra como texto.
- [ ] Con teclado se puede completar todo el recorrido, con foco visible.

## Limitaciones conocidas

- **Sin backend no hay validación de servidor.** Precios, IVA y totales se calculan en el navegador; alguien con herramientas de desarrollo podría alterar el mensaje. El restaurante debe confirmar precios y disponibilidad.
- **No hay confirmación de envío** ni identificador de pedido, historial o estados.
- **El JSON es público**, incluidos los números de WhatsApp.
- **A domicilio no se elige sucursal**: siempre se usa `business.whatsapp`.
- **Un solo tipo de IVA** para todo el menú y el costo de entrega no lleva IVA. Productos con tasas distintas no están soportados.
- Sin pagos, zonas de entrega, horarios ni modificadores de producto (sin cebolla, extras).
- Si el mensaje excede unos 6000 caracteres, el módulo no lo abre y pide reducir el pedido.
- Un solo idioma (español) y formato de moneda `es-MX`.

## Requisitos de despliegue

- Servir por **HTTPS** (o HTTP en pruebas locales). No funciona desde `file://`.
- `menu.json` en el mismo origen que la página, o con cabeceras CORS.
- Tipo MIME `application/json` para `.json`.
- Con caché agresiva o CDN, versiona los archivos (`menu.json?v=2`) para que los cambios de precios se vean al instante.
- Content-Security-Policy: `script-src 'self'`, `style-src 'self'`, `connect-src 'self'` e `img-src` para las imágenes del menú. El módulo no usa `eval`, scripts en línea ni recursos remotos; el estilo en línea solo sirve para las variables de tema.
- Un contenedor por restaurante.

## Evolución prevista

El JSON es la fuente de configuración de la versión Lite, no la base de datos definitiva. Los módulos están separados para que, más adelante, el mismo motor lea el menú desde una API y registre pedidos en un backend.
