'use client';

import { useRouter } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ChevronsUpDown, Plus } from 'lucide-react';
import type { Project } from '@/lib/types';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';

export function ProjectSwitcher({ current, projects }: { current: Project; projects: Project[] }) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-left text-sm outline-none hover:bg-secondary">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
          {current.name.slice(0, 2).toUpperCase()}
        </div>
        <span className="flex-1 truncate font-medium uppercase">{current.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {projects.map((project) => (
          <DropdownMenuItem key={project.id} onClick={() => router.push(`/${project.slug}/overview`)} className="uppercase">
            {project.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-1 py-1">
          <CreateProjectDialogTrigger />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreateProjectDialogTrigger() {
  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground">
      <Plus className="h-4 w-4" />
      <CreateProjectDialog />
    </div>
  );
}
