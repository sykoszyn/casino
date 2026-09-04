/**
 * Traduce un mensaje crudo de Baileys (messages.upsert) a las tablas
 * contacts / conversations / messages de Supabase.
 */
function extractText(msg) {
  const m = msg.message;
  if (!m) return { text: null, type: 'other' };
  if (m.conversation) return { text: m.conversation, type: 'text' };
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text, type: 'text' };
  if (m.imageMessage) return { text: m.imageMessage.caption || '', type: 'image' };
  if (m.videoMessage) return { text: m.videoMessage.caption || '', type: 'video' };
  if (m.audioMessage) return { text: '', type: 'audio' };
  if (m.documentMessage) return { text: m.documentMessage.fileName || '', type: 'document' };
  if (m.stickerMessage) return { text: '', type: 'sticker' };
  return { text: null, type: 'other' };
}

async function handleIncomingMessage(supabase, projectId, instanceId, msg) {
  try {
    const jid = msg.key.remoteJid;
    if (!jid || jid === 'status@broadcast') return;

    const fromMe = !!msg.key.fromMe;
    const { text, type } = extractText(msg);
    const pushName = msg.pushName || null;

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .upsert(
        {
          project_id: projectId,
          whatsapp_instance_id: instanceId,
          wa_id: jid,
          name: pushName,
          phone_number: jid.split('@')[0],
        },
        { onConflict: 'project_id,wa_id', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (contactError) throw contactError;

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert(
        {
          project_id: projectId,
          whatsapp_instance_id: instanceId,
          contact_id: contact.id,
          channel: 'wa',
        },
        { onConflict: 'whatsapp_instance_id,contact_id', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (convError) throw convError;

    const { error: msgError } = await supabase.from('messages').insert({
      project_id: projectId,
      conversation_id: conversation.id,
      whatsapp_instance_id: instanceId,
      wa_message_id: msg.key.id,
      direction: fromMe ? 'outbound' : 'inbound',
      sender_name: fromMe ? 'Nosotros' : pushName,
      content: text,
      message_type: type,
      status: 'delivered',
      raw: msg,
      created_at: msg.messageTimestamp
        ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });

    if (msgError) throw msgError;
  } catch (err) {
    console.error('[messages] error procesando mensaje entrante:', err.message);
  }
}

module.exports = { handleIncomingMessage };
