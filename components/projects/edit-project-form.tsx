'use client';

import type React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Project } from '@/lib/types';
import { Loader2 } from 'lucide-react';

export function EditProjectForm({ project }: { project: Project }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const { error } = await supabase
      .from('projects')
      .update({ name, description: description || null })
      .eq('id', project.id);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Datos de la sucursal</CardTitle>
        <CardDescription>
          El link de la sucursal (<code className="rounded bg-secondary px-1 py-0.5">/{project.slug}</code>) no cambia al
          renombrarla.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Nombre</Label>
            <Input id="project-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">Descripción</Label>
            <Input id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !saving && <p className="text-sm text-success">Guardado.</p>}
          <Button type="submit" disabled={saving || !name}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar cambios'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
