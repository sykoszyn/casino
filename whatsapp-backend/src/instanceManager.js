const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const { useSupabaseAuthState } = require('./supabaseAuthState');
const { handleIncomingMessage, updateMessageStatus } = require('./messages');

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

/** instanceId -> { sock, projectId } */
const sockets = new Map();
/** instanceId -> promise, evita arrancar la misma instancia dos veces en paralelo */
const starting = new Map();
/** instanceId -> cantidad de reconexiones fallidas seguidas (se resetea al abrir bien) */
const reconnectAttempts = new Map();

const MAX_RECONNECT_ATTEMPTS = 8;

// Motivos de desconexión que Baileys resuelve solo reconectando: no son errores
// reales, así que no hay que mostrarlos como "Error" en la UI.
const RECONNECTABLE_REASONS = new Set([
  DisconnectReason.restartRequired, // pasa siempre justo después de escanear el QR por primera vez
  DisconnectReason.connectionClosed,
  DisconnectReason.connectionLost,
  DisconnectReason.timedOut,
  undefined, // cierre sin código explícito (ej. reinicio del proceso)
]);

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
        reconnectAttempts.delete(instanceId);
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
        const needsRelink = statusCode === DisconnectReason.badSession || statusCode === DisconnectReason.multideviceMismatch;
        const replaced = statusCode === DisconnectReason.connectionReplaced;
        sockets.delete(instanceId);

        if (loggedOut || needsRelink) {
          await supabase
            .from('whatsapp_instances')
            .update({ status: 'disconnected', qr_code: null, error_message: null })
            .eq('id', instanceId);
          await clearCreds();
          reconnectAttempts.delete(instanceId);
          console.log(`[instance ${instanceId}] logout/sesión inválida, hay que volver a vincular`);
          return;
        }

        if (replaced) {
          await supabase
            .from('whatsapp_instances')
            .update({ status: 'error', qr_code: null, error_message: 'Se vinculó desde otro lugar. Desconectá esa sesión o creá una línea nueva.' })
            .eq('id', instanceId);
          reconnectAttempts.delete(instanceId);
          return;
        }

        const attempts = (reconnectAttempts.get(instanceId) || 0) + 1;
        reconnectAttempts.set(instanceId, attempts);

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          await supabase
            .from('whatsapp_instances')
            .update({
              status: 'error',
              qr_code: null,
              error_message:
                'No se pudo reconectar tras varios intentos. Probá el botón "Reconectar" (no pierde la sesión); si eso tampoco funciona después de un rato, recién ahí eliminá la línea y volvé a crearla.',
            })
            .eq('id', instanceId);
          reconnectAttempts.delete(instanceId);
          console.error(`[instance ${instanceId}] se agotaron los reintentos de reconexión`);
          return;
        }

        // restartRequired (y similares) son parte normal del handshake: no lo
        // marcamos como error para no asustar en la UI, solo reconectamos.
        const isExpectedRestart = statusCode === DisconnectReason.restartRequired;
        if (!RECONNECTABLE_REASONS.has(statusCode)) {
          await supabase
            .from('whatsapp_instances')
            .update({
              status: 'error',
              qr_code: null,
              error_message: lastDisconnect?.error?.message || 'Conexión cerrada inesperadamente, reintentando...',
            })
            .eq('id', instanceId);
        }

        const delay = isExpectedRestart ? 300 : Math.min(1000 * 2 ** (attempts - 1), 30000);
        console.warn(`[instance ${instanceId}] reconectando en ${delay}ms (intento ${attempts})`);
        setTimeout(() => {
          supabase
            .from('whatsapp_instances')
            .select('*')
            .eq('id', instanceId)
            .single()
            .then(({ data }) => data && startInstance(supabase, data).catch(console.error));
        }, delay);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // "notify" son mensajes nuevos entrantes; "append" es como Baileys nos
      // hace eco de los mensajes que nosotros mismos mandamos con
      // sock.sendMessage(). Procesamos los dos (handleIncomingMessage dedupea
      // por wa_message_id), si no los que enviamos nunca se guardaban.
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages) {
        await handleIncomingMessage(supabase, sock, projectId, instanceId, msg);
      }
    });

    // Confirmaciones de entrega/lectura de los mensajes que mandamos (tildes del chat)
    sock.ev.on('messages.update', async (updates) => {
      for (const { key, update } of updates) {
        if (update.status === undefined || update.status === null) continue;
        await updateMessageStatus(supabase, instanceId, key.id, update.status).catch((e) =>
          console.error(`[instance ${instanceId}] error actualizando estado de mensaje:`, e.message)
        );
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
  reconnectAttempts.delete(instanceId);
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

function resolveJid(to) {
  return to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}

async function sendMessage(instanceId, to, text) {
  const entry = sockets.get(instanceId);
  if (!entry) throw new Error('La instancia no está conectada');
  return entry.sock.sendMessage(resolveJid(to), { text });
}

async function sendMedia(instanceId, to, mediaBase64, mimeType, caption) {
  const entry = sockets.get(instanceId);
  if (!entry) throw new Error('La instancia no está conectada');

  const base64Data = mediaBase64.includes(',') ? mediaBase64.split(',')[1] : mediaBase64;
  const buffer = Buffer.from(base64Data, 'base64');
  const isVideo = mimeType?.startsWith('video/');

  const payload = isVideo
    ? { video: buffer, caption, mimetype: mimeType || 'video/mp4' }
    : { image: buffer, caption, mimetype: mimeType || 'image/jpeg' };

  return entry.sock.sendMessage(resolveJid(to), payload);
}

async function setContactBlocked(instanceId, jid, blocked) {
  const entry = sockets.get(instanceId);
  if (!entry) throw new Error('La instancia no está conectada');
  return entry.sock.updateBlockStatus(resolveJid(jid), blocked ? 'block' : 'unblock');
}

module.exports = {
  startInstance,
  stopInstance,
  requestPairingCode,
  sendMessage,
  sendMedia,
  setContactBlocked,
  isActive,
  sockets,
};
