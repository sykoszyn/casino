import { createClient } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/data/get-project';
import { PageHeader } from '@/components/page-header';
import { InboxShell } from '@/components/inbox/inbox-shell';

export default async function InboxPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const project = await getProjectBySlug(params.slug);
  if (!project) return null;

  // Con muchas líneas puede haber cientos de conversaciones; solo traemos las
  // más recientes de entrada (el resto se puede sumar después con "cargar más").
  const [{ data: conversations }, { data: quickReplies }, { data: instances }] = await Promise.all([
    supabase
      .from('conversations')
      .select('*, contact:contacts(*), instance:whatsapp_instances(id, name, status)')
      .eq('project_id', project.id)
      .eq('archived', false)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(150),
    supabase.from('quick_replies').select('*').eq('project_id', project.id).order('shortcut'),
    supabase.from('whatsapp_instances').select('*').eq('project_id', project.id).order('name'),
  ]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Inbox" description="Conversaciones en tiempo real de todas tus líneas" />
      <div className="flex-1 overflow-hidden">
        <InboxShell
          projectId={project.id}
          initialConversations={conversations ?? []}
          quickReplies={quickReplies ?? []}
          instances={instances ?? []}
        />
      </div>
    </div>
  );
}
