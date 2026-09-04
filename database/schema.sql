-- ============================================================================
-- WhatsApp CRM Multi-Tenant — Supabase schema
-- Pilar 1: Base de datos y Auth
--
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> pegar y correr.
-- Es idempotente (usa IF NOT EXISTS / DROP POLICY IF EXISTS) para poder
-- volver a correrlo sin romper nada.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. PROJECTS  (cada "proyecto" = una sucursal / negocio / cliente)
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  status      text not null default 'active'
              check (status in ('active', 'inactive', 'archived')),
  owner_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.projects is 'Tenants / sucursales. Todo lo demás cuelga de project_id.';

-- ----------------------------------------------------------------------------
-- 2. WHATSAPP_INSTANCES (líneas de WhatsApp conectadas vía Baileys)
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_instances (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  name               text not null default 'Nueva línea',
  phone_number       text,
  connection_type    text not null default 'qr'
                     check (connection_type in ('qr', 'pairing_code')),
  pairing_code       text,
  qr_code            text,                 -- data URL del QR vigente (transitorio)
  status             text not null default 'disconnected'
                     check (status in ('disconnected', 'connecting', 'qr_pending', 'connected', 'error')),
  error_message      text,
  session_data       jsonb not null default '{}'::jsonb,  -- creds/keys de Baileys (useMultiFileAuthState serializado)
  last_connected_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.whatsapp_instances.session_data is 'Persistencia de la sesión de Baileys (auth creds) para no re-escanear el QR en cada reinicio.';

create index if not exists idx_whatsapp_instances_project on public.whatsapp_instances(project_id);

-- ----------------------------------------------------------------------------
-- 3. CONTACTS (clientes finales que escriben por WhatsApp/IG/FB)
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  whatsapp_instance_id  uuid references public.whatsapp_instances(id) on delete set null,
  wa_id                 text not null,         -- jid de WhatsApp, ej 5491126208330@s.whatsapp.net
  name                  text,
  phone_number          text,
  avatar_url            text,
  tags                  text[] not null default '{}',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (project_id, wa_id)
);

create index if not exists idx_contacts_project on public.contacts(project_id);

-- ----------------------------------------------------------------------------
-- 4. CONVERSATIONS (un hilo/chat por contacto y línea; agrupa mensajes)
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  whatsapp_instance_id  uuid not null references public.whatsapp_instances(id) on delete cascade,
  contact_id            uuid not null references public.contacts(id) on delete cascade,
  channel               text not null default 'wa' check (channel in ('wa', 'ig', 'fb')),
  last_message_preview  text,
  last_message_at       timestamptz,
  unread_count          int not null default 0,
  archived              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (whatsapp_instance_id, contact_id)
);

create index if not exists idx_conversations_project on public.conversations(project_id);
create index if not exists idx_conversations_last_message on public.conversations(project_id, last_message_at desc);

-- ----------------------------------------------------------------------------
-- 5. MESSAGES
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  conversation_id       uuid not null references public.conversations(id) on delete cascade,
  whatsapp_instance_id  uuid not null references public.whatsapp_instances(id) on delete cascade,
  wa_message_id         text,
  direction             text not null check (direction in ('inbound', 'outbound')),
  sender_name           text,
  content               text,
  message_type          text not null default 'text'
                        check (message_type in ('text', 'image', 'audio', 'video', 'document', 'sticker', 'other')),
  media_url             text,
  status                text not null default 'sent'
                        check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  raw                   jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at);
create index if not exists idx_messages_project on public.messages(project_id);

-- El backend hace upsert por (whatsapp_instance_id, wa_message_id) para no
-- duplicar un mensaje si Baileys lo emite más de una vez (eco de un mensaje
-- propio, reintentos, sync inicial). NULLs no chocan entre sí, así que no
-- afecta a filas viejas sin wa_message_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_instance_wa_message_id_key'
  ) then
    begin
      alter table public.messages
        add constraint messages_instance_wa_message_id_key unique (whatsapp_instance_id, wa_message_id);
    exception when unique_violation then
      raise notice 'Hay wa_message_id duplicados en messages: no se pudo crear el unique constraint, revisar manualmente.';
    end;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Trigger genérico para mantener updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_whatsapp_instances_updated_at on public.whatsapp_instances;
