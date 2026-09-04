import { createClient } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/data/get-project';
import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default async function ContactosPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const project = await getProjectBySlug(params.slug);
  if (!project) return null;

  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false });

  return (
    <div>
      <PageHeader title="Contactos" description="Clientes que escribieron a alguna de tus líneas" />
      <div className="p-6">
        {!contacts?.length ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
            Todavía no hay contactos.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Contacto</th>
                  <th className="px-4 py-2 font-medium">Teléfono</th>
                  <th className="px-4 py-2 font-medium">Tags</th>
                  <th className="px-4 py-2 font-medium">Alta</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="flex items-center gap-2 px-4 py-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback>{(c.name || c.phone_number || '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {c.name || 'Sin nombre'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.phone_number}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.tags?.join(', ') || '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{new Date(c.created_at).toLocaleDateString('es-AR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
