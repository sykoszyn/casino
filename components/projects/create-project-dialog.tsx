'use client';

import type React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { slugify } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';

export function CreateProjectDialog() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const base = slugify(name) || 'sucursal';
    let slug = base;
    let error = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const { error: insertError } = await supabase.from('projects').insert({ name, slug, description: description || null });
      if (!insertError) {
        error = null;
        break;
      }
      if (insertError.code === '23505') {
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        error = insertError;
        continue;
      }
      error = insertError;
      break;
    }

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOpen(false);
    setName('');
    setDescription('');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Crear proyecto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Nuevo proyecto</DialogTitle>
            <DialogDescription>Un proyecto es una sucursal o negocio con sus propias líneas de WhatsApp e inbox.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sucursal Centro" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: Atención al cliente y ventas" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !name}>
              {loading ? 'Creando...' : 'Crear proyecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
