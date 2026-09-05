'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Conversation, InstanceStatus, WhatsappInstance } from '@/lib/types';
import { Loader2, Search, Users, X } from 'lucide-react';

const channelLabel: Record<Conversation['channel'], string> = { wa: 'wa', ig: 'ig', fb: 'fb' };

const STATUS_DOT: Record<InstanceStatus, string> = {
  connected: 'bg-success',
  disconnected: 'bg-muted-foreground',
  error: 'bg-destructive',
  connecting: 'bg-amber-500',
  qr_pending: 'bg-amber-500',
};

function isGroupJid(waId: string | undefined) {
  return !!waId?.endsWith('@g.us');
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  showArchived,
  onToggleArchived,
  loadingArchived,
  searchQuery,
  onSearchQueryChange,
  searching,
  isSearchResults,
  instances,
  selectedInstanceId,
  onSelectInstance,
  className,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  loadingArchived: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searching: boolean;
  isSearchResults: boolean;
  instances: WhatsappInstance[];
  selectedInstanceId: string | 'all';
  onSelectInstance: (id: string | 'all') => void;
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-col border-r border-border md:w-80 md:shrink-0', className)}>
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-medium">{isSearchResults ? 'Resultados' : showArchived ? 'Archivadas' : 'Inbox'}</p>
        <button
          onClick={onToggleArchived}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
          disabled={loadingArchived}
        >
          {loadingArchived ? 'Cargando...' : showArchived ? 'Ver activas' : 'Ver archivadas'}
        </button>
      </div>

      {instances.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
          <button
            onClick={() => onSelectInstance('all')}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors',
              selectedInstanceId === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            Todas
          </button>
          {instances.map((instance) => (
            <button
              key={instance.id}
              onClick={() => onSelectInstance(instance.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                selectedInstanceId === instance.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[instance.status])} />
              <span className="max-w-[10ch] truncate">{instance.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Buscar contacto, número o mensaje..."
          className="h-8 pl-8 pr-8 text-sm"
        />
        {searching ? (
          <Loader2 className="absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          searchQuery && (
            <button
              onClick={() => onSearchQueryChange('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>

      <ScrollArea className="flex-1">
        {!conversations.length ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {isSearchResults ? 'Sin resultados.' : showArchived ? 'No hay conversaciones archivadas.' : 'Sin conversaciones todavía.'}
          </p>
        ) : (
          conversations.map((conv) => {
            const label = conv.contact?.name || conv.contact?.phone_number || 'Desconocido';
            const unread = conv.unread_count > 0;
            const isGroup = isGroupJid(conv.contact?.wa_id);
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/60',
                  selectedId === conv.id && 'bg-accent',
                  unread && 'bg-success/[0.06]'
                )}
              >
                <Avatar className={cn('h-9 w-9 shrink-0', unread && 'ring-2 ring-success ring-offset-1 ring-offset-background')}>
                  <AvatarFallback>{isGroup ? <Users className="h-4 w-4" /> : label.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('truncate text-sm', unread ? 'font-semibold text-foreground' : 'font-medium')}>{label}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      {conv.archived && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          archivada
                        </Badge>
                      )}
                      {isGroup && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          grupo
                        </Badge>
                      )}
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase">
                        {channelLabel[conv.channel]}
                      </Badge>
                    </div>
                  </div>
                  {conv.instance && <p className="truncate text-[11px] text-muted-foreground/70">{conv.instance.name}</p>}
                  <p className={cn('truncate text-xs', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                    {conv.last_message_preview || 'Sin mensajes'}
                  </p>
                </div>
                {unread && (
                  <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-success px-1 text-[10px] font-bold text-success-foreground">
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
