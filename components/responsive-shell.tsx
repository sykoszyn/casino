'use client';

import type React from 'react';
import { useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Menu, X } from 'lucide-react';

export function ResponsiveShell({
  project,
  projects,
  userEmail,
  children,
}: {
  project: Project;
  projects: Project[];
  userEmail: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {open && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Sidebar project={project} projects={projects} userEmail={userEmail} onNavigate={() => setOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 md:hidden">
          <button onClick={() => setOpen((v) => !v)} className="text-muted-foreground hover:text-foreground">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="truncate text-sm font-medium uppercase">{project.name}</span>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
