# HYPEFRIENDS BUSINESS v2 — Supabase

Aplicación PWA para ventas, abonos, inventario, clientes, gastos e historial.

## Supabase
El frontend ya viene configurado con el Project URL y la Publishable key del proyecto HYPEFRIENDS. La Publishable key es apta para navegador; no se incluye ninguna Secret key.

## Base de datos
Si las tablas todavía no están creadas, ejecuta `supabase.sql` en Supabase SQL Editor. El script usa `drop policy if exists` y comprobaciones de Realtime para evitar errores por políticas o tablas ya publicadas.

## Usuarios
Los dos socios deben existir en Supabase Authentication → Users. Ingresan con su correo y contraseña. Ambos trabajan sobre los mismos datos del negocio mediante RLS para usuarios autenticados.

## Publicación
Sube todos los archivos de esta carpeta a un hosting HTTPS estático como Vercel, Netlify, Cloudflare Pages o GitHub Pages. Para que la instalación PWA y el login funcionen correctamente, la URL pública debe usar HTTPS.
