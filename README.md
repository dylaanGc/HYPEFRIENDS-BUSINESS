# HYPEFRIENDS BUSINESS v2 — Supabase

Aplicación PWA para ventas, abonos, inventario, clientes, gastos e historial.

## Supabase
El frontend ya viene configurado con el Project URL y la Publishable key del proyecto HYPEFRIENDS. La Publishable key es apta para navegador; no se incluye ninguna Secret key.

## Base de datos
Si las tablas todavía no están creadas, ejecuta `supabase.sql` en Supabase SQL Editor. El script usa `drop policy if exists` y comprobaciones de Realtime para evitar errores por políticas o tablas ya publicadas.

## Usuarios
Los dos socios deben existir en Supabase Authentication → Users. Ingresan con su correo y contraseña. Ambos trabajan sobre los mismos datos del negocio mediante RLS para usuarios autenticados.

## Sincronización y datos anteriores
Los cambios nuevos se guardan en Supabase y se sincronizan entre dispositivos. Al iniciar sesión por primera vez en cada navegador, la app importa a Supabase los datos locales antiguos de inventario, ventas, apartados y gastos. La copia local no se elimina.

## Moneda y administración
La interfaz registra los productos, ventas, abonos y gastos nuevos en colones costarricenses (CRC). Al iniciar sesión, los registros existentes marcados como USD se convierten una sola vez a CRC usando ₡460 por US$1; la conversión es idempotente y se reanuda sin duplicar importes si se interrumpe.

Desde el panel puedes agregar o quitar gastos y clientes, agregar productos, ajustar el stock (sumar o retirar unidades), retirar productos del inventario y registrar o quitar abonos. Al retirar un producto, se conserva el importe y la cantidad de las ventas previas. Al quitar un cliente asociado a ventas, esas ventas y abonos se conservan sin el vínculo al cliente.

## Publicación
Sube todos los archivos de esta carpeta a un hosting HTTPS estático como Vercel, Netlify, Cloudflare Pages o GitHub Pages. Para que la instalación PWA y el login funcionen correctamente, la URL pública debe usar HTTPS.
