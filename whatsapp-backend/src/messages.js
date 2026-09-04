const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const MEDIA_BUCKET = 'media';

// proto.WebMessageInfo.Status: ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5
const WA_STATUS_MAP = {
  0: 'failed',
  1: 'pending',
  2: 'sent',
  3: 'delivered',
  4: 'read',
  5: 'read',
};

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

/**
 * Traduce un mensaje crudo de Baileys (messages.upsert) a las tablas
 * contacts / conversations / messages de Supabase, bajando y resubiendo la
 * imagen/video/audio a Supabase Storage cuando corresponde.
 */
function extractContent(msg) {
  const m = msg.message;
  if (!m) return { text: null, type: 'other', mimetype: null };
  if (m.conversation) return { text: m.conversation, type: 'text', mimetype: null };
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text, type: 'text', mimetype: null };
  if (m.imageMessage) return { text: m.imageMessage.caption || '', type: 'image', mimetype: m.imageMessage.mimetype };
  if (m.videoMessage) return { text: m.videoMessage.caption || '', type: 'video', mimetype: m.videoMessage.mimetype };
  if (m.audioMessage) return { text: '', type: 'audio', mimetype: m.audioMessage.mimetype };
  if (m.documentMessage) return { text: m.documentMessage.fileName || '', type: 'document', mimetype: m.documentMessage.mimetype };
  if (m.stickerMessage) return { text: '', type: 'sticker', mimetype: m.stickerMessage.mimetype };
  return { text: null, type: 'other', mimetype: null };
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

async function uploadMedia(supabase, sock, msg, projectId, instanceId, type, mimetype) {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    const ext = EXT_BY_MIME[mimetype] || type;
    const path = `${projectId}/${instanceId}/${msg.key.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, buffer, { contentType: mimetype || 'application/octet-stream', upsert: true });

    if (uploadError) {
      console.error('[messages] error subiendo media a storage:', uploadError.message);
      return null;
    }

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error('[messages] error descargando media de WhatsApp:', err.message);
    return null;
  }
}

async function handleIncomingMessage(supabase, sock, projectId, instanceId, msg) {
  try {
    const jid = msg.key.remoteJid;
    if (!jid || jid === 'status@broadcast') return;

    const fromMe = !!msg.key.fromMe;
    const { text, type, mimetype } = extractContent(msg);
    const pushName = msg.pushName || null;

    let mediaUrl = null;
    if (MEDIA_TYPES.has(type)) {
      mediaUrl = await uploadMedia(supabase, sock, msg, projectId, instanceId, type, mimetype);
    }

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

    // upsert (no insert) + el unique constraint de (whatsapp_instance_id, wa_message_id):
    // Baileys puede emitir el mismo mensaje más de una vez (eco de un mensaje
    // propio, reintentos, sync), y así no queda duplicado en el chat.
    const { error: msgError } = await supabase.from('messages').upsert(
      {
        project_id: projectId,
        conversation_id: conversation.id,
        whatsapp_instance_id: instanceId,
        wa_message_id: msg.key.id,
        direction: fromMe ? 'outbound' : 'inbound',
        sender_name: fromMe ? 'Nosotros' : pushName,
        content: text,
        message_type: type,
        media_url: mediaUrl,
        status: fromMe ? 'sent' : 'delivered',
        raw: msg,
        created_at: msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString(),
      },
      { onConflict: 'whatsapp_instance_id,wa_message_id', ignoreDuplicates: true }
    );

    if (msgError) throw msgError;
  } catch (err) {
    console.error('[messages] error procesando mensaje entrante:', err.message);
  }
}

/** Actualiza el estado (sent/delivered/read) de un mensaje ya guardado según las confirmaciones de WhatsApp. */
async function updateMessageStatus(supabase, instanceId, waMessageId, waStatus) {
  const status = WA_STATUS_MAP[waStatus];
  if (!status || !waMessageId) return;

  await supabase
    .from('messages')
    .update({ status })
    .eq('whatsapp_instance_id', instanceId)
    .eq('wa_message_id', waMessageId)
    // nunca "retroceder" un estado (ej: no pisar "read" con un "delivered" que llegó tarde)
    .not('status', 'in', status === 'read' ? '()' : '(read)');
}

module.exports = { handleIncomingMessage, updateMessageStatus };
