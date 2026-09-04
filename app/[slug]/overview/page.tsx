import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, Inbox, MessageSquare, Users } from 'lucide-react';

export default async function OverviewPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: project } = await supabase.from('projects').select('id').eq('slug', params.slug).single();
  if (!project) return null;

  const [{ count: instancesCount }, { count: connectedCount }, { count: conversationsCount }, { count: contactsCount }] =
    await Promise.all([
      supabase.from('whatsapp_instances').select('*', { count: 'exact', head: true }).eq('project_id', project.id),
      supabase
        .from('whatsapp_instances')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('status', 'connected'),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('project_id', project.id),
      supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('project_id', project.id),
    ]);

  const stats = [
    { label: 'Líneas conectadas', value: `${connectedCount ?? 0}/${instancesCount ?? 0}`, icon: Phone },
    { label: 'Conversaciones', value: conversationsCount ?? 0, icon: Inbox },
    { label: 'Contactos', value: contactsCount ?? 0, icon: Users },
    { label: 'Mensajes hoy', value: '—', icon: MessageSquare },
  ];

  return (
    <div>
      <PageHeader title="Overview" description="Resumen del proyecto" />
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
