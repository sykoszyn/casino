const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

/**
 * Reimplementación de `useMultiFileAuthState` de Baileys pero persistiendo
 * las credenciales en la columna `session_data` (jsonb) de whatsapp_instances
 * en vez del filesystem. Esto es lo que permite correr 24/7 en hosts con
 * disco efímero (Render/Railway free tier) sin perder la sesión ni tener
 * que re-escanear el QR en cada redeploy.
 */
async function useSupabaseAuthState(supabase, instanceId) {
  const { data: row, error } = await supabase
    .from('whatsapp_instances')
    .select('session_data')
    .eq('id', instanceId)
    .single();

  if (error) throw error;

  const stored = row?.session_data && Object.keys(row.session_data).length ? row.session_data : null;

  let creds;
  let keys;

  if (stored?.creds) {
    creds = JSON.parse(JSON.stringify(stored.creds), BufferJSON.reviver);
    keys = JSON.parse(JSON.stringify(stored.keys || {}), BufferJSON.reviver);
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  let saving = Promise.resolve();

  const persist = () => {
    // encadenamos para no pisar escrituras concurrentes (creds.update vs keys.set)
    saving = saving
      .catch(() => {})
      .then(async () => {
        const payload = JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer));
        const { error: updateError } = await supabase
          .from('whatsapp_instances')
          .update({ session_data: payload })
          .eq('id', instanceId);
        if (updateError) console.error(`[auth-state] error guardando sesión ${instanceId}:`, updateError.message);
      });
    return saving;
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (value && type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value !== undefined) result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          for (const type of Object.keys(data)) {
            keys[type] = keys[type] || {};
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              if (value === null) {
                delete keys[type][id];
              } else {
                keys[type][id] = value;
              }
            }
          }
          await persist();
        },
      },
    },
    saveCreds: () => persist(),
    clearCreds: async () => {
      creds = initAuthCreds();
      keys = {};
      await persist();
    },
  };
}

module.exports = { useSupabaseAuthState };
