import type React from 'react';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/sidebar';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: project }, { data: projects }] = await Promise.all([
    supabase.from('projects').select('*').eq('slug', params.slug).single(),
    supabase.from('projects').select('*').order('name'),
  ]);

  if (!project) notFound();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar project={project} projects={projects ?? []} userEmail={user.email ?? ''} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
