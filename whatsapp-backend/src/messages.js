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
 * pasa eso, Baileys manda el número real en key.senderPn — pero no todos los
 * mensajes de ese mismo LID lo traen. Si resolviéramos "a veces sí, a veces
 * no", el mismo contacto terminaría con dos wa_id distintos → dos contactos
 * y dos chats duplicados para la misma persona. Por eso la primera vez que
 * aparece el número real lo guardamos en lid_mappings, y de ahí en más
 * siempre usamos ese mismo número para ese LID, lo traiga o no el mensaje.
 */
async function resolveChatIdentity(supabase, msg) {
  const rawJid = msg.key.remoteJid;
  const isGroup = rawJid.endsWith('@g.us');

  if (isGroup) {
    return { jid: rawJid, phoneNumber: null, isGroup: true };
  }

  if (!rawJid.endsWith('@lid')) {
    return { jid: rawJid, phoneNumber: rawJid.split('@')[0], isGroup: false };
  }

  // Todo lo que toca lid_mappings va en su propio try/catch: es una mejora
  // sobre el caso @lid, no puede tumbar el guardado del mensaje si esa tabla
  // todavía no existe (falta correr el schema.sql) o falla por lo que sea.
  if (msg.key.senderPn) {
    try {
      await supabase.from('lid_mappings').upsert({ lid: rawJid, phone_jid: msg.key.senderPn }, { onConflict: 'lid' });
    } catch (err) {
      console.error('[messages] no se pudo guardar el mapeo de LID (¿falta correr schema.sql?):', err.message);
    }
    return { jid: msg.key.senderPn, phoneNumber: msg.key.senderPn.split('@')[0], isGroup: false };
  }

  try {
    const { data: mapping } = await supabase.from('lid_mappings').select('phone_jid').eq('lid', rawJid).maybeSingle();
    if (mapping?.phone_jid) {
      return { jid: mapping.phone_jid, phoneNumber: mapping.phone_jid.split('@')[0], isGroup: false };
    }
  } catch (err) {
    console.error('[messages] no se pudo leer el mapeo de LID (¿falta correr schema.sql?):', err.message);
  }

  // todavía no sabemos el número real de este LID: lo usamos tal cual: si
  // más adelante aparece el número real, ese mensaje empieza a usarlo y
  // este contacto queda vinculado a partir de ese momento.
  return { jid: rawJid, phoneNumber: rawJid.split('@')[0], isGroup: false };
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

/**
 * Crea o actualiza el contacto y su conversación para una línea dada. Común a
 * Baileys y a la API oficial de Meta, así los dos caminos escriben las
 * mismas tablas de la misma forma (el Inbox no necesita saber de dónde vino
 * el mensaje).
 */
async function upsertContactAndConversation(supabase, { projectId, instanceId, jid, phoneNumber, contactName }) {
  // No usamos upsert acá a propósito: si el contacto ya existe y alguien le
  // puso un nombre a mano, no lo queremos pisar con el nombre de WhatsApp en
  // cada mensaje nuevo.
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

  return { contactId: contact.id, conversationId: conversation.id };
}

/**
 * Inserta un mensaje. Usa upsert + el unique constraint de
 * (whatsapp_instance_id, wa_message_id) para no duplicar un mensaje que
 * llegue más de una vez (eco de un mensaje propio, reintentos, sync inicial).
 */
async function insertMessage(supabase, payload) {
  const { error } = await supabase.from('messages').upsert(
    {
      project_id: payload.projectId,
      conversation_id: payload.conversationId,
      whatsapp_instance_id: payload.instanceId,
      wa_message_id: payload.waMessageId,
      direction: payload.direction,
      sender_name: payload.senderName,
      content: payload.content,
      message_type: payload.messageType,
      media_url: payload.mediaUrl,
      status: payload.status,
      raw: payload.raw,
      created_at: payload.createdAt,
    },
    { onConflict: 'whatsapp_instance_id,wa_message_id', ignoreDuplicates: true }
  );
  if (error) throw error;
}

async function handleIncomingMessage(supabase, sock, projectId, instanceId, msg) {
  try {
    const rawJid = msg.key.remoteJid;
    if (!rawJid || rawJid === 'status@broadcast') return;

    const { jid, phoneNumber, isGroup } = await resolveChatIdentity(supabase, msg);

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

    const { conversationId } = await upsertContactAndConversation(supabase, {
      projectId,
      instanceId,
      jid,
      phoneNumber,
      contactName,
    });

    await insertMessage(supabase, {
      projectId,
      conversationId,
      instanceId,
      waMessageId: msg.key.id,
      direction: fromMe ? 'outbound' : 'inbound',
      senderName: fromMe ? 'Nosotros' : pushName,
      content: text,
      messageType: type,
      mediaUrl,
      status: fromMe ? 'sent' : 'delivered',
      raw: msg,
      createdAt: msg.messageTimestamp
        ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });
  } catch (err) {
    console.error('[messages] error procesando mensaje entrante:', err.message);
  }
}

const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Actualiza el estado (sent/delivered/read/failed) de un mensaje ya guardado.
 * La confirmación puede llegar unos milisegundos antes de que termine de
 * guardarse el mensaje (todavía se está subiendo el contacto/conversación),
 * así que reintenta una vez corto antes de rendirse.
 */
async function setMessageStatus(supabase, instanceId, waMessageId, status, attempt = 0) {
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
      return setMessageStatus(supabase, instanceId, waMessageId, status, attempt + 1);
    }
    return;
  }

  // nunca "retroceder" un estado (ej: no pisar "read" con un "delivered" que llegó después)
  if (STATUS_RANK[status] <= STATUS_RANK[existing.status]) return;

  const { error: updateError } = await supabase.from('messages').update({ status }).eq('id', existing.id);
  if (updateError) throw updateError;
}

/** Variante para Baileys: traduce el código numérico de proto.WebMessageInfo.Status. */
async function updateMessageStatus(supabase, instanceId, waMessageId, waStatusCode) {
  const status = WA_STATUS_MAP[waStatusCode];
  if (!status) return;
  return setMessageStatus(supabase, instanceId, waMessageId, status);
}

module.exports = {
  handleIncomingMessage,
  updateMessageStatus,
  setMessageStatus,
  upsertContactAndConversation,
  insertMessage,
};
