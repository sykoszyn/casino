import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { ProjectCard } from '@/components/projects/project-card';
import { UserMenu } from '@/components/user-menu';
import { Waypoints } from 'lucide-react';
import type { Project } from '@/lib/types';

export default async function ProjectsPage() {
  const supabase = createClient();

  // El middleware ya validó la sesión (auth.getUser(), con red) para este
  // mismo request; acá solo la leemos de la cookie, sin otro round-trip.
  const [
    {
      data: { session },
    },
    { data: projects },
  ] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from('projects').select('*').order('created_at', { ascending: false }),
  ]);

  if (!session) redirect('/login');
  const user = session.user;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2 font-semibold">
          <Waypoints className="h-5 w-5 text-primary" />
          NexoWA
        </div>
        <UserMenu email={user.email ?? ''} />
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Tus proyectos</h1>
            <p className="text-sm text-muted-foreground">Administrá tus sucursales y sus líneas de WhatsApp</p>
          </div>
          <CreateProjectDialog />
        </div>

        {!projects?.length ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
            Todavía no tenés proyectos. Creá el primero para empezar a conectar líneas de WhatsApp.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(projects as Project[]).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
