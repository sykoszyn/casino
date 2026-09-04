# NexoWA CRM — CRM omnicanal multi-tenant para WhatsApp

CRM estilo "Atriva": administrá varios proyectos/sucursales, conectá tantas líneas de WhatsApp
como necesites (vía QR o código de vinculación) y atendé todo desde un inbox en tiempo real.
Stack 100% gratuito: Next.js + Supabase (Postgres/Auth/Realtime free tier) + Baileys (WhatsApp
no oficial, sin costo de API).

## Arquitectura (3 pilares)

```
casino/
├── database/schema.sql        # Pilar 1: tablas, RLS, realtime y seed data de Supabase
├── whatsapp-backend/          # Pilar 2: microservicio Node + Baileys (24/7)
│   ├── server.js              # API Express (connect/disconnect/pairing-code/send)
│   └── src/
│       ├── instanceManager.js # ciclo de vida de cada sesión de Baileys
│       ├── supabaseAuthState.js # persiste creds/keys de Baileys en Supabase (sin disco)
│       └── messages.js        # inserta contactos/conversaciones/mensajes entrantes
├── app/                       # Pilar 3: Next.js App Router (frontend)
│   ├── login/                 # auth con Supabase (email + password)
│   ├── page.tsx                # "Tus proyectos"
│   └── [slug]/                 # layout con sidebar + vistas por proyecto
│       ├── overview, paginas, lineas, inbox, contactos, ventas, analytics, configuracion
├── components/                 # UI (shadcn-style) + lógica de líneas/inbox
└── lib/                        # clientes de Supabase, tipos, helper del backend
```

## 1. Base de datos (Supabase)

1. Entrá al proyecto de Supabase → **SQL Editor** → *New query*.
2. Pegá el contenido de `database/schema.sql` y ejecutalo. Es idempotente, lo podés
   volver a correr sin romper nada.
3. Esto crea `projects`, `whatsapp_instances`, `contacts`, `conversations`, `messages`,
   activa RLS (solo usuarios autenticados pueden leer/escribir), agrega las tablas a
   `supabase_realtime` y carga datos de prueba de **iPhonixAr** y **Joker Ganamos**.
4. En **Authentication → Providers**, dejá habilitado Email/Password (viene por defecto).
   Si tu proyecto pide confirmación de email y no querés configurarla ahora, podés
   desactivar "Confirm email" en Authentication → Settings para probar más rápido.

## 2. Backend de WhatsApp (`whatsapp-backend/`)

Ya está configurado con tus credenciales en `whatsapp-backend/.env` (URL + **service role
key** — nunca se commitea, está en `.gitignore`).

```bash
cd whatsapp-backend
npm install
npm start        # o: npm run dev (reinicia solo con --watch)
```

Queda escuchando en `http://localhost:4000`. Al arrancar, reanuda automáticamente
cualquier instancia que ya estuviera `connected`/`connecting`/`qr_pending`, así que
sobrevive a reinicios sin perder sesión (las credenciales de Baileys se guardan en la
columna `session_data` de `whatsapp_instances`, no en disco).

**Endpoints:**
- `POST /instances/:id/connect` → arranca la sesión y empieza a publicar el QR en `whatsapp_instances.qr_code`.
- `POST /instances/:id/pairing-code` `{ phoneNumber }` → alternativa sin QR (código de 8 dígitos).
- `POST /instances/:id/disconnect` — corta la sesión sin perder las credenciales.
- `DELETE /instances/:id` — logout completo (borra la sesión, hay que re-escanear).
- `POST /instances/:id/send` `{ to, text }` — enviar un mensaje (lo usa el Inbox).

Para producción 24/7 gratis podés desplegarlo en **Render** o **Railway** (free tier):
subí este directorio como servicio Node, seteá las mismas variables de entorno de
`.env.example` y actualizá `NEXT_PUBLIC_WHATSAPP_BACKEND_URL` en el frontend con esa URL.

## 3. Frontend (Next.js)

Ya está configurado con `.env.local` (URL + **anon key**, es pública/segura para el
navegador).

```bash
npm install
npm run dev       # http://localhost:3000
```

1. Entrá a `http://localhost:3000`, te va a redirigir a `/login`.
2. Creá una cuenta (email + password) — es la cuenta "owner" que administra todos los
   proyectos, igual que en Atriva.
3. Vas a ver los proyectos `iPhonixAr` y `Joker Ganamos` ya cargados. Entrá a uno,
   andá a **Líneas** y probá **+ Crear línea**: se abre el modal, el backend genera el
   QR y en cuanto lo escaneás la tarjeta pasa a "Conectada" solo (Supabase Realtime).
4. En **Inbox** vas a ver las conversaciones en 3 columnas (lista / chat / datos del
   contacto), todo en tiempo real.

## Variables de entorno

| Archivo | Variable | Uso |
|---|---|---|
| `.env.local` (raíz) | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `.env.local` (raíz) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Key pública (RLS la protege) |
| `.env.local` (raíz) | `NEXT_PUBLIC_WHATSAPP_BACKEND_URL` | URL del microservicio Baileys |
| `whatsapp-backend/.env` | `SUPABASE_URL` | URL del proyecto Supabase |
| `whatsapp-backend/.env` | `SUPABASE_SERVICE_ROLE_KEY` | Key privada, bypassa RLS — **nunca** exponer al navegador |

## Notas de seguridad

- El `service_role key` que me pasaste queda **solo** en `whatsapp-backend/.env`, que está
  en `.gitignore`. No lo pongas nunca en el frontend ni lo subas a git.
- Como me pasaste las credenciales reales en el chat, te recomiendo rotarlas desde
  Supabase → Settings → API si este chat quedó en un lugar no del todo privado.
- El aislamiento entre proyectos (sucursales) es por `project_id` con `ON DELETE CASCADE`
  en cada tabla relacionada; todas las queries del frontend y del backend filtran
  explícitamente por ese campo.
