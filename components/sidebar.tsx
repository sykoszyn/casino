'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ProjectSwitcher } from '@/components/project-switcher';
import type { Project } from '@/lib/types';
import {
  LayoutDashboard,
  FileText,
  Phone,
  Inbox,
  Users,
  ShoppingCart,
  BarChart3,
  Settings,
} from 'lucide-react';

const mainNav = [
  { label: 'Overview', href: 'overview', icon: LayoutDashboard },
  { label: 'Páginas', href: 'paginas', icon: FileText },
  { label: 'Líneas', href: 'lineas', icon: Phone },
  { label: 'Inbox', href: 'inbox', icon: Inbox },
  { label: 'Contactos', href: 'contactos', icon: Users },
  { label: 'Ventas', href: 'ventas', icon: ShoppingCart },
  { label: 'Analytics', href: 'analytics', icon: BarChart3 },
];

const gestionNav = [{ label: 'Configuración', href: 'configuracion', icon: Settings }];

export function Sidebar({
  project,
  projects,
  userEmail,
  onNavigate,
}: {
  project: Project;
  projects: Project[];
  userEmail: string;
  /** se llama al hacer clic en un link del menú (cierra el drawer en mobile) */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname?.startsWith(`/${project.slug}/${href}`);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-[#171717] md:w-60">
      <div className="p-3">
        <ProjectSwitcher current={project} projects={projects} />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {mainNav.map((item) => (
          <Link
            key={item.href}
            href={`/${project.slug}/${item.href}`}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              isActive(item.href) && 'bg-accent text-foreground'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}

        <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Gestión</p>
        {gestionNav.map((item) => (
          <Link
            key={item.href}
            href={`/${project.slug}/${item.href}`}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              isActive(item.href) && 'bg-accent text-foreground'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
          {userEmail.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{userEmail}</p>
          <p className="text-xs text-muted-foreground">Owner</p>
        </div>
      </div>
    </aside>
  );
}
