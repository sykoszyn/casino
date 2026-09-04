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
-- 9. SEED DATA — datos de prueba realistas
-- ----------------------------------------------------------------------------
insert into public.projects (name, slug, description, status)
values
  ('iPhonixAr', 'iphonixar', 'Venta y reparación de iPhones — atención por WhatsApp/IG', 'active'),
  ('Joker Ganamos', 'joker-ganamos', 'Casa de apuestas online — carga de fichas y soporte', 'active')
on conflict (slug) do nothing;

insert into public.whatsapp_instances (project_id, name, phone_number, connection_type, status, last_connected_at)
select p.id, v.name, v.phone_number, v.connection_type, v.status,
       case when v.status = 'connected' then now() - interval '2 hours' else null end
from public.projects p
join (values
  ('iphonixar', 'Ventas iPhonixAr', '5491122334455', 'qr', 'connected'),
  ('iphonixar', 'Soporte técnico', '5491122334466', 'qr', 'qr_pending'),
  ('joker-ganamos', '3000 común con publi', '5491125820443', 'pairing_code', 'connected'),
  ('joker-ganamos', 'Buss 35 con publi', '5491125822821', 'qr', 'error')
) as v(slug, name, phone_number, connection_type, status)
  on p.slug = v.slug
on conflict do nothing;

insert into public.contacts (project_id, whatsapp_instance_id, wa_id, name, phone_number)
select wi.project_id, wi.id, c.wa_id, c.name, c.phone_number
from public.whatsapp_instances wi
join public.projects p on p.id = wi.project_id
join (values
  ('iphonixar', 'Ventas iPhonixAr', '5491133445566@s.whatsapp.net', 'Gustavo', '5491133445566'),
  ('joker-ganamos', '3000 común con publi', '5491126208330@s.whatsapp.net', 'ivan2308z R', '5491126208330'),
  ('joker-ganamos', '3000 común con publi', '5491126208331@s.whatsapp.net', 'Abel0309z J', '5491126208331')
) as c(slug, instance_name, wa_id, name, phone_number)
  on p.slug = c.slug and wi.name = c.instance_name
on conflict (project_id, wa_id) do nothing;

insert into public.conversations (project_id, whatsapp_instance_id, contact_id, channel, last_message_preview, last_message_at, unread_count)
select ct.project_id, ct.whatsapp_instance_id, ct.id, 'wa', m.preview, now() - m.age, m.unread
from public.contacts ct
join (values
  ('5491133445566@s.whatsapp.net', 'Hola, quiero cotizar un iPhone 13', interval '10 minutes', 1),
  ('5491126208330@s.whatsapp.net', 'Gracias!', interval '3 minutes', 0),
  ('5491126208331@s.whatsapp.net', 'Felicidades premio abonado!', interval '25 minutes', 0)
) as m(wa_id, preview, age, unread)
  on ct.wa_id = m.wa_id
on conflict (whatsapp_instance_id, contact_id) do nothing;

insert into public.messages (project_id, conversation_id, whatsapp_instance_id, direction, sender_name, content, message_type, status, created_at)
select c.project_id, c.id, c.whatsapp_instance_id, m.direction, m.sender_name, m.content, 'text', 'delivered', now() - m.age
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
join (values
  ('5491133445566@s.whatsapp.net', 'inbound',  'Gustavo',     'Hola, quiero cotizar un iPhone 13', interval '10 minutes'),
  ('5491126208330@s.whatsapp.net', 'inbound',  'ivan2308z R', 'Ya hice el depósito', interval '5 minutes'),
  ('5491126208330@s.whatsapp.net', 'outbound', 'Bot',         'Perfecto, en breve acreditamos', interval '4 minutes'),
  ('5491126208330@s.whatsapp.net', 'inbound',  'ivan2308z R', 'Gracias!', interval '3 minutes'),
  ('5491126208331@s.whatsapp.net', 'inbound',  'Abel0309z J', 'Felicidades premio abonado!', interval '25 minutes')
) as m(wa_id, direction, sender_name, content, age)
  on ct.wa_id = m.wa_id
order by m.age desc;
