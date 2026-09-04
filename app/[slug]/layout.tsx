import type React from 'react';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/data/get-project';
import { ResponsiveShell } from '@/components/responsive-shell';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const supabase = createClient();

  // El middleware ya corrió auth.getUser() (valida el token contra Supabase)
  // para este mismo request y refrescó las cookies; acá alcanza con leer la
  // sesión ya validada desde la cookie, sin pegarle a Supabase de nuevo.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect('/login');

  const [project, { data: projects }] = await Promise.all([
    getProjectBySlug(params.slug),
    supabase.from('projects').select('*').order('name'),
  ]);

  if (!project) notFound();

  return (
    <ResponsiveShell project={project} projects={projects ?? []} userEmail={session.user.email ?? ''}>
      {children}
    </ResponsiveShell>
  );
}
