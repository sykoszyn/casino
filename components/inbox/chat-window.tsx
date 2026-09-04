'use client';

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { whatsappBackend } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Conversation, Message } from '@/lib/types';
import { Send, Loader2 } from 'lucide-react';

export function ChatWindow({ conversation }: { conversation: Conversation }) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoadingHistory(true);
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (active) {
          setMessages(data ?? []);
          setLoadingHistory(false);
        }
      });
    return () => {
      active = false;
    };
  }, [conversation.id, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await whatsappBackend.send(conversation.whatsapp_instance_id, conversation.contact?.wa_id ?? '', text.trim());
      setText('');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'No se pudo enviar el mensaje');
    } finally {
      setSending(false);
    }
  }

  const contactLabel = conversation.contact?.name || conversation.contact?.phone_number || 'Contacto';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-medium">{contactLabel}</p>
        <p className="text-xs text-muted-foreground">{conversation.contact?.phone_number}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loadingHistory ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !messages.length ? (
          <p className="text-center text-sm text-muted-foreground">Todavía no hay mensajes en esta conversación.</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[70%] rounded-lg px-3 py-2 text-sm',
                  msg.direction === 'outbound' ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                )}
              >
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                <p className={cn('mt-1 text-[10px] opacity-70')}>
                  {new Date(msg.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribí un mensaje..." disabled={sending} />
        <Button type="submit" size="icon" disabled={sending || !text.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
