'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/lib/types';

const channelLabel: Record<Conversation['channel'], string> = { wa: 'wa', ig: 'ig', fb: 'fb' };

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  showArchived,
  onToggleArchived,
  loadingArchived,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  loadingArchived: boolean;
}) {
  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-medium">{showArchived ? 'Archivadas' : 'Inbox'}</p>
        <button onClick={onToggleArchived} className="text-xs text-muted-foreground hover:text-foreground hover:underline" disabled={loadingArchived}>
          {loadingArchived ? 'Cargando...' : showArchived ? 'Ver activas' : 'Ver archivadas'}
        </button>
      </div>
      <ScrollArea className="flex-1">
        {!conversations.length ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {showArchived ? 'No hay conversaciones archivadas.' : 'Sin conversaciones todavía.'}
          </p>
        ) : (
          conversations.map((conv) => {
            const label = conv.contact?.name || conv.contact?.phone_number || 'Desconocido';
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/60',
                  selectedId === conv.id && 'bg-accent'
                )}
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback>{label.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] uppercase">
                      {channelLabel[conv.channel]}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{conv.last_message_preview || 'Sin mensajes'}</p>
                </div>
                {conv.unread_count > 0 && (
                  <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {conv.unread_count}
                  </span>
                )}
              </button>
            );
          })
        )}
      </ScrollArea>
    </div>
  );
}
