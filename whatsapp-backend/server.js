require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const {
  startInstance,
  stopInstance,
  requestPairingCode,
  sendMessage,
  sendMedia,
  setContactBlocked,
  isActive,
} = require('./src/instanceManager');
const { verifyCloudCredentials, sendCloudMessage, sendCloudMedia, handleCloudWebhookPayload } = require('./src/cloudApi');

const PORT = process.env.PORT || 4000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHATSAPP_CLOUD_VERIFY_TOKEN = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en whatsapp-backend/.env');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.use(cors());
// guardamos el body crudo (rawBody) para poder validar la firma que manda Meta en cada webhook
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Confirma que el POST del webhook realmente viene de Meta (firmado con el App Secret),
// para que nadie pueda inyectar mensajes falsos golpeando la URL a mano.
function isValidCloudSignature(req) {
  if (!WHATSAPP_APP_SECRET) return true; // sin app secret configurado no se puede validar; no recomendado en producción
  const signature = req.get('x-hub-signature-256');
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
}

async function getInstanceOr404(req, res) {
  const { instanceId } = req.params;
  const { data, error } = await supabase.from('whatsapp_instances').select('*').eq('id', instanceId).single();
  if (error || !data) {
    res.status(404).json({ error: 'Instancia no encontrada' });
    return null;
  }
  return data;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Inicia (o reanuda) la sesión de Baileys de una instancia y comienza a emitir el QR hacia Supabase.
app.post('/instances/:instanceId/connect', async (req, res) => {
  try {
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    if (instance.connection_type === 'cloud_api') {
      return res.status(400).json({ error: 'Esta línea usa la API oficial de WhatsApp: usá /cloud-connect' });
    }
    startInstance(supabase, instance).catch((e) => console.error('startInstance error:', e));
    res.json({ ok: true, message: 'Conectando... el QR se actualizará en whatsapp_instances.qr_code' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Línea conectada por la API oficial de WhatsApp (Meta Cloud API) en vez de Baileys:
// guarda las credenciales (si vienen en el body) y valida contra Meta antes de marcarla conectada.
app.post('/instances/:instanceId/cloud-connect', async (req, res) => {
  const { instanceId } = req.params;
  try {
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;

    const { phoneNumberId, wabaId, accessToken } = req.body || {};
    const updates = { connection_type: 'cloud_api' };
    if (phoneNumberId) updates.cloud_phone_number_id = phoneNumberId;
    if (wabaId) updates.cloud_waba_id = wabaId;
    if (accessToken) updates.cloud_access_token = accessToken;

    const effectivePhoneNumberId = updates.cloud_phone_number_id ?? instance.cloud_phone_number_id;
    const effectiveToken = updates.cloud_access_token ?? instance.cloud_access_token;

    if (!effectivePhoneNumberId || !effectiveToken) {
      return res.status(400).json({ error: 'Faltan el Identificador de número de teléfono y/o el token de acceso' });
    }

    await supabase
      .from('whatsapp_instances')
      .update({ ...updates, status: 'connecting', error_message: null })
      .eq('id', instanceId);

    const { displayPhoneNumber } = await verifyCloudCredentials(effectivePhoneNumberId, effectiveToken);

    await supabase
      .from('whatsapp_instances')
      .update({
        status: 'connected',
        phone_number: displayPhoneNumber,
        error_message: null,
        last_connected_at: new Date().toISOString(),
      })
      .eq('id', instanceId);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    await supabase
      .from('whatsapp_instances')
      .update({ status: 'error', error_message: err.message })
      .eq('id', instanceId);
    res.status(500).json({ error: err.message });
  }
});

// Alternativa sin QR: pide un código de vinculación de 8 dígitos para un número dado.
app.post('/instances/:instanceId/pairing-code', async (req, res) => {
  try {
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber es requerido' });
    const code = await requestPairingCode(supabase, instance, phoneNumber);
    res.json({ ok: true, code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/instances/:instanceId/disconnect', async (req, res) => {
  try {
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    await stopInstance(supabase, instance.id, { logout: false });
    await supabase
      .from('whatsapp_instances')
      .update({ status: 'disconnected', qr_code: null })
      .eq('id', instance.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Logout completo: borra la sesión de Baileys para forzar un nuevo escaneo de QR.
app.delete('/instances/:instanceId', async (req, res) => {
  try {
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    await stopInstance(supabase, instance.id, { logout: true });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/instances/:instanceId/status', async (req, res) => {
  const instance = await getInstanceOr404(req, res);
  if (!instance) return;
  res.json({
    status: instance.status,
    qr_code: instance.qr_code,
    pairing_code: instance.pairing_code,
    phone_number: instance.phone_number,
    active: isActive(instance.id),
  });
});

app.post('/instances/:instanceId/send', async (req, res) => {
  try {
    const { to, text } = req.body;
    if (!to || !text) return res.status(400).json({ error: 'to y text son requeridos' });
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    const result =
      instance.connection_type === 'cloud_api'
        ? await sendCloudMessage(instance, to, text)
        : await sendMessage(instance.id, to, text);
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/instances/:instanceId/send-media', async (req, res) => {
  try {
    const { to, mediaBase64, mimeType, caption } = req.body;
    if (!to || !mediaBase64) return res.status(400).json({ error: 'to y mediaBase64 son requeridos' });
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    const result =
      instance.connection_type === 'cloud_api'
        ? await sendCloudMedia(instance, to, mediaBase64, mimeType, caption)
        : await sendMedia(instance.id, to, mediaBase64, mimeType, caption);
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/instances/:instanceId/block', async (req, res) => {
  try {
    const { jid, blocked } = req.body;
    if (!jid || typeof blocked !== 'boolean') return res.status(400).json({ error: 'jid y blocked (boolean) son requeridos' });
    const instance = await getInstanceOr404(req, res);
    if (!instance) return;
    if (instance.connection_type === 'cloud_api') {
      return res.status(400).json({ error: 'Bloquear contactos no está disponible para líneas conectadas por la API oficial de WhatsApp' });
    }
    await setContactBlocked(instance.id, jid, blocked);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Meta llama a este GET una sola vez, al configurar el webhook en developers.facebook.com,
// para confirmar que el dueño de la URL es quien dice ser.
app.get('/webhook/whatsapp-cloud', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && WHATSAPP_CLOUD_VERIFY_TOKEN && token === WHATSAPP_CLOUD_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Acá llegan los mensajes entrantes y las confirmaciones de entrega/lectura de todas
// las líneas conectadas por la API oficial (Meta manda todo a una única URL por app).
app.post('/webhook/whatsapp-cloud', async (req, res) => {
  if (!isValidCloudSignature(req)) {
    console.warn('[webhook] firma inválida en un POST a /webhook/whatsapp-cloud, se ignora');
    return res.sendStatus(403);
  }
  // Meta espera un 200 rápido; si tarda reintenta y puede terminar duplicando eventos.
  res.sendStatus(200);
  try {
    await handleCloudWebhookPayload(supabase, req.body);
  } catch (err) {
    console.error('[webhook] error procesando payload de la API oficial de WhatsApp:', err.message);
  }
});

async function resumeActiveInstances() {
  const { data, error } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .in('status', ['connected', 'connecting', 'qr_pending']);

  if (error) {
    console.error('No se pudieron cargar instancias para reanudar:', error.message);
    return;
  }

  // Escalonado a propósito: si arrancan las 50 conexiones en el mismo
  // instante (típico después de un redeploy), WhatsApp puede tratarlo como
  // actividad sospechosa y frenar algunas. Con un respiro entre cada una se
  // reduce bastante esa chance.
  for (const instance of data) {
    console.log(`Reanudando instancia ${instance.name} (${instance.id})...`);
    startInstance(supabase, instance).catch((e) => console.error(`Error reanudando ${instance.id}:`, e.message));
    await sleep(400);
  }
}

app.listen(PORT, () => {
  console.log(`whatsapp-backend escuchando en :${PORT}`);
  resumeActiveInstances();
});
