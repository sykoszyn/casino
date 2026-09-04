import { createClient } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/data/get-project';
import { PageHeader } from '@/components/page-header';
import { InboxShell } from '@/components/inbox/inbox-shell';

export default async function InboxPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const project = await getProjectBySlug(params.slug);
  if (!project) return null;

  const { data: conversations } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('project_id', project.id)
    .eq('archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Inbox" description="Conversaciones en tiempo real de todas tus líneas" />
      <div className="flex-1 overflow-hidden">
        <InboxShell projectId={project.id} initialConversations={conversations ?? []} />
      </div>
    </div>
  );
}
