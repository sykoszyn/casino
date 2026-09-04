import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { LineasGrid } from '@/components/lineas/lineas-grid';

export default async function LineasPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: project } = await supabase.from('projects').select('id').eq('slug', params.slug).single();
  if (!project) return null;

  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false });

  return (
    <div>
      <PageHeader title="Líneas de WhatsApp" description="Conectá y administrá los números de esta sucursal" />
      <LineasGrid projectId={project.id} initialInstances={instances ?? []} />
    </div>
  );
}
