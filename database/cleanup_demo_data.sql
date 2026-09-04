-- ============================================================================
-- Limpieza única de las líneas/contactos de prueba que trajo la seed
-- original (iPhonixAr / Joker Ganamos). Correr UNA vez en el SQL Editor de
-- Supabase. No toca proyectos, líneas, contactos ni mensajes reales: borra
-- puntualmente por nombre/número exacto de la demo.
-- ============================================================================

-- Borra las líneas demo (arrastra en cascada sus conversaciones y mensajes,
-- pero NO los contactos: esos quedan con whatsapp_instance_id en null).
delete from public.whatsapp_instances
where name in ('Ventas iPhonixAr', 'Soporte técnico', '3000 común con publi', 'Buss 35 con publi');

-- Borra los contactos de prueba asociados (por su wa_id exacto).
delete from public.contacts
where wa_id in (
  '5491133445566@s.whatsapp.net',
  '5491126208330@s.whatsapp.net',
  '5491126208331@s.whatsapp.net'
);
