require('dotenv').config();
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

const PORT = process.env.PORT || 4000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en whatsapp-backend/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // las fotos viajan en base64 dentro del body

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
    startInstance(supabase, instance).catch((e) => console.error('startInstance error:', e));
    res.json({ ok: true, message: 'Conectando... el QR se actualizará en whatsapp_instances.qr_code' });
  } catch (err) {
    console.error(err);
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
    const result = await sendMessage(req.params.instanceId, to, text);
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
    const result = await sendMedia(req.params.instanceId, to, mediaBase64, mimeType, caption);
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
    await setContactBlocked(req.params.instanceId, jid, blocked);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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

  for (const instance of data) {
    console.log(`Reanudando instancia ${instance.name} (${instance.id})...`);
    startInstance(supabase, instance).catch((e) => console.error(`Error reanudando ${instance.id}:`, e.message));
  }
}

app.listen(PORT, () => {
  console.log(`whatsapp-backend escuchando en :${PORT}`);
  resumeActiveInstances();
});
