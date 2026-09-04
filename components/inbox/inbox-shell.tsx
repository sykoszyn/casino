'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { ContactPanel } from './contact-panel';
import type { Conversation, QuickReply } from '@/lib/types';
import { MessagesSquare } from 'lucide-react';

function sortConversations(list: Conversation[]) {
  return [...list].sort((a, b) => {
    const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return db - da;
  });
}

export function InboxShell({
  projectId,
  initialConversations,
  quickReplies,
}: {
  projectId: string;
  initialConversations: Conversation[];
  quickReplies: QuickReply[];
}) {
  const supabase = createClient();
  const [conversations, setConversations] = useState<Conversation[]>(sortConversations(initialConversations));
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedFetched, setArchivedFetched] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);

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

  const visibleConversations = conversations.filter((c) => c.archived === showArchived);
  const selected = visibleConversations.find((c) => c.id === selectedId) ?? null;

  function handleSelect(id: string) {
    setSelectedId(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', id).then();
  }

  async function handleToggleArchivedView() {
    const next = !showArchived;
    setShowArchived(next);
    setSelectedId(null);

    if (next && !archivedFetched) {
      setLoadingArchived(true);
      const { data } = await supabase
        .from('conversations')
        .select('*, contact:contacts(*)')
        .eq('project_id', projectId)
        .eq('archived', true)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(150);
      setArchivedFetched(true);
      setLoadingArchived(false);
      if (data?.length) {
        setConversations((prev) => {
          const ids = new Set(prev.map((c) => c.id));
          return sortConversations([...prev, ...data.filter((c) => !ids.has(c.id))]);
        });
      }
    }
  }

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={visibleConversations}
        selectedId={selectedId}
        onSelect={handleSelect}
        showArchived={showArchived}
        onToggleArchived={handleToggleArchivedView}
        loadingArchived={loadingArchived}
      />

      <div className="flex-1">
        {selected ? (
          <ChatWindow conversation={selected} quickReplies={quickReplies} onArchivedChange={() => setSelectedId(null)} />
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