create trigger trg_whatsapp_instances_updated_at before update on public.whatsapp_instances
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- Al insertar un mensaje, actualiza el preview/última fecha/no leídos de la conversación
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
as $$
declare
  preview text;
begin
  preview := case
    when new.message_type = 'image' then coalesce(nullif(new.content, ''), '📷 Foto')
    when new.message_type = 'video' then coalesce(nullif(new.content, ''), '🎥 Video')
    when new.message_type = 'audio' then '🎤 Audio'
    when new.message_type = 'document' then coalesce(nullif(new.content, ''), '📎 Documento')
    when new.message_type = 'sticker' then '🖼️ Sticker'
    else coalesce(new.content, '')
  end;

  update public.conversations
     set last_message_preview = left(preview, 200),
         last_message_at      = new.created_at,
         unread_count         = case when new.direction = 'inbound'
                                      then unread_count + 1
                                      else unread_count end,
         updated_at           = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation on public.messages;
create trigger trg_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
--
-- Modelo: la app tiene una única cuenta "owner" (o varios usuarios de
-- confianza) autenticada con Supabase Auth. Cualquier usuario autenticado
-- puede operar sobre los proyectos y sus datos (así funciona hoy Atriva:
-- un solo login que administra varias sucursales). El aislamiento por
-- project_id lo garantiza el modelo relacional (todo FK a projects con
-- on delete cascade) y el filtrado explícito por project_id en cada query
-- del frontend/backend. El acceso anónimo (rol "anon") queda bloqueado por
-- completo: sin sesión, cero filas.
--
-- El backend de Baileys (whatsapp-backend) usa la service_role key, que
-- siempre bypasea RLS, así que puede escribir sesiones/mensajes sin login.
-- ----------------------------------------------------------------------------
alter table public.projects            enable row level security;
alter table public.whatsapp_instances   enable row level security;
alter table public.contacts             enable row level security;
alter table public.conversations        enable row level security;
alter table public.messages             enable row level security;

drop policy if exists "authenticated_all_projects" on public.projects;
create policy "authenticated_all_projects" on public.projects
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_whatsapp_instances" on public.whatsapp_instances;
create policy "authenticated_all_whatsapp_instances" on public.whatsapp_instances
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_contacts" on public.contacts;
create policy "authenticated_all_contacts" on public.contacts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_conversations" on public.conversations;
create policy "authenticated_all_conversations" on public.conversations
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_all_messages" on public.messages;
create policy "authenticated_all_messages" on public.messages
  for all
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- 7. REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_instances'
  ) then
    alter publication supabase_realtime add table public.whatsapp_instances;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 8. STORAGE — bucket público para las fotos/videos que se envían y reciben
-- por WhatsApp. Es público para que las imágenes se puedan mostrar en el
-- chat con un <img src> directo, sin pasar por auth. Las rutas dentro del
-- bucket van organizadas por proyecto/línea ("<project_id>/<instance_id>/...")
-- pero al ser un bucket público cualquiera con el link exacto puede verla
-- (igual que casi cualquier CDN de imágenes de chat).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "authenticated_upload_media" on storage.objects;
create policy "authenticated_upload_media" on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'media');

drop policy if exists "authenticated_delete_media" on storage.objects;
create policy "authenticated_delete_media" on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'media');

-- ----------------------------------------------------------------------------
-- 9. (sin seed data)
--
-- La versión inicial de este archivo insertaba proyectos/líneas/contactos de
-- prueba (iPhonixAr, Joker Ganamos). Se sacó a propósito: la app ya se usa en
-- producción y la creación de proyectos/líneas se hace desde la UI, así que
-- mantener un seed acá solo generaba el riesgo de resucitar líneas falsas
-- cada vez que se vuelve a correr este script. Si en algún momento se borró
-- esa data de prueba manualmente, no hace falta hacer nada más: no se vuelve
-- a crear sola.
-- ----------------------------------------------------------------------------
