const { upsertContactAndConversation, insertMessage, setMessageStatus } = require('./messages');

const GRAPH_VERSION = 'v21.0';
const MEDIA_BUCKET = 'media';
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

function graphUrl(path) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

async function graphFetch(path, accessToken, options = {}) {
  const res = await fetch(graphUrl(path), {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Error ${res.status} llamando a la API de WhatsApp`);
  }
  return data;
}

function normalizeTo(to) {
  return to.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
}

/** Valida las credenciales pidiendo los datos del número a Meta (falla si el phone_number_id o el token están mal). */
async function verifyCloudCredentials(phoneNumberId, accessToken) {
  const data = await graphFetch(`${phoneNumberId}?fields=display_phone_number,verified_name`, accessToken);
  return { displayPhoneNumber: data.display_phone_number, verifiedName: data.verified_name };
}

async function sendCloudMessage(instance, to, text) {
  return graphFetch(`${instance.cloud_phone_number_id}/messages`, instance.cloud_access_token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type: 'text',
      text: { body: text },
    }),
  });
}

async function uploadCloudMedia(instance, mediaBase64, mimeType) {
  const base64Data = mediaBase64.includes(',') ? mediaBase64.split(',')[1] : mediaBase64;
  const buffer = Buffer.from(base64Data, 'base64');

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), `media.${EXT_BY_MIME[mimeType] || 'bin'}`);

  const res = await fetch(graphUrl(`${instance.cloud_phone_number_id}/media`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${instance.cloud_access_token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'No se pudo subir el archivo a WhatsApp');
  return data.id;
}

async function sendCloudMedia(instance, to, mediaBase64, mimeType, caption) {
  const mediaId = await uploadCloudMedia(instance, mediaBase64, mimeType);
  const type = mimeType?.startsWith('video/') ? 'video' : 'image';

  return graphFetch(`${instance.cloud_phone_number_id}/messages`, instance.cloud_access_token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizeTo(to),
      type,
      [type]: { id: mediaId, caption: caption || undefined },
    }),
  });
}

async function downloadCloudMedia(instance, mediaId) {
  const meta = await graphFetch(mediaId, instance.cloud_access_token);
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${instance.cloud_access_token}` } });
  if (!fileRes.ok) throw new Error(`No se pudo descargar el archivo de Meta (status ${fileRes.status})`);
  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function extractCloudContent(msg) {
  switch (msg.type) {
    case 'text':
      return { text: msg.text?.body || '', type: 'text', mediaId: null, mimeType: null };
    case 'image':
      return { text: msg.image?.caption || '', type: 'image', mediaId: msg.image?.id, mimeType: msg.image?.mime_type };
    case 'video':
      return { text: msg.video?.caption || '', type: 'video', mediaId: msg.video?.id, mimeType: msg.video?.mime_type };
    case 'audio':
      return { text: '', type: 'audio', mediaId: msg.audio?.id, mimeType: msg.audio?.mime_type };
    case 'document':
      return { text: msg.document?.filename || '', type: 'document', mediaId: msg.document?.id, mimeType: msg.document?.mime_type };
    case 'sticker':
      return { text: '', type: 'sticker', mediaId: msg.sticker?.id, mimeType: msg.sticker?.mime_type };
    default:
      return { text: null, type: 'other', mediaId: null, mimeType: null };
  }
}

async function handleCloudWebhookMessage(supabase, instance, value, msg) {
  try {
    const jid = `${msg.from}@s.whatsapp.net`;
    const phoneNumber = msg.from;
    const contactName = value.contacts?.[0]?.profile?.name || null;
    const { text, type, mediaId, mimeType } = extractCloudContent(msg);

    let mediaUrl = null;
    if (MEDIA_TYPES.has(type) && mediaId) {
      try {
        const buffer = await downloadCloudMedia(instance, mediaId);
        const ext = EXT_BY_MIME[mimeType] || type;
        const path = `${instance.project_id}/${instance.id}/${msg.id}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(path, buffer, { contentType: mimeType || 'application/octet-stream', upsert: true });
        if (uploadError) {
          console.error('[cloudApi] error subiendo media a storage:', uploadError.message);
        } else {
          const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
          mediaUrl = data?.publicUrl ?? null;
        }
      } catch (err) {
        console.error('[cloudApi] error descargando media de Meta:', err.message);
      }
    }

    const { conversationId } = await upsertContactAndConversation(supabase, {
      projectId: instance.project_id,
      instanceId: instance.id,
      jid,
      phoneNumber,
      contactName,
    });

    await insertMessage(supabase, {
      projectId: instance.project_id,
      conversationId,
      instanceId: instance.id,
      waMessageId: msg.id,
      direction: 'inbound',
      senderName: contactName,
      content: text,
      messageType: type,
      mediaUrl,
      status: 'delivered',
      raw: msg,
      createdAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cloudApi] error procesando mensaje entrante:', err.message);
  }
}

async function handleCloudWebhookStatus(supabase, instance, status) {
  try {
    if (!status?.id || !status?.status) return;
    // Los strings de status de Meta (sent/delivered/read/failed) coinciden 1 a 1 con
    // nuestro enum de messages.status, así que no hace falta ningún mapeo.
    await setMessageStatus(supabase, instance.id, status.id, status.status);
  } catch (err) {
    console.error('[cloudApi] error actualizando estado de mensaje:', err.message);
  }
}

/** Procesa el body completo que manda el webhook de Meta (puede traer varias líneas/eventos juntos). */
async function handleCloudWebhookPayload(supabase, body) {
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: instance, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('connection_type', 'cloud_api')
        .eq('cloud_phone_number_id', phoneNumberId)
        .maybeSingle();

      if (error || !instance) {
        console.error(`[cloudApi] no se encontró ninguna línea con phone_number_id ${phoneNumberId}`);
        continue;
      }

      for (const msg of value.messages || []) {
        await handleCloudWebhookMessage(supabase, instance, value, msg);
      }
      for (const status of value.statuses || []) {
        await handleCloudWebhookStatus(supabase, instance, status);
      }
    }
  }
}

module.exports = {
  verifyCloudCredentials,
  sendCloudMessage,
  sendCloudMedia,
  handleCloudWebhookPayload,
};
