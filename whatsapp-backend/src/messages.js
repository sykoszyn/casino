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

const groupNameCache = new Map();

async function getGroupName(sock, jid) {
  if (groupNameCache.has(jid)) return groupNameCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    const name = meta?.subject || null;
    groupNameCache.set(jid, name);
    return name;
  } catch (err) {
    console.error(`[messages] no se pudo leer el nombre del grupo ${jid}:`, err.message);
    return null;
  }
}

/**
 * WhatsApp identifica a algunos contactos con un "LID" (identificador
 * alternativo, ligado a privacidad) en vez del número de teléfono real, así
 * que remoteJid puede terminar en "@lid" en vez de "@s.whatsapp.net". Cuando
 * pasa eso, Baileys igual manda el número real en key.senderPn — sin esto,
 * el contacto queda guardado con un ID interno sin sentido en vez del
 * teléfono de la persona.
 */
function resolveChatIdentity(msg) {
  const rawJid = msg.key.remoteJid;
  const isGroup = rawJid.endsWith('@g.us');

  if (isGroup) {
    return { jid: rawJid, phoneNumber: null, isGroup: true };
  }

  const jid = rawJid.endsWith('@lid') && msg.key.senderPn ? msg.key.senderPn : rawJid;
  return { jid, phoneNumber: jid.split('@')[0], isGroup: false };
}

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
    const rawJid = msg.key.remoteJid;
    if (!rawJid || rawJid === 'status@broadcast') return;

    const { jid, phoneNumber, isGroup } = resolveChatIdentity(msg);

    const fromMe = !!msg.key.fromMe;
    const { text, type, mimetype } = extractContent(msg);
    // pushName es el nombre que la persona tiene puesto en su WhatsApp (o,
    // dentro de un grupo, quien mandó el mensaje puntual); si el mensaje no
    // lo trae, probamos con el nombre de negocio verificado como respaldo.
    const pushName = msg.pushName || msg.verifiedBizName || null;
    const contactName = isGroup ? await getGroupName(sock, jid) : pushName;

    let mediaUrl = null;
    if (MEDIA_TYPES.has(type)) {
      mediaUrl = await uploadMedia(supabase, sock, msg, projectId, instanceId, type, mimetype);
    }

    // No usamos upsert acá a propósito: si el contacto ya existe y alguien le
    // puso un nombre a mano, no lo queremos pisar con el pushName de WhatsApp
    // en cada mensaje nuevo.
    const { data: existingContact, error: existingContactError } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('project_id', projectId)
      .eq('wa_id', jid)
      .maybeSingle();

    if (existingContactError) throw existingContactError;

    let contact;
    if (existingContact) {
      const { data, error } = await supabase
        .from('contacts')
        .update({
          whatsapp_instance_id: instanceId,
          phone_number: phoneNumber,
          name: existingContact.name ?? contactName,
        })
        .eq('id', existingContact.id)
        .select('id')
        .single();
      if (error) throw error;
      contact = data;
    } else {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          project_id: projectId,
          whatsapp_instance_id: instanceId,
          wa_id: jid,
          name: contactName,
          phone_number: phoneNumber,
        })
        .select('id')
        .single();
      if (error) throw error;
      contact = data;
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert(
        {
          project_id: projectId,
          whatsapp_instance_id: instanceId,
          contact_id: contact.id,
          channel: 'wa',
          archived: false, // cualquier actividad nueva desarchiva el chat
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

const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Actualiza el estado (sent/delivered/read) de un mensaje ya guardado según
 * las confirmaciones de WhatsApp. La confirmación puede llegar unos
 * milisegundos antes de que termine de guardarse el mensaje (todavía se está
 * subiendo el contacto/conversación), así que reintenta una vez corto antes
 * de rendirse.
 */
async function updateMessageStatus(supabase, instanceId, waMessageId, waStatus, attempt = 0) {
  const status = WA_STATUS_MAP[waStatus];
  if (!status || !waMessageId) return;

  const { data: existing, error } = await supabase
    .from('messages')
    .select('id, status')
    .eq('whatsapp_instance_id', instanceId)
    .eq('wa_message_id', waMessageId)
    .maybeSingle();

  if (error) throw error;

  if (!existing) {
    if (attempt < 3) {
      await sleep(500);
      return updateMessageStatus(supabase, instanceId, waMessageId, waStatus, attempt + 1);
    }
    return;
  }

  // nunca "retroceder" un estado (ej: no pisar "read" con un "delivered" que llegó después)
  if (STATUS_RANK[status] <= STATUS_RANK[existing.status]) return;

  const { error: updateError } = await supabase.from('messages').update({ status }).eq('id', existing.id);
  if (updateError) throw updateError;
}

module.exports = { handleIncomingMessage, updateMessageStatus };
