# Produccion TECONDOR

PWA independiente para tareas de planta, inventario y consumo de materiales. Usa la misma base de datos Supabase de la aplicacion administrativa, pero tiene despliegue, sesion y experiencia movil propios.

## Variables de Vercel

Configura en Production y Preview:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Son las mismas variables publicas de la aplicacion principal.

Despues de crear o actualizar estas variables, genera un nuevo despliegue de
Production: Vercel solo incorpora los valores en despliegues nuevos. No uses la
clave `service_role`; la aplicacion cliente debe usar la clave publica de
Supabase.

## Desarrollo

```bash
npm install
npm run dev
```

## Despliegue

Importa esta carpeta como un proyecto independiente en Vercel. El manifiesto, los iconos y el service worker se incluyen en el proyecto; al abrirla desde Chrome o Edge en el celular se puede instalar como aplicacion.

Las consultas y escrituras requieren conexion. Si la planta queda sin internet, la PWA muestra una pantalla sin conexion y permite reintentar cuando vuelva la red.
