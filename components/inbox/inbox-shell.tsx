'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { ContactPanel } from './contact-panel';
import { cn } from '@/lib/utils';
import type { Conversation, QuickReply, WhatsappInstance } from '@/lib/types';
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
  instances: initialInstances,
}: {
  projectId: string;
  initialConversations: Conversation[];
  quickReplies: QuickReply[];
  instances: WhatsappInstance[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // El chat abierto vive en la URL (?c=<id>), no en un useState: así, entrar
  // a "Inbox" desde el menú (que apunta a la URL sin ?c) cierra cualquier
  // chat abierto solo, sin código especial para detectar el click.
  const selectedId = searchParams.get('c');

  const [conversations, setConversations] = useState<Conversation[]>(sortConversations(initialConversations));
  const [instances, setInstances] = useState<WhatsappInstance[]>(initialInstances);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [archivedFetched, setArchivedFetched] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [searching, setSearching] = useState(false);

  function selectConversation(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('c', id);
    else params.delete('c');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

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
            const instance = exists?.instance ?? instances.find((i) => i.id === row.whatsapp_instance_id);
            const merged: Conversation = { ...row, contact: exists?.contact, instance };
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

  // Mantiene vivo el color del puntito de cada línea en los filtros de arriba.
  useEffect(() => {
    const channel = supabase
      .channel(`inbox-instances-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_instances', filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as WhatsappInstance;
            setInstances((prev) => prev.filter((i) => i.id !== row.id));
            return;
          }
          const row = payload.new as WhatsappInstance;
          setInstances((prev) => (prev.some((i) => i.id === row.id) ? prev.map((i) => (i.id === row.id ? row : i)) : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Búsqueda: por nombre/teléfono de contacto o por texto de cualquier
  // mensaje, en TODAS las líneas de esta sucursal (todo está scopeado por
  // project_id, no por línea individual).
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timeout = setTimeout(async () => {
      const like = `%${query}%`;
      const embed = '*, contact:contacts(*), instance:whatsapp_instances(id, name, status)';

      const [{ data: byContact }, { data: matchingMessages }] = await Promise.all([
        supabase
          .from('conversations')
          .select(`*, contact:contacts!inner(*), instance:whatsapp_instances(id, name, status)`)
          .eq('project_id', projectId)
          .or(`name.ilike.${like},phone_number.ilike.${like}`, { foreignTable: 'contacts' })
          .limit(50),
        supabase.from('messages').select('conversation_id').eq('project_id', projectId).ilike('content', like).limit(50),
      ]);

      if (cancelled) return;

      const convIdsFromMessages = [...new Set((matchingMessages ?? []).map((m) => m.conversation_id))].filter(
        (id) => !(byContact ?? []).some((c) => c.id === id)
      );

      let byMessage: Conversation[] = [];
      if (convIdsFromMessages.length) {
        const { data } = await supabase.from('conversations').select(embed).in('id', convIdsFromMessages);
        byMessage = (data ?? []) as unknown as Conversation[];
      }

      if (cancelled) return;
      setSearchResults(sortConversations([...(byContact ?? []), ...byMessage]));
      setSearching(false);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, projectId]);

  const isSearching = searchResults !== null;
  const byArchived = isSearching ? searchResults : conversations.filter((c) => c.archived === showArchived);
  const visibleConversations = selectedInstanceId === 'all' ? byArchived : byArchived.filter((c) => c.whatsapp_instance_id === selectedInstanceId);
  const selected = visibleConversations.find((c) => c.id === selectedId) ?? null;

  function handleSelect(id: string) {
    selectConversation(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', id).then();
  }

  async function handleToggleArchivedView() {
    const next = !showArchived;
    setShowArchived(next);
    selectConversation(null);

    if (next && !archivedFetched) {
      setLoadingArchived(true);
      const { data } = await supabase
        .from('conversations')
        .select('*, contact:contacts(*), instance:whatsapp_instances(id, name, status)')
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
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searching={searching}
        isSearchResults={isSearching}
        instances={instances}
        selectedInstanceId={selectedInstanceId}
        onSelectInstance={setSelectedInstanceId}
        className={cn(selected && 'hidden md:flex')}
      />

      <div className={cn('flex-1', !selected && 'hidden md:flex')}>
        {selected ? (
          <ChatWindow
            conversation={selected}
            quickReplies={quickReplies}
            onConversationLeft={() => selectConversation(null)}
            onBack={() => selectConversation(null)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessagesSquare className="h-8 w-8" />
            <p className="text-sm">Elegí una conversación</p>
          </div>
        )}
      </div>

      {selected && (
        <div className="hidden lg:flex">
          <ContactPanel conversation={selected} />
        </div>
      )}
    </div>
  );
}
