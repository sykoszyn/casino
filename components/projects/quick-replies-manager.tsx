'use client';

import type React from 'react';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { QuickReply } from '@/lib/types';
import { Loader2, Plus, Trash2 } from 'lucide-react';

function normalizeShortcut(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-');
}

export function QuickRepliesManager({ projectId, initialQuickReplies }: { projectId: string; initialQuickReplies: QuickReply[] }) {
  const supabase = createClient();
  const [items, setItems] = useState<QuickReply[]>(initialQuickReplies);
  const [shortcut, setShortcut] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeShortcut(shortcut);
    if (!normalized || !content.trim()) return;

    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from('quick_replies')
      .insert({ project_id: projectId, shortcut: normalized, content: content.trim() })
      .select('*')
      .single();
    setSaving(false);

    if (error) {
      setError(error.code === '23505' ? 'Ya existe una respuesta rápida con ese comando.' : error.message);
      return;
    }
    setItems((prev) => [...prev, data].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
    setShortcut('');
    setContent('');
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const { error } = await supabase.from('quick_replies').delete().eq('id', id);
    setDeletingId(null);
    if (error) {
      alert(error.message);
      return;
    }
    setItems((prev) => prev.filter((qr) => qr.id !== id));
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Respuestas rápidas</CardTitle>
        <CardDescription>Comandos que aparecen en el chat para insertar un texto armado con un clic.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleCreate} className="space-y-2">
          <div className="flex gap-2">
            <div className="w-32 shrink-0 space-y-1">
              <Label htmlFor="qr-shortcut" className="text-xs">
                Comando
              </Label>
              <Input id="qr-shortcut" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="saludo" />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="qr-content" className="text-xs">
                Texto
              </Label>
              <Input id="qr-content" value={content} onChange={(e) => setContent(e.target.value)} placeholder="¡Hola! Gracias por escribirnos..." />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={saving || !shortcut.trim() || !content.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Agregar
          </Button>
        </form>

        <div className="space-y-2 border-t border-border pt-3">
          {!items.length ? (
            <p className="text-sm text-muted-foreground">Todavía no creaste ninguna.</p>
          ) : (
            items.map((qr) => (
              <div key={qr.id} className="flex items-start justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-primary">/{qr.shortcut}</p>
                  <p className="truncate text-sm text-muted-foreground">{qr.content}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" disabled={deletingId === qr.id} onClick={() => handleDelete(qr.id)}>
                  {deletingId === qr.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
