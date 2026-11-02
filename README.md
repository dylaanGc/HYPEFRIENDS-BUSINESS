# HYPEFRIENDS BUSINESS v2 — Supabase

Aplicación PWA para ventas, abonos, inventario, clientes, gastos e historial.

## Supabase
El frontend ya viene configurado con el Project URL y la Publishable key del proyecto HYPEFRIENDS. La Publishable key es apta para navegador; no se incluye ninguna Secret key.

## Base de datos
Si las tablas todavía no están creadas, ejecuta `supabase.sql` en Supabase SQL Editor. Cuando ya exista la base de datos, vuelve a ejecutar el script al publicar esta versión para agregar la moneda del costo unitario; la actualización conserva el costo actual y usa la moneda existente del producto como moneda inicial del costo. El script usa comprobaciones idempotentes para evitar duplicar columnas, políticas o tablas de Realtime.

## Usuarios
Los dos socios deben existir en Supabase Authentication → Users. Ingresan con su correo y contraseña. Ambos trabajan sobre los mismos datos del negocio mediante RLS para usuarios autenticados.

## Sincronización y datos anteriores
Los cambios nuevos se guardan en Supabase y se sincronizan entre dispositivos. Al iniciar sesión por primera vez en cada navegador, la app importa a Supabase los datos locales antiguos de inventario, ventas, apartados y gastos. La copia local no se elimina.

## Moneda y administración
Los productos, ventas y gastos se pueden registrar en colones costarricenses (CRC) o dólares (USD). En Inventario, las opciones de foto y COSTO permiten cargar una imagen del producto o cambiar el costo unitario sin alterar su stock ni su precio de venta. Las fotos se guardan en el bucket público `product-images` de Supabase Storage; ejecuta nuevamente `supabase.sql` para crearlo y habilitar la carga para usuarios autenticados. Se aceptan imágenes JPG, PNG y WebP; las fotos grandes se comprimen automáticamente para que ocupen hasta 5 MB. Las fotos se suben al elegirlas y tocar **GUARDAR FOTO**. El costo unitario tiene una moneda independiente de la moneda del precio de venta. En el panel, el costo de mercadería permite ver el valor del inventario en CRC o USD, convirtiendo con la tasa fija de ₡460 por US$1. Cada venta conserva la moneda que se elija y los abonos usan la moneda de esa venta. La gráfica del panel también permite elegir la moneda para mostrar las ventas de los últimos siete días. Los datos USD importados del sistema anterior se mantienen en USD y ya no se convierten automáticamente al iniciar sesión. Los registros que una versión anterior ya convirtió a CRC permanecen como están; no se pueden reconstruir automáticamente sus valores originales.

Desde el panel puedes agregar o quitar gastos y clientes, agregar productos, ajustar el stock (sumar o retirar unidades), retirar productos del inventario y registrar o quitar abonos. Al retirar un producto, se conserva el importe y la cantidad de las ventas previas. Al quitar un cliente asociado a ventas, esas ventas y abonos se conservan sin el vínculo al cliente.

## Compras del sitio web
La sección **Compras de sitio web** recibe pedidos en tiempo real desde `web_orders` y muestra sus productos, cliente, dirección, montos, pago, estado e historial. Para habilitarla, ejecuta `supabase-web-orders.sql` en Supabase SQL Editor después de `supabase.sql`. Esta migración crea tablas separadas de las ventas manuales, activa RLS y Realtime, y crea el bucket privado `web-order-proofs`.

