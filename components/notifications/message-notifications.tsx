'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import type { Message, MessageType } from '@/lib/types';
import { Bell, X } from 'lucide-react';

const PREVIEW_BY_TYPE: Partial<Record<MessageType, string>> = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎤 Audio',
  document: '📎 Documento',
  sticker: '🖼️ Sticker',
};

const DISMISS_KEY = 'nexowa-notif-banner-dismissed';

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // dos tonitos cortos tipo "ding-dong" de notificación
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });

    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    // el navegador puede bloquear audio sin interacción previa del usuario; no rompemos nada por esto
  }
}

/**
 * Vive montado en todo el layout de la sucursal (no solo en Inbox), así que
 * suena y notifica sin importar en qué pantalla estés, mientras la pestaña
 * siga abierta (aunque esté minimizada o en segundo plano).
 */
export function MessageNotifications({ projectId, projectName, slug }: { projectId: string; projectName: string; slug: string }) {
  const supabase = createClient();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [dismissed, setDismissed] = useState(true); // arranca true para no parpadear en el primer render (SSR/CSR)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  function handleEnable() {
    // OJO: esto tiene que llamarse directo desde el onClick de un botón. Si
    // se llama solo (sin que el usuario haga clic en algo), Chrome/Firefox
    // bloquean el popup de permiso sin avisar y queda trabado en "default"
    // para siempre — eso era justo lo que pasaba antes.
    Notification.requestPermission().then((result) => setPermission(result));
  }

  function handleDismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
  }

  useEffect(() => {
    const channel = supabase
      .channel(`message-notifications-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const message = payload.new as Message;
          if (message.direction !== 'inbound') return;

          playBeep();

          if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;

          const senderName = message.sender_name || 'Alguien';
          const body = message.content?.trim() || PREVIEW_BY_TYPE[message.message_type] || 'Nuevo mensaje';

          const notification = new Notification(`${projectName} — Nuevo mensaje de ${senderName}`, {
            body,
            tag: message.conversation_id, // agrupa notificaciones del mismo chat en vez de amontonarlas
          });

          notification.onclick = () => {
            window.focus();
            window.location.href = `/${slug}/inbox`;
            notification.close();
          };
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (permission === 'unsupported' || permission === 'granted' || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/60 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 shrink-0 text-primary" />
        {permission === 'denied' ? (
          <span>
            Bloqueaste las notificaciones de este sitio. Para activarlas, entrá a la configuración del navegador (ícono de
            candado/info al lado de la URL) y permitilas a mano.
          </span>
        ) : (
          <span>Activá las notificaciones para enterarte de los mensajes nuevos aunque tengas la pestaña minimizada.</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {permission === 'default' && (
          <Button size="sm" onClick={handleEnable}>
            Activar
          </Button>
        )}
        <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
