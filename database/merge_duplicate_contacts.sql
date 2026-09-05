-- ============================================================================
-- Fusiona contactos duplicados de la misma sucursal que tienen el mismo
-- phone_number (mismo número real) pero quedaron como filas separadas —
-- pasaba porque WhatsApp a veces identifica a un contacto por un LID en vez
-- del número real, y no todos los mensajes traían el número real (ya
-- arreglado para que no vuelva a pasar). Correr UNA vez en el SQL Editor.
--
-- Para cada grupo de contactos duplicados (mismo project_id + phone_number):
--   - se queda con el contacto más viejo (el que ya venías usando/renombrando)
--   - le mueve las conversaciones de los duplicados
--   - si el contacto que queda ya tenía conversación en esa misma línea,
--     fusiona los mensajes ahí en vez de dejar dos conversaciones
--   - borra los contactos duplicados
--
-- No toca contactos sin phone_number (grupos) ni contactos que no tengan
-- ningún duplicado.
-- ============================================================================
do $$
declare
  dup record;
  keeper_id uuid;
  existing_conv_id uuid;
  dup_conv record;
begin
  for dup in
    select project_id, phone_number, array_agg(id order by created_at) as contact_ids
    from public.contacts
    where phone_number is not null and phone_number <> ''
    group by project_id, phone_number
    having count(*) > 1
  loop
    keeper_id := dup.contact_ids[1];

    for dup_conv in
      select * from public.conversations
      where contact_id = any(dup.contact_ids[2:array_length(dup.contact_ids, 1)])
    loop
      select id into existing_conv_id
      from public.conversations
      where contact_id = keeper_id and whatsapp_instance_id = dup_conv.whatsapp_instance_id;

      if existing_conv_id is not null then
        -- el contacto que queda ya tenía conversación en esa línea: movemos los mensajes ahí
        update public.messages set conversation_id = existing_conv_id where conversation_id = dup_conv.id;
        update public.conversations c
           set last_message_at = greatest(coalesce(c.last_message_at, 'epoch'::timestamptz), coalesce(dup_conv.last_message_at, 'epoch'::timestamptz)),
               last_message_preview = case
                 when dup_conv.last_message_at is not null and (c.last_message_at is null or dup_conv.last_message_at > c.last_message_at)
                   then dup_conv.last_message_preview
                 else c.last_message_preview
               end,
               unread_count = c.unread_count + dup_conv.unread_count
         where c.id = existing_conv_id;
        delete from public.conversations where id = dup_conv.id;
      else
        -- el contacto que queda no tenía conversación en esa línea todavía: se la asignamos directo
        update public.conversations set contact_id = keeper_id where id = dup_conv.id;
      end if;
    end loop;

    delete from public.contacts where id = any(dup.contact_ids[2:array_length(dup.contact_ids, 1)]);
  end loop;
end $$;
