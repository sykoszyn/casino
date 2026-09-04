import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { Conversation } from '@/lib/types';

export function ContactPanel({ conversation }: { conversation: Conversation }) {
  const contact = conversation.contact;
  const label = contact?.name || contact?.phone_number || 'Contacto';

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-l border-border p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">{label.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <p className="font-medium">{label}</p>
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
            {contact?.tags?.length ? contact.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>) : <span className="text-muted-foreground">Sin tags</span>}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Notas</p>
          <p className="mt-1 text-muted-foreground">{contact?.notes || 'Sin notas'}</p>
        </div>
      </div>
    </div>
  );
}
