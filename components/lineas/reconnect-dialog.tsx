'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { whatsappBackend } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WhatsappInstance } from '@/lib/types';
import { CheckCircle2, Loader2, QrCode, RefreshCw } from 'lucide-react';

export function ReconnectDialog({ instance }: { instance: WhatsappInstance }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<WhatsappInstance>(instance);

  useEffect(() => {
    if (!open) return;
    setLive(instance);
    setConnected(false);
    setError(null);
  }, [open, instance]);

  useEffect(() => {
    if (!open) return;

    const channel = supabase
      .channel(`reconnect-${instance.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'whatsapp_instances', filter: `id=eq.${instance.id}` },
        (payload) => {
          const updated = payload.new as WhatsappInstance;
          setLive(updated);
          if (updated.status === 'connected') {
            setConnected(true);
            setTimeout(() => setOpen(false), 1500);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, instance.id, supabase]);

  async function handleOpen() {
    setOpen(true);
    setConnecting(true);
    setError(null);
    try {
      await whatsappBackend.connect(instance.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la reconexión');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" className="flex-1" onClick={handleOpen}>
        <RefreshCw className="h-3.5 w-3.5" /> Reconectar
      </Button>
      <DialogContent>
        {connected ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <p className="font-medium">¡Línea reconectada!</p>
          </div>
        ) : (
          <div>
            <DialogHeader>
              <DialogTitle>Reconectar {instance.name}</DialogTitle>
              <DialogDescription>
                Si la sesión seguía válida se reconecta sola en unos segundos. Si pide escanear de
                nuevo, abrí WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              {error && <p className="text-sm text-destructive">{error}</p>}

              {live.qr_code ? (
                <div className="rounded-lg bg-white p-3">
                  <Image src={live.qr_code} alt="Código QR de WhatsApp" width={240} height={240} unoptimized />
                </div>
              ) : (
                <div className="flex h-60 w-60 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground">
                  {connecting ? <Loader2 className="h-8 w-8 animate-spin" /> : <QrCode className="h-8 w-8 animate-pulse" />}
                  <span className="text-xs">Conectando...</span>
                </div>
              )}

              <p className="text-xs text-muted-foreground">Esperando confirmación...</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
