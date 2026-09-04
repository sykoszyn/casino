'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { whatsappBackend } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { WhatsappInstance, ConnectionType } from '@/lib/types';
import { CheckCircle2, Loader2, Plus, QrCode } from 'lucide-react';

type Step = 'form' | 'waiting' | 'connected';

export function CreateLineDialog({ projectId }: { projectId: string }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [connectionType, setConnectionType] = useState<ConnectionType>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<WhatsappInstance | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  function reset() {
    setStep('form');
    setName('');
    setConnectionType('qr');
    setPhoneNumber('');
    setError(null);
    setInstance(null);
    setPairingCode(null);
  }

  useEffect(() => {
    if (!open) {
      const t = setTimeout(reset, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Escucha en tiempo real los cambios de la instancia que se está conectando (QR nuevo, status -> connected)
  useEffect(() => {
    if (!instance || step !== 'waiting') return;

    const channel = supabase
      .channel(`instance-${instance.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'whatsapp_instances', filter: `id=eq.${instance.id}` },
        (payload) => {
          const updated = payload.new as WhatsappInstance;
          setInstance(updated);
          if (updated.connection_type === 'pairing_code' && updated.pairing_code) {
            setPairingCode(updated.pairing_code);
          }
          if (updated.status === 'connected') {
            setStep('connected');
            setTimeout(() => setOpen(false), 1800);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id, step]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: created, error: insertError } = await supabase
      .from('whatsapp_instances')
      .insert({ project_id: projectId, name, connection_type: connectionType })
      .select('*')
      .single();

    if (insertError || !created) {
      setError(insertError?.message ?? 'No se pudo crear la línea');
      setLoading(false);
      return;
    }

    setInstance(created as WhatsappInstance);
    setStep('waiting');

    try {
      if (connectionType === 'qr') {
        await whatsappBackend.connect(created.id);
      } else {
        const { code } = await whatsappBackend.requestPairingCode(created.id, phoneNumber);
        setPairingCode(code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la conexión con el backend de WhatsApp');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Crear línea
        </Button>
      </DialogTrigger>
      <DialogContent>
        {step === 'form' && (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Nueva línea de WhatsApp</DialogTitle>
              <DialogDescription>Elegí un nombre y cómo querés vincular el número.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="line-name">Nombre de la línea</Label>
                <Input id="line-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Ventas Sucursal Centro" autoFocus />
              </div>

              <div className="space-y-1.5">
                <Label>Método de vinculación</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConnectionType('qr')}
                    className={`rounded-md border px-3 py-2 text-sm ${connectionType === 'qr' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    Código QR
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectionType('pairing_code')}
                    className={`rounded-md border px-3 py-2 text-sm ${connectionType === 'pairing_code' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    Código de 8 dígitos
                  </button>
                </div>
              </div>

              {connectionType === 'pairing_code' && (
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Número de WhatsApp (con código de país)</Label>
                  <Input id="phone" required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="5491122334455" />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading || !name || (connectionType === 'pairing_code' && !phoneNumber)}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continuar'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'waiting' && (
          <div>
            <DialogHeader>
              <DialogTitle>{connectionType === 'qr' ? 'Escaneá el código QR' : 'Ingresá el código en tu WhatsApp'}</DialogTitle>
              <DialogDescription>
                {connectionType === 'qr'
                  ? 'Abrí WhatsApp > Dispositivos vinculados > Vincular un dispositivo y escaneá este código.'
                  : 'Abrí WhatsApp > Dispositivos vinculados > Vincular con número de teléfono e ingresá el código.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              {error && <p className="text-sm text-destructive">{error}</p>}

              {connectionType === 'qr' ? (
                instance?.qr_code ? (
                  <div className="rounded-lg bg-white p-3">
                    <Image src={instance.qr_code} alt="Código QR de WhatsApp" width={240} height={240} unoptimized />
                  </div>
                ) : (
                  <div className="flex h-60 w-60 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground">
                    <QrCode className="h-8 w-8 animate-pulse" />
                    <span className="text-xs">Generando QR...</span>
                  </div>
                )
              ) : pairingCode ? (
                <div className="rounded-lg border border-border bg-secondary/40 px-8 py-6 text-center">
                  <p className="text-3xl font-bold tracking-[0.3em]">{pairingCode}</p>
                </div>
              ) : (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              )}

              <p className="text-xs text-muted-foreground">Esperando confirmación...</p>
            </div>
          </div>
        )}

        {step === 'connected' && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <p className="font-medium">¡Línea conectada!</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
