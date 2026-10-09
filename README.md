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
Los productos, ventas y gastos se pueden registrar en colones costarricenses (CRC) o dólares (USD). En Inventario, el botón COSTO permite cambiar el monto y la moneda del costo unitario de productos ya existentes sin alterar su stock ni su precio de venta. El costo unitario tiene una moneda independiente de la moneda del precio de venta. En el panel, el costo de mercadería permite ver el valor del inventario en CRC o USD, convirtiendo con la tasa fija de ₡460 por US$1. Cada venta conserva la moneda que se elija y los abonos usan la moneda de esa venta. La gráfica del panel también permite elegir la moneda para mostrar las ventas de los últimos siete días. Los datos USD importados del sistema anterior se mantienen en USD y ya no se convierten automáticamente al iniciar sesión. Los registros que una versión anterior ya convirtió a CRC permanecen como están; no se pueden reconstruir automáticamente sus valores originales.

Desde el panel puedes agregar o quitar gastos y clientes, agregar productos, ajustar el stock (sumar o retirar unidades), retirar productos del inventario y registrar o quitar abonos. Al retirar un producto, se conserva el importe y la cantidad de las ventas previas. Al quitar un cliente asociado a ventas, esas ventas y abonos se conservan sin el vínculo al cliente.

## Publicación
Sube todos los archivos de esta carpeta a un hosting HTTPS estático como Vercel, Netlify, Cloudflare Pages o GitHub Pages. Para que la instalación PWA y el login funcionen correctamente, la URL pública debe usar HTTPS.
