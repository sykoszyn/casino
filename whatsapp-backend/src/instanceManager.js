const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const { useSupabaseAuthState } = require('./supabaseAuthState');
const { handleIncomingMessage } = require('./messages');

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

/** instanceId -> { sock, projectId } */
const sockets = new Map();
/** instanceId -> promise, evita arrancar la misma instancia dos veces en paralelo */
const starting = new Map();

function isActive(instanceId) {
  return sockets.has(instanceId);
}

async function startInstance(supabase, instance) {
  const instanceId = instance.id;
  const projectId = instance.project_id;

  if (sockets.has(instanceId)) return sockets.get(instanceId).sock;
  if (starting.has(instanceId)) return starting.get(instanceId);

  const promise = (async () => {
    const { state, saveCreds, clearCreds } = await useSupabaseAuthState(supabase, instanceId);
    const { version } = await fetchLatestBaileysVersion();

    await supabase
      .from('whatsapp_instances')
      .update({ status: 'connecting', error_message: null })
      .eq('id', instanceId);

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: Browsers.appropriate('Chrome'),
      syncFullHistory: false,
    });

    sockets.set(instanceId, { sock, projectId });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          await supabase
            .from('whatsapp_instances')
            .update({ status: 'qr_pending', qr_code: qrDataUrl, error_message: null })
            .eq('id', instanceId);
        } catch (e) {
          console.error(`[instance ${instanceId}] error generando QR:`, e.message);
        }
      }

      if (connection === 'open') {
        const phoneNumber = sock.user?.id?.split(':')[0]?.split('@')[0] || instance.phone_number;
        await supabase
          .from('whatsapp_instances')
          .update({
            status: 'connected',
            phone_number: phoneNumber,
            qr_code: null,
            error_message: null,
            last_connected_at: new Date().toISOString(),
          })
          .eq('id', instanceId);
        console.log(`[instance ${instanceId}] conectada como ${phoneNumber}`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        sockets.delete(instanceId);

        await supabase
          .from('whatsapp_instances')
          .update({
            status: loggedOut ? 'disconnected' : 'error',
            qr_code: null,
            error_message: loggedOut ? null : lastDisconnect?.error?.message || 'Conexión cerrada inesperadamente',
          })
          .eq('id', instanceId);

        if (loggedOut) {
          await clearCreds();
          console.log(`[instance ${instanceId}] logout, sesión limpiada`);
        } else {
          console.warn(`[instance ${instanceId}] desconectada, reintentando en 5s...`);
          setTimeout(() => {
            supabase
              .from('whatsapp_instances')
              .select('*')
              .eq('id', instanceId)
              .single()
              .then(({ data }) => data && startInstance(supabase, data).catch(console.error));
          }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        await handleIncomingMessage(supabase, projectId, instanceId, msg);
      }
    });

    return sock;
  })();

  starting.set(instanceId, promise);
  try {
    return await promise;
  } finally {
    starting.delete(instanceId);
  }
}

async function requestPairingCode(supabase, instance, phoneNumber) {
  const sock = await startInstance(supabase, instance);
  const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
  await supabase
    .from('whatsapp_instances')
    .update({ pairing_code: code, status: 'qr_pending', connection_type: 'pairing_code' })
    .eq('id', instance.id);
  return code;
}

async function stopInstance(supabase, instanceId, { logout } = { logout: false }) {
  const entry = sockets.get(instanceId);
  if (!entry) return;
  try {
    if (logout) {
      await entry.sock.logout();
    } else {
      entry.sock.end(undefined);
    }
  } catch (e) {
    console.error(`[instance ${instanceId}] error al detener:`, e.message);
  } finally {
    sockets.delete(instanceId);
  }
}

async function sendMessage(instanceId, to, text) {
  const entry = sockets.get(instanceId);
  if (!entry) throw new Error('La instancia no está conectada');
  const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  return entry.sock.sendMessage(jid, { text });
}

module.exports = { startInstance, stopInstance, requestPairingCode, sendMessage, isActive, sockets };
