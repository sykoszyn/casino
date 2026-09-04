'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { ContactPanel } from './contact-panel';
import type { Conversation } from '@/lib/types';
import { MessagesSquare } from 'lucide-react';

function sortConversations(list: Conversation[]) {
  return [...list].sort((a, b) => {
    const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return db - da;
  });
}

export function InboxShell({ projectId, initialConversations }: { projectId: string; initialConversations: Conversation[] }) {
  const supabase = createClient();
  const [conversations, setConversations] = useState<Conversation[]>(sortConversations(initialConversations));
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null);

  useEffect(() => {
    const channel = supabase
      .channel(`conversations-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `project_id=eq.${projectId}` },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as Conversation;
            setConversations((prev) => prev.filter((c) => c.id !== row.id));
            return;
          }

          const row = payload.new as Conversation;

          setConversations((prev) => {
            const exists = prev.find((c) => c.id === row.id);
            const merged: Conversation = { ...row, contact: exists?.contact };
            const next = exists ? prev.map((c) => (c.id === row.id ? merged : c)) : [merged, ...prev];
            return sortConversations(next);
          });

          // si es una conversación nueva, traemos el contacto asociado
          if (!conversations.find((c) => c.id === row.id)?.contact) {
            const { data: contact } = await supabase.from('contacts').select('*').eq('id', row.contact_id).single();
            if (contact) {
              setConversations((prev) => sortConversations(prev.map((c) => (c.id === row.id ? { ...c, contact } : c))));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  function handleSelect(id: string) {
    setSelectedId(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', id).then();
  }

  return (
    <div className="flex h-full">
      <ConversationList conversations={conversations} selectedId={selectedId} onSelect={handleSelect} />

      <div className="flex-1">
        {selected ? (
          <ChatWindow conversation={selected} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessagesSquare className="h-8 w-8" />
            <p className="text-sm">Elegí una conversación</p>
          </div>
        )}
      </div>

      {selected && <ContactPanel conversation={selected} />}
    </div>
  );
}
