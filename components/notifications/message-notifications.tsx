'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Message, MessageType } from '@/lib/types';

const PREVIEW_BY_TYPE: Partial<Record<MessageType, string>> = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎤 Audio',
  document: '📎 Documento',
  sticker: '🖼️ Sticker',
};

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
  const permissionRequested = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (!permissionRequested.current && Notification.permission === 'default') {
      permissionRequested.current = true;
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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

  return null;
}
