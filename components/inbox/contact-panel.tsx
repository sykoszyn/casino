'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { whatsappBackend } from '@/lib/backend';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { Conversation } from '@/lib/types';
import { Ban, Check, Loader2, Pencil, ShieldCheck, X } from 'lucide-react';

export function ContactPanel({ conversation }: { conversation: Conversation }) {
  const supabase = createClient();
  const contact = conversation.contact;
  const label = contact?.name || contact?.phone_number || 'Contacto';

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(contact?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [togglingBlock, setTogglingBlock] = useState(false);

  async function handleSaveName() {
    if (!contact) return;
    setSavingName(true);
    const { error } = await supabase.from('contacts').update({ name: nameDraft.trim() || null }).eq('id', contact.id);
    setSavingName(false);
    if (error) {
      alert(error.message);
      return;
    }
    setEditing(false);
  }

  async function handleToggleBlock() {
    if (!contact) return;
    const nextBlocked = !contact.blocked;
    setTogglingBlock(true);
    try {
      await whatsappBackend.setBlocked(conversation.whatsapp_instance_id, contact.wa_id, nextBlocked);
      await supabase.from('contacts').update({ blocked: nextBlocked }).eq('id', contact.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo actualizar el bloqueo');
    } finally {
      setTogglingBlock(false);
    }
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-l border-border p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">{label.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>

        {editing ? (
          <div className="flex w-full items-center gap-1">
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              placeholder="Nombre del contacto"
              className="h-8 text-center text-sm"
            />
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={savingName} onClick={handleSaveName}>
              {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditing(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            className="group flex items-center gap-1.5 font-medium hover:text-primary"
            onClick={() => {
              setNameDraft(contact?.name ?? '');
              setEditing(true);
            }}
            title="Editar nombre (solo para esta sucursal)"
          >
            {label}
            <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
          </button>
        )}

        <p className="text-xs text-muted-foreground">{contact?.phone_number}</p>
      </div>

      <Separator className="my-4" />

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Canal</p>
          <Badge variant="outline" className="mt-1 uppercase">
            {conversation.channel}
          </Badge>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Tags</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {contact?.tags?.length ? (
              contact.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">Sin tags</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Notas</p>
          <p className="mt-1 text-muted-foreground">{contact?.notes || 'Sin notas'}</p>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <Button
          size="sm"
          variant={contact?.blocked ? 'outline' : 'destructive'}
          className="w-full"
          disabled={togglingBlock || !contact}
          onClick={handleToggleBlock}
        >
          {togglingBlock ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : contact?.blocked ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" /> Desbloquear
            </>
          ) : (
            <>
              <Ban className="h-3.5 w-3.5" /> Bloquear contacto
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
