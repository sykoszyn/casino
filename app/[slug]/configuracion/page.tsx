import { createClient } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/data/get-project';
import { PageHeader } from '@/components/page-header';
import { EditProjectForm } from '@/components/projects/edit-project-form';
import { QuickRepliesManager } from '@/components/projects/quick-replies-manager';

export default async function ConfiguracionPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const project = await getProjectBySlug(params.slug);
  if (!project) return null;

  const { data: quickReplies } = await supabase
    .from('quick_replies')
    .select('*')
    .eq('project_id', project.id)
    .order('shortcut');

  return (
    <div>
      <PageHeader title="Configuración" description="Ajustes de la sucursal" />
      <div className="m-6 space-y-6">
        <EditProjectForm project={project} />
        <QuickRepliesManager projectId={project.id} initialQuickReplies={quickReplies ?? []} />
        <p className="max-w-lg text-sm text-muted-foreground">
          Próximamente: miembros del equipo y webhooks salientes.
        </p>
      </div>
    </div>
  );
}
