'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './status-badge';
import { ReconnectDialog } from './reconnect-dialog';
import { whatsappBackend } from '@/lib/backend';
import { createClient } from '@/lib/supabase/client';
import type { WhatsappInstance } from '@/lib/types';
import { Loader2, Phone, Trash2 } from 'lucide-react';

const NEEDS_RECONNECT = new Set(['disconnected', 'error']);

export function LineCard({ instance }: { instance: WhatsappInstance }) {
  const supabase = createClient();
  const [loading, setLoading] = useState<'disconnect' | 'delete' | null>(null);

  async function handleDisconnect() {
    setLoading('disconnect');
    try {
      await whatsappBackend.disconnect(instance.id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar la línea "${instance.name}"? Esta acción no se puede deshacer.`)) return;
    setLoading('delete');
    try {
      await whatsappBackend.remove(instance.id).catch(() => null);

      // antes de borrar, anotamos qué contactos apuntan a esta línea: al
      // borrar la línea las conversaciones se van en cascada, pero el
      // contacto en sí queda huérfano (whatsapp_instance_id en null) en vez
      // de borrarse solo.
      const { data: candidates } = await supabase.from('contacts').select('id').eq('whatsapp_instance_id', instance.id);

      await supabase.from('whatsapp_instances').delete().eq('id', instance.id);

      if (candidates?.length) {
        const candidateIds = candidates.map((c) => c.id);
        // de esos, borramos solo los que se quedaron sin ninguna conversación
        // (si le escribieron también a otra línea de esta sucursal, ese
        // contacto se queda).
        const { data: stillLinked } = await supabase.from('conversations').select('contact_id').in('contact_id', candidateIds);
        const stillLinkedIds = new Set((stillLinked ?? []).map((c) => c.contact_id));
        const orphanIds = candidateIds.filter((id) => !stillLinkedIds.has(id));
        if (orphanIds.length) {
          await supabase.from('contacts').delete().in('id', orphanIds);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  }

  const canReconnect = NEEDS_RECONNECT.has(instance.status);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{instance.name}</CardTitle>
          <StatusBadge status={instance.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-3.5 w-3.5" />
          {instance.phone_number || 'Sin número asignado'}
        </div>

        {instance.status === 'error' && instance.error_message && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{instance.error_message}</p>
        )}

        <div className="flex gap-2 pt-1">
          {canReconnect ? (
            <ReconnectDialog instance={instance} />
          ) : (
            <Button size="sm" variant="outline" className="flex-1" disabled={loading !== null} onClick={handleDisconnect}>
              {loading === 'disconnect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Desconectar'}
            </Button>
          )}
          <Button size="sm" variant="destructive" disabled={loading !== null} onClick={handleDelete}>
            {loading === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