La app financiera y la tienda están en repositorios separados. El checkout y la función de servidor para registrar pedidos están preparados en [dylaanGc/hypefriendscr](https://github.com/dylaanGc/hypefriendscr); deben configurarse y desplegarse con las instrucciones de ese repositorio:

1. Ejecuta esta migración después de `supabase.sql`; no crea ventas manuales ni modifica las existencias del inventario financiero.
2. Despliega `create-web-order` como Supabase Edge Function siguiendo el README del sitio; GitHub Pages no ofrece funciones de servidor. Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` automáticamente al runtime de Edge Functions; no copies la clave `service_role` al navegador, repositorio ni a variables `VITE_*`/`NEXT_PUBLIC_*`. La función valida en servidor el catálogo web, precios, stock, zona e importe del envío antes de llamar a `create_web_order`; referencias únicas y transacciones previenen pedidos duplicados y sobreventa.
3. El checkout sube comprobantes al bucket privado `web-order-proofs`. No habilites lectura pública ni carga anónima al bucket. La app crea enlaces temporales solo para usuarios autenticados de la app financiera.
4. Sin comprobante, el pago inicia pendiente; al adjuntarlo pasa a **comprobante por revisar**, nunca a pagado. La aprobación agrega un único registro de pago; contra entrega permanece pendiente hasta **CONFIRMAR COBRO RECIBIDO**. El registro web no crea ventas manuales ni modifica existencias; reconcilia las existencias web antes de aceptar compras y no descuentes el inventario una segunda vez.

El checkout calcula el envío en el servidor: ₡2.000 dentro del GAM, ₡3.500 fuera del GAM y gratis para compras superiores a ₡50.000. La migración inicializa las existencias web desde el catálogo estático y reserva pedidos del sitio, pero **no sincroniza esas existencias con el inventario manual de la app**; reconcilia `web_store_catalog.stock_snapshot` antes de aceptar pedidos y no registres esos pedidos como ventas manuales ni descuentes la existencia una segunda vez.

### Notificaciones push
La app actualiza el contador y la lista con Supabase Realtime mientras está abierta. El botón **ACTIVAR AVISOS PUSH EN ESTE DISPOSITIVO** solicita permiso, registra la suscripción del navegador en `web_push_subscriptions` (RLS limita cada registro a su usuario) y el service worker puede mostrar el push con `orderId`, `orderNumber`, `customerName`, `title` y `body`; tocarlo abre directamente el pedido.

El push con la app cerrada aún necesita un emisor Web Push; no se enviará ninguna notificación hasta configurarlo:

1. Genera un par VAPID para el negocio. Pega solamente la clave **pública** en el atributo `content` de `<meta name="web-push-vapid-public-key">` en `index.html`, vuelve a publicar la PWA y activa las notificaciones en cada dispositivo.
2. En Supabase → **Project Settings → Edge Functions → Secrets**, configura `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (por ejemplo, `mailto:soporte@tu-dominio`). La clave privada no debe ir en `index.html` ni en el repositorio.
3. El emisor está preparado como Supabase Edge Function `send-web-order-push` en el repositorio de la tienda. Despliégalo y configura el Database Webhook `public.web_orders` → `INSERT` con cabecera `x-webhook-secret`; añade el mismo secreto como `WEB_ORDER_PUSH_WEBHOOK_SECRET` en Edge Function Secrets. La migración mantiene un registro idempotente por pedido/dispositivo, y el emisor valida los endpoints y elimina suscripciones expiradas.

La clave VAPID pública se configura en el meta `web-push-vapid-public-key` de `index.html`; las claves `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` van en secretos de Edge Function. No se ha desplegado el emisor ni configurado el webhook: todavía requieren acceso autenticado al proyecto Supabase.

Se requiere HTTPS; en iPhone, una PWA instalada y una versión compatible de iOS. La ruta del service worker, la suscripción privada y la navegación al detalle ya están preparadas; hasta desplegar ese emisor no habrá avisos push cuando la app esté cerrada.

## Migración de unificación central
1. En el proyecto Supabase, ejecuta primero `supabase.sql`, después `supabase-web-orders.sql` y finalmente `supabase-unification.sql`.
2. La migración conserva los datos existentes, agrega variantes por talla/color, movimientos de inventario, roles, sincronización web y ventas locales atómicas. No elimina tablas ni productos anteriores.
3. Los únicos usuarios son los dos socios: la aplicación y la migración los configuran ambos como administradores con acceso completo. No es necesario crear roles separados ni ocultar secciones.
4. Los productos publicados usan `store_product_id`, categoría, descripción, fotografía, talla y variantes. Al guardar o desactivar un producto, el trigger actualiza `web_store_catalog` y la tienda.
5. Las ventas locales usan la función RPC `create_local_sale`; bloquean la variante y impiden stock negativo. Los pedidos web y sus cancelaciones también concilian las variantes centrales.

## Publicación
Sube todos los archivos de esta carpeta a un hosting HTTPS estático como Vercel, Netlify, Cloudflare Pages o GitHub Pages. Para que la instalación PWA y el login funcionen correctamente, la URL pública debe usar HTTPS.
