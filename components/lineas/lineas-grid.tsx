'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineCard } from './line-card';
import { CreateLineDialog } from './create-line-dialog';
import type { WhatsappInstance } from '@/lib/types';

export function LineasGrid({ projectId, initialInstances }: { projectId: string; initialInstances: WhatsappInstance[] }) {
  const supabase = createClient();
  const [instances, setInstances] = useState<WhatsappInstance[]>(initialInstances);

  useEffect(() => {
    const channel = supabase
      .channel(`whatsapp-instances-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_instances', filter: `project_id=eq.${projectId}` },
        (payload) => {
          setInstances((prev) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as WhatsappInstance;
              return prev.some((i) => i.id === row.id) ? prev : [row, ...prev];
            }
            if (payload.eventType === 'UPDATE') {
              const row = payload.new as WhatsappInstance;
              return prev.map((i) => (i.id === row.id ? row : i));
            }
            if (payload.eventType === 'DELETE') {
              const row = payload.old as WhatsappInstance;
              return prev.filter((i) => i.id !== row.id);
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div>
      <div className="flex items-center justify-between px-6 pt-4">
        <p className="text-sm text-muted-foreground">{instances.length} línea(s)</p>
        <CreateLineDialog projectId={projectId} />
      </div>

      {!instances.length ? (
        <div className="m-6 rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
          Todavía no conectaste ninguna línea de WhatsApp.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {instances.map((instance) => (
            <LineCard key={instance.id} instance={instance} />
          ))}
        </div>
      )}
    </div>
  );
}
