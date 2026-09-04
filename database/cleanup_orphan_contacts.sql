-- ============================================================================
-- Limpieza única de contactos huérfanos: quedaron así porque al borrar una
-- línea (antes de este fix) el contacto no se borraba solo, solo se le
-- vaciaba whatsapp_instance_id. Correr UNA vez en el SQL Editor de Supabase.
--
-- Borra únicamente contactos sin ninguna línea asignada Y sin ninguna
-- conversación (si el contacto sigue teniendo una conversación viva en otra
-- línea, no lo toca).
-- ============================================================================
delete from public.contacts c
where c.whatsapp_instance_id is null
  and not exists (
    select 1 from public.conversations conv where conv.contact_id = c.id
  );
