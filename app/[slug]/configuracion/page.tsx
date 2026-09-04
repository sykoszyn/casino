import { getProjectBySlug } from '@/lib/data/get-project';
import { PageHeader } from '@/components/page-header';
import { EditProjectForm } from '@/components/projects/edit-project-form';

export default async function ConfiguracionPage({ params }: { params: { slug: string } }) {
  const project = await getProjectBySlug(params.slug);
  if (!project) return null;

  return (
    <div>
      <PageHeader title="Configuración" description="Ajustes de la sucursal" />
      <div className="m-6 space-y-6">
        <EditProjectForm project={project} />
        <p className="max-w-lg text-sm text-muted-foreground">
          Próximamente: miembros del equipo, webhooks salientes y respuestas automáticas.
        </p>
      </div>
    </div>
  );
}
