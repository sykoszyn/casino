'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { QuickReply } from '@/lib/types';
import { Zap } from 'lucide-react';

export function QuickRepliesMenu({ quickReplies, onSelect }: { quickReplies: QuickReply[]; onSelect: (content: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="outline" title="Respuestas rápidas">
          <Zap className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Respuestas rápidas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!quickReplies.length ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Todavía no creaste ninguna. Se agregan desde Configuración.
          </p>
        ) : (
          quickReplies.map((qr) => (
            <DropdownMenuItem key={qr.id} onClick={() => onSelect(qr.content)} className="flex flex-col items-start gap-0.5 py-2">
              <span className="text-xs font-semibold text-primary">/{qr.shortcut}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{qr.content}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
